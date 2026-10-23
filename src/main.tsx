import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// ★ Service worker：**只在生产构建注册**。
//   dev 下注册会把开发中的代码缓存住 —— 改一行代码刷新了还是旧的 ✗
//   （而且 dev server 里的模块路径跟 sw 缓存键对不上，容易出玄学问题）。
//
//   注册用相对路径 './sw.js' → 跟着页面走：GitHub Pages 挂在 /VEX3D/ 下就是
//   /VEX3D/sw.js，本地静态服务器在根目录就是 /sw.js ✓ 两边都对。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((err) => {
        // 注册失败不影响使用（只是没有离线能力）
        console.warn('[pwa] service worker 注册失败', err)
      })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // ★ 把「这一页用到的东西」交给 SW 缓存。
        //   第一次访问时 SW 还没接管页面，**那次导航没被拦截** →
        //   外壳（index.html）不会进缓存 → 断网后打不开 ✗
        //   所以这里手动交接一次（js / css / 文档本身）。
        const urls = [
          location.href,
          ...Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"]')).map(
            (el) => (el as HTMLScriptElement).src || (el as HTMLLinkElement).href,
          ),
        ].filter(Boolean)
        reg.active?.postMessage({ type: 'precache', urls })
      })
      .catch(() => {})
  })
}
