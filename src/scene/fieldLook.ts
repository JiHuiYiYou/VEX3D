import * as THREE from 'three'

/**
 * 场地的「配色 / 质感」层。
 *
 * CAD 导出的 glb **没有材质、也没有 UV**（所有零件都是 SolidWorks 默认灰），
 * 所以颜色、贴图、光照全部由这一层指派：
 *  · `LOOK` —— 各零件的配色
 *  · `makeMatTexture()` —— 垫子的印刷质感（程序生成的 canvas 贴图）
 *  · `makeSkyTexture()` —— 背景渐变
 *  · `buildEnvironment()` —— 给 PBR 材质用的环境贴图（PMREM）
 *  · `stripedMaterial(axis)` —— 围栏顶那条压条的黑白条纹
 *
 * ⚠️ 这里只管**长什么样**，不改几何 —— 场地的形状永远只有官方 CAD 那一份 ✓
 */

/** 配色（十六进制） */
export const LOOK = {
  /** 垫子底色 */
  mat: '#6d7681',
  /** 围栏下部的挡板 */
  wallPanel: '#333a44',
  /** 围栏立柱 / 角柱 */
  wallPost: '#454e5a',
  /** 围栏顶盖 */
  wallCap: '#6d7682',
  /** 压条的黑白条纹 */
  railDark: '#15181d',
  railLight: '#e2e6ea',
  /** 白色胶带 */
  tape: '#fbf9f2',
  /** 联盟站区的红蓝挡板（外圈） */
  allianceWall: '#e4002b',
  /** 中立 goal 本体 */
  goalBody: '#12151a',
  /** 中立 goal 的裙边 / 底座（比本体亮一点，形状才看得出来） */
  goalSkirt: '#262c34',
  /** 背景天空：上 / 地平线 / 下 */
  skyTop: '#0b1020',
  skyHorizon: '#243040',
  skyBottom: '#05070b',
} as const

