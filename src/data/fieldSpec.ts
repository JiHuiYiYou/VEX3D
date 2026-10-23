/**
 * 场地规格 —— 所有长度单位为 **毫米 (mm)**。
 *
 * 坐标系（与队伍 VEXAutoViz 保持一致）：
 *   X = 东, Y = 北, Z = 上, 原点 = 场地中心。
 *   three.js 是 Y-up，所以进入 three.js 时用 `toThree()` 交换 Y/Z。
 *
 * ★ 场地的几何**只有一份来源：官方 Field CAD**。
 *   `tools/extract_field.py` 把它导成 `public/assets/`（field.glb / goal_*.glb /
 *   half_*.glb / field.json），前端只认这些资产 —— 载入不到就**直接报错**，
 *   绝不用「按手册手搓的近似几何」顶替（那样看到的就不是官方场地了）。
 *
 *   这份文件里留下的是**从 CAD 实测出来的常量**（尺寸、位置），
 *   供计分引擎（node 里直接跑，不联网）和堆叠几何用。
 */

export type GoalVariant = 'alliance-red' | 'alliance-blue' | 'neutral-short' | 'neutral-tall'

// 词表（颜色、区域名、零件名）单独放在 terms.ts —— 那边没有任何 import，
// 这样 scoring.ts 也能在运行时 import 它（node 直接跑 .ts，不能有别名依赖）。
import type { Alliance, CupHalf, PinColor, QuadrantId, ToggleState } from './terms'
import { QUADRANT_ALLIANCE_TAG } from './terms'
export type { Alliance, CupHalf, PinColor, QuadrantId, ToggleState }
export {
  COLORS,
  QUADRANT_ALLIANCE_TAG,
  QUADRANT_DIR,
  QUADRANT_ALLIANCE,
  TOGGLE_STATE_LABEL,
  TOGGLE_STATE_COLOR,
  PIN_COLOR_LABEL,
  CUP_HALF_LABEL,
} from './terms'

// ─────────────────────────── 场地常量 ───────────────────────────

/** 场地边长 (mm)，12 ft —— 只在「CAD 还没载入」的空壳里用一下 */
export const FIELD_SIZE = 3657.6

// ─────────────────────────── Goal ───────────────────────────

export interface SocketSpec {
  /** 相对 Goal 底面中心的偏移 (mm) */
  x: number
  y: number
  /** socket 口沿相对底面的高度 (mm) */
  z: number
  /** 孔半径 (mm) */
  radius: number
  /** 孔深 (mm) */
  depth: number
}

export interface GoalSpec {
  id: string
  variant: GoalVariant
  /** 底面中心的世界坐标 (mm) */
  position: [number, number, number]
  /** 绕竖直轴的朝向 (rad) */
  rotationY: number
  quadrant: QuadrantId | 'midfield'
  /** 该 goal 归属的联盟（中立 goal 为 null） */
  alliance: Alliance | null
  /** goal 本体高度 (mm) */
  height: number
  /** 底面八边形外接圆半径 (mm) */
  baseRadius: number
  /** 顶面八边形外接圆半径 (mm) */
  topRadius: number
  socket: SocketSpec
}

/** 场地 12 ft，goal 位全部落在 25 in 网格上 */
function goal(
  id: string,
  variant: GoalVariant,
  x: number,
  y: number,
  quadrant: QuadrantId | 'midfield',
  alliance: Alliance | null,
  height: number,
): GoalSpec {
  return {
    id,
    variant,
    position: [x, y, 0],
    rotationY: 0,
    quadrant,
    alliance,
    height,
    // CAD 实测：八边形外接圆半径 ≈ 81.9 mm
    baseRadius: 81.9,
    topRadius: 50,
    // 顶面圆孔：CAD 实测 半径 39.61 / 深 82.03
    socket: { x: 0, y: 0, z: height - 0.5, radius: 39.61, depth: 82.03 },
  }
}

/**
 * 9 个 Goal 的位置 —— **CAD 实测值**（`public/assets/field.json`）。
 * 不是 25 in 整数网格：实测是 598.06 / 1196.12 mm（23.545 in / 47.09 in）。
 */
const a = 598.06
const b = 1196.12

