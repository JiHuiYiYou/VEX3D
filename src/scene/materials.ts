import * as THREE from 'three'
import { COLORS } from '@/data/fieldSpec'

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

/**
 * 按**零件名**指派材质。
 *
 * 官方 CAD 里所有零件的颜色都是同一个 SolidWorks 默认值（0.792/0.820/0.933），
 * 没有可用信息，所以颜色完全由我们按 PRODUCT 名指派。
 *
 * @param goalColor 该 Goal 的主色（红方 goal / 蓝方 goal / 中立黑），用于本体零件
 */
export function materialFor(name: string, goalColor?: string): THREE.Material {
  const n = (name || '').toLowerCase()
  if (n.startsWith(NEUTRAL_ACCENT)) {
    return new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.5 })
  }
  if (goalColor && GOAL_BODY_PARTS.some((p) => n.startsWith(p))) {
    return new THREE.MeshStandardMaterial({ color: goalColor, roughness: 0.6, metalness: 0.05 })
  }
  if (n.startsWith(GOAL_BASE_PLATE)) {
    return new THREE.MeshStandardMaterial({ color: '#20242a', roughness: 0.8 })
  }
  if (n.includes('199c') || n.includes('bright red') || n.includes('red loader')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.55 })
  }
  if (n.includes('299c') || n.includes('bright blue') || n.includes('blue loader')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.55 })
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
    return new THREE.MeshStandardMaterial({ color: COLORS.tape, roughness: 0.7 })
  }
  if (n.includes('apiltag')) {
    return new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.8 })
  }
  if (n.includes('840')) {
    // 9 个 Goal：中性的是黑底
    if (n.includes('red')) return new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.6 })
    if (n.includes('blue')) return new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.6 })
    return new THREE.MeshStandardMaterial({ color: COLORS.neutralGoal, roughness: 0.6 })
  }
  if (n.includes('120_') || n.includes('alliance side') || n.includes('wall')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.perimeter, roughness: 0.85 })
  }
  if (n.includes('yellow')) {
    return new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.5 })
  }
  return new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.85 })
}