/** 垫子贴图：程序生成的「印刷质感」（底色 + 中心渐变 + 大圆 + 角弧 + 颗粒） */
export function makeMatTexture(): THREE.CanvasTexture {
  const S = 2048
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const g = c.getContext('2d')!

  g.fillStyle = LOOK.mat
  g.fillRect(0, 0, S, S)

  // 中心稍亮、四周压暗 —— 看起来像一块打过光的垫子
  const rg = g.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S * 0.74)
  rg.addColorStop(0, 'rgba(255,255,255,0.12)')
  rg.addColorStop(0.5, 'rgba(255,255,255,0.03)')
  rg.addColorStop(1, 'rgba(8,12,20,0.30)')
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)

  // 冷暖分层：中心偏冷（青），外圈偏暖 —— 免得整块垫子是一张灰纸
  const cg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.72)
  cg.addColorStop(0, 'rgba(96,150,178,0.20)')
  cg.addColorStop(0.5, 'rgba(140,146,150,0.07)')
  cg.addColorStop(1, 'rgba(196,142,86,0.15)')
  g.fillStyle = cg
  g.fillRect(0, 0, S, S)

  // 竞技场大圆（半径 1420 mm）+ 中圈
  g.strokeStyle = 'rgba(34,42,54,0.30)'
  g.lineWidth = 5
  g.beginPath()
  g.arc(S / 2, S / 2, S * 0.393, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = 'rgba(34,42,54,0.16)'
  g.lineWidth = 3
  g.beginPath()
  g.arc(S / 2, S / 2, S * 0.19, 0, Math.PI * 2)
  g.stroke()

  // 四角的印刷弧线
  g.strokeStyle = 'rgba(34,42,54,0.22)'
  g.lineWidth = 4
  const m = S * 0.055
  const r = S * 0.16
  for (const [cx, cy, a0, a1] of [
    [m, m, 0, Math.PI / 2],
    [S - m, m, Math.PI / 2, Math.PI],
    [m, S - m, -Math.PI / 2, 0],
    [S - m, S - m, Math.PI, Math.PI * 1.5],
  ] as const) {
    g.beginPath()
    g.arc(cx, cy, r, a0, a1)
    g.stroke()
  }

  // 颗粒（256×256 的噪声贴一块，平铺）—— 垫子不是纯色的塑料
  const N = 256
  const nc = document.createElement('canvas')
  nc.width = nc.height = N
  const ng = nc.getContext('2d')!
  const img = ng.createImageData(N, N)
  for (let i = 0; i < N * N; i++) {
    const v = 118 + Math.random() * 16
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 26
  }
  ng.putImageData(img, 0, 0)
  g.globalAlpha = 0.5
  g.fillStyle = g.createPattern(nc, 'repeat')!
  g.fillRect(0, 0, S, S)
  g.globalAlpha = 1

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/**
 * 给垫子网格生成**平面 UV**（CAD 导出没有 UV）。
 * 垫子是一块平的大板子（y ∈ [-16, 0]），按 x/z 线性映射即可。
 */
export function planarUV(geometry: THREE.BufferGeometry, half: number): void {
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + half) / (half * 2)
    uv[i * 2 + 1] = (pos.getZ(i) + half) / (half * 2)
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** 围栏外的「舞台」地面：中心一圈微亮的冷灰，边缘沉进黑色 */
export function makeApronTexture(): THREE.CanvasTexture {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const rg = g.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S * 0.5)
  rg.addColorStop(0, '#1b2028')
  rg.addColorStop(0.55, '#12161c')
  rg.addColorStop(1, '#05070a')
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 背景天空的垂直渐变（贴到穹顶上） */
export function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 512
  const g = c.getContext('2d')!
  const lg = g.createLinearGradient(0, 0, 0, 512)
  lg.addColorStop(0.0, LOOK.skyTop)
  lg.addColorStop(0.52, LOOK.skyHorizon)
  lg.addColorStop(0.62, '#151c26')
  lg.addColorStop(1.0, LOOK.skyBottom)
  g.fillStyle = lg
  g.fillRect(0, 0, 8, 512)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * 环境贴图（PMREM）：一个小场景 → 预过滤的 cubemap。
 * 有了它，PBR 材质（胶带、goal、得分物）才有干净的高光和色彩过渡，
 * 不用把环境光开很大（那样画面会发灰发平）。
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene()

  // 天空穹顶：上冷下暖
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#5b7396', side: THREE.BackSide }),
  )
  env.add(dome)
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(48, 24),
    new THREE.MeshBasicMaterial({ color: '#151a21', side: THREE.DoubleSide }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -12
  env.add(floor)

  // 太阳（暖）+ 反光（冷）
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshBasicMaterial({ color: '#fdf7ec' }),
  )
  sun.position.set(16, 26, 14)
  sun.lookAt(0, 0, 0)
  env.add(sun)
  const bounce = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 20),
    new THREE.MeshBasicMaterial({ color: '#2b4266' }),
  )
  bounce.position.set(-24, 6, -18)
  bounce.lookAt(0, 0, 0)
  env.add(bounce)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(env, 0.02)
  pmrem.dispose()
  dome.geometry.dispose()
  ;(dome.material as THREE.Material).dispose()
  floor.geometry.dispose()
  ;(floor.material as THREE.Material).dispose()
  sun.geometry.dispose()
  ;(sun.material as THREE.Material).dispose()
  bounce.geometry.dispose()
  ;(bounce.material as THREE.Material).dispose()
  return rt.texture
}

/**
 * 围栏顶压条的黑白条纹（世界坐标程序化，不用 UV —— CAD 里没有 UV）。
 * axis = 条子的长边方向（'x' 或 'z'），由调用方按包围盒判断。
 */
const stripeCache = new Map<string, THREE.MeshStandardMaterial>()

export function stripedMaterial(axis: 'x' | 'z', period = 297): THREE.MeshStandardMaterial {
  const key = `${axis}:${period}`
  const cached = stripeCache.get(key)
  if (cached) return cached

  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0.08,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPeriod = { value: period }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLookPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vLookPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLookPos;\nuniform float uPeriod;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float t = ${axis === 'x' ? 'vLookPos.x' : 'vLookPos.z'};
         float s = step(0.5, fract(t / uPeriod));
         diffuseColor.rgb = mix(vec3(${new THREE.Color(LOOK.railDark).r.toFixed(3)}, ${new THREE.Color(LOOK.railDark).g.toFixed(3)}, ${new THREE.Color(LOOK.railDark).b.toFixed(3)}),
                                vec3(${new THREE.Color(LOOK.railLight).r.toFixed(3)}, ${new THREE.Color(LOOK.railLight).g.toFixed(3)}, ${new THREE.Color(LOOK.railLight).b.toFixed(3)}), s);`,
      )
  }
  mat.customProgramCacheKey = () => `rail-stripe-${key}`
  stripeCache.set(key, mat)
  return mat
}