export const GOALS: GoalSpec[] = [
  // 中立矮 goal (5.8" = 146.5 mm)
  goal('g-n1', 'neutral-short', -a, b, 'top', null, 146.53),
  goal('g-n2', 'neutral-short', -b, a, 'left', null, 146.53),
  goal('g-n3', 'neutral-short', b, -a, 'right', null, 146.53),
  goal('g-n4', 'neutral-short', a, -b, 'bottom', null, 146.53),
  // 中立高 goal (8.7" = 222.7 mm)，在中场
  goal('g-center', 'neutral-tall', 0, 0, 'midfield', null, 222.73),
  // 红方 goal (3.25" = 82.5 mm)
  goal('g-r1', 'alliance-red', -b, -a, 'left', 'red', 82.59),
  goal('g-r2', 'alliance-red', -a, -b, 'bottom', 'red', 82.59),
  // 蓝方 goal (3.25" = 82.5 mm)
  goal('g-b1', 'alliance-blue', a, b, 'top', 'blue', 82.59),
  goal('g-b2', 'alliance-blue', b, a, 'right', 'blue', 82.59),
]

export const GOAL_BY_ID: Record<string, GoalSpec> = Object.fromEntries(
  GOALS.map((g) => [g.id, g]),
)

/**
 * goal 的统一叫法（手册中文版用的就是 goal：联队 goal / 中立 goal / 短 goal / 长 goal）：
 *   「红近 · 红方 goal」「蓝远 · 中立 goal」「中场 · 中立高 goal」
 */
export function goalName(g: GoalSpec): string {
  if (g.quadrant === 'midfield') return '中场 · 中立高 goal'
  const region = QUADRANT_ALLIANCE_TAG[g.quadrant]
  const kind =
    g.alliance === 'red' ? '红方 goal' : g.alliance === 'blue' ? '蓝方 goal' : '中立 goal'
  return `${region} · ${kind}`
}

/** goal 的类型徽章（不带区域名） */
export function goalKind(g: GoalSpec): string {
  if (g.quadrant === 'midfield') return '中立高 goal'
  return g.alliance === 'red' ? '红方 goal' : g.alliance === 'blue' ? '蓝方 goal' : '中立 goal'
}

/** 该区域里的两个 goal */
export const QUADRANT_GOALS: Record<QuadrantId, string[]> = {
  top: ['g-n1', 'g-b1'],
  right: ['g-b2', 'g-n3'],
  bottom: ['g-n4', 'g-r2'],
  left: ['g-n2', 'g-r1'],
}

// ─────────────────────────── 得分物 ───────────────────────────

export interface HalfSpec {
  /** 半体高度 (mm) */
  height: number
  /** 窄端（尖端）半径 */
  rTop: number
  /** 宽端（翻边下方）半径 */
  rBottom: number
  /** 翻边厚度 */
  flange: number
  /** 翻边外径半径 */
  rMax?: number
}

/** CAD 实测值（public/assets/field.json） */
export const HALVES: Record<'pin' | 'cup', HalfSpec> = {
  pin: { height: 87.5, rTop: 17.82, rBottom: 29.8, flange: 7.0, rMax: 40.15 },
  cup: { height: 86.0, rTop: 29.48, rBottom: 35.8, flange: 9.34, rMax: 40.1 },
}

/** 一个完整 Pin = 两个半体（CAD 实测 165.0 mm，两个翻边交叠 10 mm） */
export const PIN_HEIGHT = 165.0
/** 一个完整 Cup = 两个半体（CAD 实测 164.5 mm） */
export const CUP_HEIGHT = 164.5

/** 堆叠时相邻两件的嵌入深度 (mm) */
export const NEST_DEPTH = 10.0

/** Pin 的 4 种配色（手册：红蓝 4 / 红黄 20 / 蓝黄 20 / 黄黄 19） */
export const PIN_VARIANTS: { id: string; label: string; halves: [PinColor, PinColor] }[] = [
  { id: 'pin-rb', label: '红 / 蓝', halves: ['red', 'blue'] },
  { id: 'pin-ry', label: '红 / 黄', halves: ['red', 'yellow'] },
  { id: 'pin-by', label: '蓝 / 黄', halves: ['blue', 'yellow'] },
  { id: 'pin-yy', label: '黄 / 黄', halves: ['yellow', 'yellow'] },
]

/** Cup = 透明半 + 不透明(灰)半 */
/**
 * Cup = 透明半 + 不透明(灰)半，**两个朝向各算一个选项**（上下对调 = 翻转）。
 * 谁能罩住谁、罩住的是哪一半，全看这个朝向 —— 所以摆件时直接选，不用再按「翻转」。
 */
export const CUP_VARIANTS: {
  id: string
  label: string
  halves: [CupHalf, CupHalf]
}[] = [
  { id: 'cup', label: '透明 / 灰', halves: ['clear', 'gray'] },
  { id: 'cup-rev', label: '灰 / 透明', halves: ['gray', 'clear'] },
]

/** 兼容旧引用：默认朝向（透明在下） */
export const CUP_VARIANT = CUP_VARIANTS[0]

// 配色和词表都在 terms.ts（见文件头的说明），这里只 re-export：
//   import { COLORS, ... } from '@/data/fieldSpec'  照旧能用

