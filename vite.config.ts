import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 浏览器一次下载超过 ~40 MB 的 glb 会直接把页面卡死。
 * 源 CAD 导出的 `field.glb` 在瘦身前可能几百 MB，这里在打包时把超大的资源剔掉
 * （前端本来也会跳过它们，见 src/scene/assets.ts 的 MAX_GLB_BYTES）。
 *
 * 顺带剔掉 **app 根本不请求**的管线副产品（`field_slim.glb` 3.7 MB +
 * `field_report.json`）—— 少 3.7 MB 的发布产物。
 */
const UNUSED_ASSETS = ['field_slim.glb', 'field_report.json']

function dropOversizedAssets(limit = 40 * 1024 * 1024): Plugin {
  return {
    name: 'vex3d-drop-oversized-assets',
    apply: 'build',
    closeBundle() {
      const dir = path.resolve(import.meta.dirname, 'dist')
      if (!fs.existsSync(dir)) return
      const walk = (d: string) => {
        for (const name of fs.readdirSync(d)) {
          const f = path.join(d, name)
          if (fs.statSync(f).isDirectory()) {
            walk(f)
            continue
          }
          const size = fs.statSync(f).size
          if (size > limit) {
            fs.unlinkSync(f)
            console.log(`[build] 剔除超大资源 ${path.relative(dir, f)} (${(size / 1e6).toFixed(0)}MB)`)
            continue
          }
          if (UNUSED_ASSETS.includes(name)) {
            fs.unlinkSync(f)
            console.log(`[build] 剔除用不到的资产 ${path.relative(dir, f)}`)
          }
        }
      }
      walk(dir)
    },
  }
}

export default defineConfig({
  plugins: [react(), dropOversizedAssets()],
  // ★ **相对路径**：GitHub Pages 把它挂在 /VEX3D/ 这样的子路径下，
  //   写死 '/VEX3D/' 的话 fork 出去就全 404；写 './' 的话同一份 dist/
  //   在 Pages、任何静态服务器、甚至局域网共享文件夹里都能直接跑 ✓
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
})
