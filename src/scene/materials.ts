import * as THREE from 'three'
import { COLORS } from '@/data/fieldSpec'
import { LOOK, makeMatTexture, stripedMaterial } from './fieldLook'

/**
 * Goal 的「本体」零件（漏斗 `276-9250-003_Master`、底座 `276-4847-011` /
 * `276-9250-005` / `276-9250-004`、角件 `276-7596-316/317`）要按**goal 的类型**上色，
 * 其余零件按名字上色。
 */
const GOAL_BODY_PARTS = [
  '276-9250-003_master', // 顶上的漏斗
  '276-9250-005', // 柱身
  '276-9250-004',
  '276-7596-316',
  '276-7596-317_corner',
  // 联盟 goal 上的同款角柱（跟着 goal 色）
  'sbt0832_276-5006-001',
]

/** Goal 底下那块 300×300 的底板是深色的（跟真实场地一致） */
const GOAL_BASE_PLATE = '276-4847-011'

/**
 * 中立 goal 的黄色花纹：CAD 里没有独立的黄色零件，花纹是 Goal 子树里的
 * `SBT0832_276-5007-001` 角柱（联盟 goal 用的是 5006，跟 goal 同色）。
 */
const NEUTRAL_ACCENT = 'sbt0832_276-5007-001'

/** 场地垫子（CAD 里唯一一整块大平面） */
const MAT_PART = '276-6904-001'
/** 围栏顶那条压条（黑白条纹） */
const RAIL_PART = '276-7596-350'

/**
 * ★ 材质缓存。
 *
 * CAD 里同一个 PRODUCT 会导出成**很多个节点**（名字带 `_1` `_2` … 后缀），
 * 之前 `materialFor()` 每调一次就 `new` 一份 → 摆场后场景里几百份一模一样的
 * 材质（437 份），白白多占内存、多跑 uniform 上传。
 *
 * 缓存的 key 是「**用哪一份材质**」的规格（不是零件名），
 * 所以 `276-7596-014` / `276-7596-014_1` / … 共用同一份 ✓
 */
const materialCache = new Map<string, THREE.Material>()

function shared(key: string, make: () => THREE.Material): THREE.Material {
  let m = materialCache.get(key)
  if (!m) {
    m = make()
    materialCache.set(key, m)
  }
  return m
}

/** 垫子的贴图材质（全局一份） */
let matMaterial: THREE.MeshStandardMaterial | null = null

function matSurfaceMaterial(): THREE.MeshStandardMaterial {
  if (!matMaterial) {
    matMaterial = new THREE.MeshStandardMaterial({
      map: makeMatTexture(),
      color: '#ffffff',
      roughness: 0.92,
      metalness: 0.0,
    })
  }
  return matMaterial
}

/** 中立 goal 的各个零件给不同的深色，形状才看得出来 */
const NEUTRAL_PART_TONE: Record<string, string> = {
  '276-9250-003_master': LOOK.goalSkirt, // 漏斗
  '276-9250-005': '#1b2027', // 柱身
  '276-9250-004': LOOK.goalBody, // 裙边
  '276-7596-316': LOOK.goalSkirt,
  '276-7596-317_corner': LOOK.goalSkirt,
}

/** 联盟 goal 的漏斗压暗一点，立体感更强 */
function darken(hex: string, amount: number): string {
  const c = new THREE.Color(hex)
  c.lerp(new THREE.Color('#0b0d10'), amount)
  return '#' + c.getHexString()
}

/**
 * 按**零件名**指派材质。
 *
 * 官方 CAD 里所有零件的颜色都是同一个 SolidWorks 默认值（0.792/0.820/0.933），
 * 没有可用信息，所以颜色完全由我们按 PRODUCT 名指派（配色见 fieldLook.ts 的 LOOK）。
 *
 * ★ 返回的材质是**共享**的 —— 同一个规格永远拿到同一份对象。
 *   所以**不能**再单独改某个 mesh 的材质属性（会串到所有同类的件上）。
 *
 * @param goalColor 该 Goal 的主色（红方 goal / 蓝方 goal / 中立黑），用于本体零件
 * @param railAxis 压条的长边方向（画黑白条纹用）
 */