// ─────────────────────────── 场地 JSON（CAD 导出）───────────────────────────

export interface FieldJson {
  buildId: string
  source: string
  fieldSize: number
  goals: {
    id: string
    variant: GoalVariant
    position: [number, number, number]
    rotationY: number
    quadrant: QuadrantId | 'midfield'
    alliance: Alliance | null
    height: number
    baseRadius: number
    topRadius: number
    socket: SocketSpec
  }[]
  toggles: {
    id: QuadrantId
    position: [number, number, number]
    rotationZ: number
    length?: number
    width?: number
    height?: number
  }[]
  halves: { pin: HalfSpec; cup: HalfSpec }
  pinHeight: number
  cupHeight: number
  nestDepth: number
  /** 63 Pin + 56 Cup 的开局位姿（官方摆法） */
  startObjects?: {
    kind: 'pin' | 'cup'
    halves: string[]
    position: [number, number, number]
    rotation: [number, number, number]
    /** 下半 → 上半的轴向（场地系）；侧躺的件靠它算落点 */
    axis?: [number, number, number]
  }[]
}

/**
 * CAD 还没载入时的空壳 —— app 在 `loadFieldSpec()` 成功之前不会渲染任何东西，
 * 所以这份空壳只是为了让 `getFieldSpec()` 有个东西可返回。
 */
let spec: FieldJson = {
  buildId: 'none',
  source: '未载入 CAD 资产',
  fieldSize: FIELD_SIZE,
  goals: [],
  toggles: [],
  halves: HALVES,
  pinHeight: PIN_HEIGHT,
  cupHeight: CUP_HEIGHT,
  nestDepth: NEST_DEPTH,
}

export function getFieldSpec(): FieldJson {
  return spec
}

/**
 * 载入 CAD 导出的 field.json。
 *
 * ★ 载入不到就**抛错**（由 App 显示「请先生成 CAD 资产」）——
 *   绝不悄悄退回手搓几何：那会让屏幕上出现一个「看起来差不多」但其实不是
 *   官方场地的场地，比直接报错更糟。
 *
 * ★ 网络抖动要**重试**：一次 fetch 失败不等于文件不存在。
 */
export async function loadFieldSpec(url = 'assets/field.json'): Promise<FieldJson> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let res: Response | null = null
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(url)
      if (res.ok) break
      // 4xx 是真的没有；5xx 才值得重试
      if (res.status < 500) break
    } catch (err) {
      lastErr = err
    }
    if (attempt < 3) await sleep(400 * attempt)
  }
  if (!res) throw new Error(`field.json 载入失败（网络错误）`, { cause: lastErr })
  if (!res.ok) throw new Error(`field.json 载入失败（HTTP ${res.status}）`)
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('json')) throw new Error(`field.json 不是 JSON（${ct}）`)
  const json = (await res.json()) as FieldJson
  if (!json.goals?.length) throw new Error('field.json 里没有 goals')
  if (!json.toggles?.length) throw new Error('field.json 里没有 toggles')

  // 9 个 goal 必须齐全 —— 少一个就是导出出了问题，别拿常量悄悄补一个假的
  const ids = new Set(json.goals.map((g) => g.id))
  const missing = GOALS.map((g) => g.id).filter((id) => !ids.has(id))
  if (missing.length) throw new Error(`field.json 少了 goal：${missing.join(', ')}`)

  spec = json

  // 运行期一律用 CAD 的值：把 field.json 里的 goal 写进 GOAL_BY_ID。
  // 各处 import 到的都是**同一个对象**，所以这里一改，各处都能看到最新的值。
  for (const g of json.goals) GOAL_BY_ID[g.id] = g

  // 上面那份 GOALS 常量是「CAD 实测值的手抄本」，跟 field.json 对一下，别悄悄漂了
  for (const g of json.goals) {
    const ref = GOALS.find((x) => x.id === g.id)
    if (!ref) continue
    const d = Math.hypot(
      ref.position[0] - g.position[0],
      ref.position[1] - g.position[1],
    )
    if (d > 1) {
      console.warn(
        `[fieldSpec] ${g.id} 的位置和 fieldSpec.ts 里的常量差了 ${d.toFixed(1)} mm，以 CAD 为准`,
      )
    }
  }

  return spec
}

/**
 * 场地坐标 → three.js 坐标。
 *
 * 场地用的是地理习惯的右手系：X=东, Y=北, Z=上。
 * three.js 是 Y-up 且右手系，直接把 (X,Y,Z)→(X,Z,Y) 会**镜像**（左右颠倒），
 * 所以这里用 [X, Z, −Y]：等价于绕 X 轴 −90°，是纯旋转不镜像，
 * 结果是「北在上、东在右」，和真实场地照片一致。
 */
export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y]
}
