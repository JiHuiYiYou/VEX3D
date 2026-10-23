/* eslint-disable no-undef */
/**
 * VEX3D 的 service worker —— 离线可用 + 二次打开秒开。
 *
 * 为什么需要：
 *   · 场地资产有 15 MB（field.glb 8.5 MB + 4 个 goal + 5 个半体），
 *     弱网（比赛现场的 wifi！）第一次下完，第二次就该**秒开**；
 *   · 断网了也要能用（战术分析不一定要联网）。
 *
 * 策略：
 *   · **导航请求**（打开页面）→ 优先网络（拿到最新版），断网回落到缓存。
 *   · **静态资源**（js / css / glb）→ 缓存优先，命中直接用（秒开）；
 *     缓存超过 10 分钟（跟 CDN 的 max-age=600 对齐）就在后台悄悄更新。
 *   · **不预缓存**：预缓存等于第一次访问就白下 15 MB。用到才下。
 *
 * ⚠️ 改动这个文件要**把 CACHE 的版本号 +1** —— 否则老用户拿到的还是旧缓存。
 * ⚠️ 只在生产构建注册（见 src/main.tsx）—— dev 下注册会把开发中的代码缓存住。
 */

const CACHE = 'vex3d-v1'
/** 缓存里这份算「新鲜」多久（毫秒）—— 跟 CDN 的 cache-control: max-age=600 对齐 */
const FRESH_MS = 10 * 60 * 1000

self.addEventListener('install', () => {
  // 不预缓存（见上面的说明），直接接管
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  // 页面在 SW 接管之后，把「这一页用到的东西」告诉它去缓存
  // （第一次访问时 SW 还没接管，那次导航没被拦截 → 外壳不会进缓存 ✗）
  if (event.data && event.data.type === 'precache') {
    event.waitUntil(precache(event.data.urls || []))
  }
})

/** 页面指定的这些 URL 预存进缓存 */
async function precache(urls) {
  const cache = await caches.open(CACHE)
  await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(u)
        if (res.status === 200) await put(cache, new Request(u), res)
      } catch {
        // 拿不到就算了（离线时它本来就该走缓存）
      }
    }),
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  // 外部资源（Google Fonts 之类）不管 —— 离线时让它自然失败，回落系统字体
  if (url.origin !== self.location.origin) return
  if (req.method === 'HEAD') {
    // ★ app 启动前会用 HEAD 探 11 个资产（checkAssets）。
    //   离线时这些 HEAD 要**从缓存里答** —— 否则 app 会以为资产没了 ✗
    event.respondWith(headFromCache(req))
    return
  }
  if (req.method !== 'GET') return
  event.respondWith(handle(req, event))
})

/** HEAD：从缓存里答（没有就老实地走网络） */
async function headFromCache(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) {
    const headers = {}
    hit.headers.forEach((v, k) => {
      headers[k] = v
    })
    return new Response(null, { status: 200, statusText: 'OK', headers })
  }
  return fetch(req)
}

async function handle(req, event) {
  const cache = await caches.open(CACHE)

  // 打开页面：优先网络（拿最新的），断网就回落到缓存
  if (req.mode === 'navigate') {
    try {
      const res = await fetch(req)
      if (res.status === 200) await put(cache, req, res.clone())
      return res
    } catch {
      const hit =
        (await cache.match(req)) ||
        (await cache.match(new URL('./', self.location).href))
      if (hit) return hit
      return new Response('离线，而且没有缓存 —— 先联网打开一次。', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  }

  // 静态资源：缓存优先
  const hit = await cache.match(req)
  if (hit) {
    const at = Number(hit.headers.get('x-sw-cached-at') || 0)
    if (Date.now() - at < FRESH_MS) return hit
    // 过期了：先用旧的顶上，后台悄悄更新（不阻塞这次请求）
    event.waitUntil(update(cache, req))
    return hit
  }

  // 没缓存 → 走网络，顺手存下来（第二次打开就秒开）
  const res = await fetch(req)
  if (res.status === 200 && res.type === 'basic') await put(cache, req, res.clone())
  return res
}

/** 存进缓存，并记下「什么时候存的」（用来判断新鲜度） */
async function put(cache, req, res) {
  try {
    const headers = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })
    // ★ **必须去掉这两个头**：
    //   浏览器给我们的 body 是**解压之后**的（fetch 会自动解 gzip），
    //   而 content-length / content-encoding 还说「这是 gzip 后的长度」——
    //   对不上，Cache API 会直接拒绝这次写入（TypeError），缓存里就什么都没有 ✗
    delete headers['content-length']
    delete headers['content-encoding']
    headers['x-sw-cached-at'] = String(Date.now())
    await cache.put(req, new Response(res.body, { status: res.status, statusText: res.statusText, headers }))
  } catch (e) {
    // 配额满了 / 磁盘写不进去 —— 不影响使用，忽略
    console.warn('[sw] 缓存失败', e)
  }
}

/** 后台更新一份（缓存过期时用） */
async function update(cache, req) {
  try {
    const res = await fetch(req)
    if (res.status === 200) await put(cache, req, res.clone())
  } catch {
    // 网络不好就算了，缓存里那份还能用
  }
}