export function materialFor(
  name: string,
  goalColor?: string,
  railAxis: 'x' | 'z' = 'x',
): THREE.Material {
  const n = (name || '').toLowerCase()

  // ── 场地 ───────────────────────────────────────────
  if (n === MAT_PART) {
    return matSurfaceMaterial()
  }
  if (n.startsWith(RAIL_PART)) {
    return stripedMaterial(railAxis)
  }
  if (n.startsWith('276-7596-351') || n.startsWith('276-7596-014') || n.startsWith('276-7596-015')) {
    return shared(
      'wall:panel',
      () => new THREE.MeshStandardMaterial({ color: LOOK.wallPanel, roughness: 0.82 }),
    )
  }
  if (n.startsWith('276-7596-316') || n.startsWith('276-7596-317')) {
    return shared(
      'wall:post',
      () => new THREE.MeshStandardMaterial({ color: LOOK.wallPost, roughness: 0.8 }),
    )
  }
  if (n.startsWith('276-9250-021') || n.startsWith('276-9250-022') || n.startsWith('276-9250-027')) {
    return shared(
      'wall:cap',
      () => new THREE.MeshStandardMaterial({ color: LOOK.wallCap, roughness: 0.7 }),
    )
  }
  if (n.startsWith('276-8354-404') || n.startsWith('sbt0832_276-8016') || n.startsWith('sbt0832_276-4993')) {
    return shared(
      'wall:dark',
      () => new THREE.MeshStandardMaterial({ color: '#2b313a', roughness: 0.85 }),
    )
  }
  if (n.startsWith('276-9250-032')) {
    return shared(
      'wall:post',
      () => new THREE.MeshStandardMaterial({ color: LOOK.wallPost, roughness: 0.8 }),
    )
  }

  // ── Goal ───────────────────────────────────────────
  if (n.startsWith(NEUTRAL_ACCENT)) {
    return shared(
      'accent:yellow',
      () => new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.5 }),
    )
  }
  if (goalColor) {
    const bodyPart = GOAL_BODY_PARTS.find((p) => n.startsWith(p))
    if (bodyPart) {
      // 中立 goal：各个零件给不同的深色，形状才看得出来
      if (goalColor === COLORS.neutralGoal) {
        const tone = NEUTRAL_PART_TONE[bodyPart] ?? LOOK.goalBody
        return shared(
          `goal:neutral:${bodyPart}`,
          () =>
            new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, metalness: 0.06 }),
        )
      }
      // 联盟 goal：整体联盟色，漏斗压暗一点，立体感更强
      const tone = bodyPart.startsWith('276-9250-003_master')
        ? darken(goalColor, 0.28)
        : bodyPart.startsWith('276-9250-004')
          ? darken(goalColor, 0.12)
          : goalColor
      return shared(
        `goal:${goalColor}:${bodyPart}`,
        () =>
          new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, metalness: 0.06 }),
      )
    }
  }
  if (n.startsWith(GOAL_BASE_PLATE)) {
    return shared(
      'goal:base',
      () => new THREE.MeshStandardMaterial({ color: '#20242a', roughness: 0.8 }),
    )
  }

  // ── 其它零件 ───────────────────────────────────────
  if (n.includes('199c') || n.includes('bright red') || n.includes('red loader')) {
    return shared(
      'accent:red',
      () => new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.5 }),
    )
  }
  if (n.includes('299c') || n.includes('bright blue') || n.includes('blue loader')) {
    return shared(
      'accent:blue',
      () => new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.5 }),
    )
  }
  if (n.includes('425c') || n.includes('grey') || n.includes('gray')) {
    return shared(
      'accent:gray',
      () => new THREE.MeshStandardMaterial({ color: COLORS.gray, roughness: 0.7 }),
    )
  }
  if (n.includes('clear')) {
    // ★ **不用 `transmission`** —— 见 `halfMaterial()` 里的说明：
    //   只要场景里有一个 `transmission > 0` 的材质，three.js 每帧就把整个场景
    //   **额外渲染一遍**（transmission backdrop pass）→ 代价直接翻倍。
    return shared(
      'clear',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: COLORS.clear,
          transparent: true,
          opacity: 0.3,
          roughness: 0.06,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          ior: 1.5,
          envMapIntensity: 1.4,
          side: THREE.DoubleSide,
          depthWrite: false,
          forceSinglePass: true,
        }),
    )
  }
  if (n.includes('tape')) {
    return shared(
      'tape',
      () =>
        new THREE.MeshStandardMaterial({
          color: LOOK.tape,
          roughness: 0.55,
          emissive: new THREE.Color(LOOK.tape),
          emissiveIntensity: 0.16,
        }),
    )
  }
  if (n.includes('apiltag')) {
    return shared(
      'apiltag',
      () => new THREE.MeshStandardMaterial({ color: '#e8eaee', roughness: 0.75 }),
    )
  }
  if (n.includes('840')) {
    // 9 个 Goal：中性的是黑底
    if (n.includes('red'))
      return shared(
        'goal840:red',
        () => new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.6 }),
      )
    if (n.includes('blue'))
      return shared(
        'goal840:blue',
        () => new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.6 }),
      )
    return shared(
      'goal840:neutral',
      () => new THREE.MeshStandardMaterial({ color: COLORS.neutralGoal, roughness: 0.6 }),
    )
  }
  if (n.includes('120_') || n.includes('alliance side') || n.includes('wall')) {
    // 跟上面那块挡板是同一个颜色，但粗糙度差一点 → 单独一份（别共用同一个 key）
    return shared(
      'wall:panel2',
      () => new THREE.MeshStandardMaterial({ color: LOOK.wallPanel, roughness: 0.85 }),
    )
  }
  if (n.includes('yellow')) {
    return shared(
      'accent:yellow',
      () => new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.5 }),
    )
  }
  return shared(
    'default',
    () => new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.85 }),
  )
}

