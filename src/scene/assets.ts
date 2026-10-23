import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { sceneBridge } from './bridge'
import { useEffect, useState } from 'react'

/**
 * CAD 资产加载。
 *
 * `tools/extract_field.py` 会产出：
 *   public/assets/field.glb            静态场地（节点名保留，前端按名字上色）
 *   public/assets/goal_<variant>.glb   4 种 Goal 几何
 *   public/assets/half_<color>.glb     5 种得分物半体（red/blue/yellow/clear/gray）
 *   public/assets/field.json           变换、尺寸、socket 等
 *
 * ★ 场地的几何**只有这一份来源**：少任何一个文件，app 就直接报错退出
 *   （见 `checkAssets()`），不会再拿「手搓的近似几何」顶替。
 *
 * ── 坐标系 ──
 * CAD 导出的几何用的是「X 东 / Y 北 / Z 上」的三元组，而 three.js 是 Y-up，
 * 所以载入后统一绕 X 轴转 -90°：(x, y, z) → (x, z, -y)。
 * 这与 `fieldSpec.toThree()` 是同一个变换，保证所有件对齐。
 */

const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Object3D | null>>()

/** 超过这个体积的 glb 直接跳过（浏览器扛不住，页面会卡死） */
const MAX_GLB_BYTES = 40 * 1024 * 1024

const CAD_TO_THREE = new THREE.Matrix4().makeRotationX(-Math.PI / 2)

/**
 * 探测一个资源的总大小（字节）；拿不到就返回 0。
 *
 * ⚠️ **探针必须跟真正的请求分开**：
 *   很多 CDN（GitHub Pages 就是）支持 Range，`bytes=0-0` 会回一个
 *   **206 + 只有 1 个字节**的响应。浏览器可能把这个 206 缓存下来，
 *   紧接着的整取请求命中了它 → **只拿到 1 个字节** → glb 解析失败。
 *   所以探针走一个**带 query 的独立 URL**（缓存键不同），而且 `cache: 'no-store'`
 *   （连存都不存）。
 */
async function remoteSize(url: string): Promise<number> {
  try {
    // Range 请求最可靠：Content-Range: "bytes 0-0/12345678"
    const res = await fetch(`${url}?__size=1`, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    })
    const cr = res.headers.get('content-range')
    if (cr) return Number(cr.split('/')[1] ?? 0)
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    return Number(head.headers.get('content-length') ?? 0)
  } catch {
    return 0
  }
}

/** 失败后等一下再试（线性退避） */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 一次下载最多试几次。
 *
 * ★ 场地的 `field.glb` 有 8.5 MB —— 在不稳的 wifi 上（比赛现场！）传到一半断了
 *   是常事。断了之后 glb 解析必然失败；之前这里直接返回 null，**而且把失败
 *   永久缓存了** → 一次抖动 = 整个会话都出不来那张报错页，只能手动刷新 ✗
 *   所以：重试几次 + 失败不缓存。
 */
const MAX_ATTEMPTS = 3

/** 载入一个 glb；不存在、太胖或出错时返回 null（这个件就画不出来） */
export function loadGlb(url: string): Promise<THREE.Object3D | null> {
  let p = cache.get(url)
  if (!p) {
    p = (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const size = await remoteSize(url)
          if (size > MAX_GLB_BYTES) {
            console.warn(`[assets] ${url} 体积 ${(size / 1e6).toFixed(0)}MB 超过上限，跳过`)
            return null
          }
          const gltf = await loader.loadAsync(url)
          return gltf.scene
        } catch (err) {
          console.warn(
            `[assets] ${url} 第 ${attempt}/${MAX_ATTEMPTS} 次载入失败`,
            err,
            attempt === MAX_ATTEMPTS ? '（放弃）' : '（重试）',
          )
          if (attempt === MAX_ATTEMPTS) {
            // ★ 失败**不要留在缓存里** —— 否则这个会话再也加载不出来
            if (cache.get(url) === p) cache.delete(url)
            return null
          }
          await sleep(400 * attempt)
        }
      }
      return null
    })()
    cache.set(url, p)
  }
  return p
}

/**
 * 检查一个 mesh 的索引缓冲是否完好。
 *
 * CAD 导出的 glb 有时会出现「索引越界 + drawRange.count = Infinity」，
 * 那种几何在 GPU 上画出来是垃圾（射线检测的距离甚至是 NaN），
 * 所以载入前必须验一遍，不合格就当这个资产没有（不画）。
 */
export function isGeometrySane(mesh: THREE.Mesh): boolean {
  const g = mesh.geometry
  const posCount = g.attributes?.position?.count ?? 0
  if (!posCount) return false
  if (g.index) {
    const arr = g.index.array as ArrayLike<number>
    if (arr.length % 3 !== 0) return false
    let bad = 0
    const step = Math.max(1, Math.floor(arr.length / 3000))
    let checked = 0
    for (let i = 0; i < arr.length; i += step) {
      checked++
      const v = arr[i]
      if (!Number.isFinite(v) || v < 0 || v >= posCount) bad++
    }
    if (checked && bad / checked > 0.01) return false
  }
  return true
}

