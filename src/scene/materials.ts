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
    return new THREE.MeshStandardMaterial({ color: LOOK.wallPanel, roughness: 0.82 })
  }
  if (n.startsWith('276-7596-316') || n.startsWith('276-7596-317')) {
    return new THREE.MeshStandardMaterial({ color: LOOK.wallPost, roughness: 0.8 })
  }
  if (n.startsWith('276-9250-021') || n.startsWith('276-9250-022') || n.startsWith('276-9250-027')) {
    return new THREE.MeshStandardMaterial({ color: LOOK.wallCap, roughness: 0.7 })
  }
  if (n.startsWith('276-8354-404') || n.startsWith('sbt0832_276-8016') || n.startsWith('sbt0832_276-4993')) {
    return new THREE.MeshStandardMaterial({ color: '#2b313a', roughness: 0.85 })
  }
  if (n.startsWith('276-9250-032')) {
    return new THREE.MeshStandardMaterial({ color: LOOK.wallPost, roughness: 0.8 })
  }

  // ── Goal ───────────────────────────────────────────
  if (n.startsWith(NEUTRAL_ACCENT)) {
    return new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.5 })
  }
  if (goalColor && GOAL_BODY_PARTS.some((p) => n.startsWith(p))) {
    // 中立 goal：各个零件给不同的深色，形状才看得出来
    if (goalColor === COLORS.neutralGoal) {
      const tone = NEUTRAL_PART_TONE[n] ?? LOOK.goalBody
      return new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, metalness: 0.06 })
    }
    // 联盟 goal：整体联盟色，漏斗压暗一点，立体感更强
    const tone = n.startsWith('276-9250-003_master')
      ? darken(goalColor, 0.28)
      : n.startsWith('276-9250-004')
        ? darken(goalColor, 0.12)
        : goalColor
    return new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, metalness: 0.06 })
  }
  if (n.startsWith(GOAL_BASE_PLATE)) {
    return new THREE.MeshStandardMaterial({ color: '#20242a', roughness: 0.8 })
  }

  // ── 其它零件 ───────────────────────────────────────
  if (n.includes('199c') || n.includes('bright red') || n.includes('red loader')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.5 })
  }
  if (n.includes('299c') || n.includes('bright blue') || n.includes('blue loader')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.5 })
  }
  if (n.includes('425c') || n.includes('grey') || n.includes('gray')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.gray, roughness: 0.7 })
  }
  if (n.includes('clear')) {
    return new THREE.MeshPhysicalMaterial({
      color: COLORS.clear,
      transparent: true,
      opacity: 0.3,
      transmission: 0.7,
      roughness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  }
  if (n.includes('tape')) {
    return new THREE.MeshStandardMaterial({
      color: LOOK.tape,
      roughness: 0.55,
      emissive: new THREE.Color(LOOK.tape),
      emissiveIntensity: 0.16,
    })
  }
  if (n.includes('apiltag')) {
    return new THREE.MeshStandardMaterial({ color: '#e8eaee', roughness: 0.75 })
  }
  if (n.includes('840')) {
    // 9 个 Goal：中性的是黑底
    if (n.includes('red')) return new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.6 })
    if (n.includes('blue')) return new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.6 })
    return new THREE.MeshStandardMaterial({ color: COLORS.neutralGoal, roughness: 0.6 })
  }
  if (n.includes('120_') || n.includes('alliance side') || n.includes('wall')) {
    return new THREE.MeshStandardMaterial({ color: LOOK.wallPanel, roughness: 0.85 })
  }
  if (n.includes('yellow')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.5 })
  }
  return new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.85 })
}