// ─────────────────────────── 得分物半体 ───────────────────────────

/** 半体的颜色（跟 `data/terms.ts` 的 COLORS 对齐） */
const HALF_COLORS: Record<string, string> = {
  red: COLORS.red,
  blue: COLORS.blue,
  yellow: COLORS.yellow,
  gray: COLORS.gray,
  clear: COLORS.clear,
}

/**
 * 半体材质 —— **按颜色共享一份**。
 *
 * ★ 摆场一次 = 114 个散件 × 2 半体 + 摞里的 = 200 多个半体 mesh。
 *   每个都自己 `<meshStandardMaterial>` 造一份的话，材质数会跟 mesh 数一样涨
 *   （437 份）—— 材质一多，每帧的 uniform 上传 / program 切换都要多跑一遍。
 *
 * ⚠️ 共享的代价：**不能再单独改某个 mesh 的材质属性**（会串到所有同色的件上）。
 *   半体的颜色只来自 `item.halves[halfIndex]`，所以按颜色缓存是安全的 ✓
 */
const halfMaterialCache = new Map<string, THREE.Material>()

export function halfMaterial(color: string): THREE.Material {
  const cached = halfMaterialCache.get(color)
  if (cached) return cached

  const hex = HALF_COLORS[color] ?? COLORS.gray
  let mat: THREE.Material
  if (color === 'clear') {
    // 透明杯半。
    //
    // ★★ **绝对不要用 `transmission`** ★★
    //   three.js 只要发现场景里有 `transmission > 0` 的材质，每帧就会把整个场景
    //   **额外渲染一遍**（transmission backdrop pass，先渲一遍不透明的当背景）。
    //   摆场后场上有几十个透明杯 → draw call 直接翻倍（968 ≈ 455 × 2）✗
    //
    //   改用「普通透明 + 环境反射」：看起来一样是玻璃的（能透过去、有高光），
    //   只是没有折射（背景不会变形）—— 对这种小杯子来说几乎看不出来，
    //   却省掉了整整一遍场景渲染 ✓
    //
    // ★ `forceSinglePass`：three.js 对「透明 + 双面」的材质默认**画两遍**
    //   （先背面再正面，好让透明度叠得对）→ 每个透明杯 = 2 个 draw call。
    //   杯子这么小，一遍够了（three.js 自己的说明就是给这种「单面片」用的）。
    mat = new THREE.MeshPhysicalMaterial({
      color: hex,
      transparent: true,
      opacity: 0.3,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      ior: 1.5,
      specularIntensity: 1.3,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      forceSinglePass: true,
    })
  } else {
    mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.05 })
  }
  halfMaterialCache.set(color, mat)
  return mat
}

// ─────────────────────────── 杂项共享材质 ───────────────────────────

/** 拾取用的「看不见的」材质（点击热区 / 放置目标 / 碰撞体） */
let invisibleMaterial: THREE.MeshBasicMaterial | null = null
export function pickMaterial(): THREE.MeshBasicMaterial {
  if (!invisibleMaterial) {
    invisibleMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  }
  return invisibleMaterial
}

/**
 * 高亮环 / 光柱用的青色材质（按透明度共享）。
 * `depthWrite` 保持各处原来的取值（有的环要写深度、有的不要）→ 按它一起缓存。
 *
 * ★ `forceSinglePass`：透明 + 双面的材质 three.js 默认画两遍（背面 + 正面），
 *   环 / 光柱都是薄片，一遍就够 → 每个环省一个 draw call。
 */
const accentCache = new Map<string, THREE.MeshBasicMaterial>()
export function accentMaterial(opacity: number, depthWrite = false): THREE.MeshBasicMaterial {
  const key = `${opacity}:${depthWrite}`
  let m = accentCache.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: '#22d3ee',
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      depthWrite,
      forceSinglePass: true,
    })
    accentCache.set(key, m)
  }
  return m
}

/** 「合法落点」的绿环 */
const okRingCache = new Map<number, THREE.MeshBasicMaterial>()
export function okRingMaterial(opacity: number): THREE.MeshBasicMaterial {
  let m = okRingCache.get(opacity)
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    })
    okRingCache.set(opacity, m)
  }
  return m
}