const VARIANT_FILES: Record<string, string> = {
  'alliance-red': 'assets/goal_alliance-red.glb',
  'alliance-blue': 'assets/goal_alliance-blue.glb',
  'neutral-short': 'assets/goal_neutral-short.glb',
  'neutral-tall': 'assets/goal_neutral-tall.glb',
}

const HALF_FILES: Record<string, string> = {
  red: 'assets/half_red.glb',
  blue: 'assets/half_blue.glb',
  yellow: 'assets/half_yellow.glb',
  clear: 'assets/half_clear.glb',
  gray: 'assets/half_gray.glb',
}

/** app 需要的全部 CAD 资产（缺一个就说明没跑过 `tools/extract_field.py`） */
export const REQUIRED_ASSETS = [
  'assets/field.json',
  'assets/field.glb',
  ...Object.values(VARIANT_FILES),
  ...Object.values(HALF_FILES),
]

/**
 * 开跑前先体检：这些文件缺了就直接报错，别等渲染到一半才发现少了半个场地。
 * 用 HEAD 请求（不下载正文），本地 dev server 上是毫秒级的。
 *
 * ★ 网络抖动要**重试**：HEAD 失败一次不等于文件不存在 ——
 *   一次抖动就判定「缺资产」→ 整个 app 拒绝启动 ✗
 */
export async function checkAssets(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = []
  await Promise.all(
    REQUIRED_ASSETS.map(async (url) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(url, { method: 'HEAD' })
          const ct = res.headers.get('content-type') ?? ''
          // dev server 找不到的路径会回 index.html（SPA fallback，状态码还是 200），
          // 所以 content-type 是 text/html 也要当成「没有这个文件」
          if (!res.ok || ct.includes('text/html')) {
            missing.push(url)
            return
          }
          return // 在 → 这个资产没问题
        } catch {
          if (attempt === 3) {
            // 连着三次都失败 → 当作缺（页面上有「重新加载」的按钮）
            missing.push(url)
            return
          }
          await sleep(300 * attempt)
        }
      }
    }),
  )
  return { ok: missing.length === 0, missing }
}

/** 取出 glb 里第一个带三角形的 mesh */
export function firstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh
  })
  return found
}

/** 把 CAD 几何转到 three 坐标系，并把自身变换烘进顶点 */
function bake(root: THREE.Object3D): THREE.BufferGeometry | null {
  const mesh = firstMesh(root)
  if (!mesh) return null
  mesh.updateWorldMatrix(true, false)
  const geo = mesh.geometry.clone()
  geo.applyMatrix4(mesh.matrixWorld)
  geo.applyMatrix4(CAD_TO_THREE)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 整棵子树都转到 three 坐标系（变换烘进各自的几何）。
 *
 * ★ **只能转一次**：同一个 glb 的 root 是**共享**的（`loadGlb` 缓存了 promise），
 *   而 React StrictMode 在开发模式下会把 effect 跑两遍 —— 于是同一个 root
 *   会被 `bakeRoot` 处理两次，第二次**又转了一次 -90°**，整块场地就躺下了
 *   （表现是「完整性检查说没有地面垫」→ 悄悄退回手搓场地）。
 *   所以这里用 `userData.baked` 记一笔，第二次直接跳过。
 */
export function bakeRoot(root: THREE.Object3D, toThree = CAD_TO_THREE): void {
  if (root.userData.baked) return
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry = m.geometry.clone()
    m.geometry.applyMatrix4(m.matrixWorld)
    m.geometry.applyMatrix4(toThree)
    // 变换后必须重算包围球，否则视锥剔除会按旧位置把整块几何剔掉
    m.geometry.computeBoundingBox()
    m.geometry.computeBoundingSphere()
    m.position.set(0, 0, 0)
    m.rotation.set(0, 0, 0)
    m.scale.set(1, 1, 1)
    m.updateMatrix()
  })
  // 根节点自己的变换已经被烘进子节点的几理里了，必须清零，
  // 否则会再被施加一次（整个场地会飞到别处 / 变成镜像）
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.scale.set(1, 1, 1)
  root.userData.baked = true
  root.updateMatrix()
  root.updateMatrixWorld(true)
}

export interface GoalAsset {
  /** 整棵子树（多节点导出时用，按节点名上色） */
  root: THREE.Object3D | null
  /** 合并成一件时的几何（只能整体上色） */
  single: THREE.BufferGeometry | null
}

/**
 * 载入某个 Goal 变体的 CAD 几何。
 *
 * 如果 glb 里有多个带名字的子节点（按 PRODUCT 拆分的导出），就整体返回，
 * 由调用方按节点名上色；如果是合并成一件的几何，就返回它的几何供整体上色。
 *
 * 会做一次**尺寸自检**：几何在 up 轴上的高度必须和 expectedHeight 差不多，
 * 否则判定为导出有问题，这个 goal 就不画。
 */
const goalCache = new Map<string, Promise<GoalAsset | null>>()

export function loadGoalObject(
  variant: string,
  expectedHeight: number,
): Promise<GoalAsset | null> {
  const url = VARIANT_FILES[variant]
  if (!url) return Promise.resolve(null)
  let p = goalCache.get(variant)
  if (!p) {
    p = loadGoalObjectUncached(url, expectedHeight)
    goalCache.set(variant, p)
  }
  return p
}

async function loadGoalObjectUncached(
  url: string,
  expectedHeight: number,
): Promise<GoalAsset | null> {
  const root = await loadGlb(url)
  if (!root) return null
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  if (!meshes.length) return null

  // 先把 CAD 的「Z 向上」转成 three 的「Y 向上」，再量高度
  bakeRoot(root, CAD_TO_THREE)

  // 高度自检要用**整棵子树**的包围盒（Goal 由好几个零件组成，
  // 只看第一个 mesh 会量到旁边那块底板上去）
  const box = new THREE.Box3()
  const tmp = new THREE.Box3()
  for (const m of meshes) {
    m.updateWorldMatrix(true, false)
    tmp.setFromObject(m)
    if (Number.isFinite(tmp.min.x)) box.union(tmp)
  }
  for (const m of meshes) {
    if (!isGeometrySane(m)) {
      console.warn(`[assets] ${url} 的索引缓冲损坏，不画这个件`)
      return null
    }
  }
  const h = box.max.y - box.min.y
  if (Math.abs(h - expectedHeight) > 25) {
    console.warn(
      `[assets] ${url} 高度 ${h.toFixed(1)}mm 与预期 ${expectedHeight}mm 不符，不画这个 goal`,
    )
    return null
  }

  // **归一化到 Goal 的局部坐标**：socket 轴在 (0,0)，底面在 y=0。
  // 导出的 glb 里节点还带着某个实例的世界平移，不清掉的话 9 个 Goal 会叠在同一个位置。
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const shift = new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz)
  for (const m of meshes) {
    m.geometry.applyMatrix4(shift)
    m.geometry.computeBoundingBox()
    m.geometry.computeBoundingSphere()
  }

  if (meshes.length > 1) {
    return { root, single: null }
  }
  return { root: null, single: meshes[0].geometry }
}

/** React hook：拿一个 Goal 变体的 CAD 资产 */
export function useGoalAsset(
  variant: string,
  expectedHeight: number,
): GoalAsset | null {
  const [asset, setAsset] = useState<GoalAsset | null>(null)
  useEffect(() => {
    let alive = true
    loadGoalObject(variant, expectedHeight).then((a) => {
      if (!alive) return
      setAsset(a)
      sceneBridge.invalidate?.()
    })
    return () => {
      alive = false
    }
  }, [variant, expectedHeight])
  return asset
}

/**
 * 载入某个半体的 CAD 几何（约定：翻边在原点，尖端朝 -Y）。
 *
 * ★ **同一个颜色只 bake 一次**（结果缓存起来给所有实例共用）：
 *   `bake()` 是**克隆**几何的 —— 不缓存的话，每个 `HalfMesh` 组件都会拿到
 *   一份自己的拷贝（摆场一次就是 114 个散件 × 2 半体 = 228 份），
 *   几百个 GPU buffer 传上去，换个选中状态就卡住好几秒 ✗
 *   （three.js 里共用一份 BufferGeometry 是常规做法，R3F 也不会去 dispose
 *    作为 prop 传下去的几何 ✓）。
 */
const halfGeoCache = new Map<string, Promise<THREE.BufferGeometry | null>>()

export function loadHalfGeometry(color: string): Promise<THREE.BufferGeometry | null> {
  const url = HALF_FILES[color]
  if (!url) return Promise.resolve(null)
  let p = halfGeoCache.get(color)
  if (!p) {
    p = loadGlb(url).then((root) => {
      if (!root) return null
      const mesh = firstMesh(root)
      if (!mesh || !isGeometrySane(mesh)) {
        console.warn(`[assets] ${url} 的索引缓冲损坏，不画这个件`)
        return null
      }
      return bake(root)
    })
    halfGeoCache.set(color, p)
  }
  return p
}

/** React hook：异步拿一个 glb 里的几何 */
export function useOptionalGeometry(
  loaderFn: () => Promise<THREE.BufferGeometry | null>,
  deps: unknown[],
): THREE.BufferGeometry | null {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    let alive = true
    loaderFn().then((g) => {
      if (!alive) return
      setGeo(g)
      // frameloop="demand" 时，异步换上的几何不会自动触发一帧 —— 必须手动要
      sceneBridge.invalidate?.()
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return geo
}
