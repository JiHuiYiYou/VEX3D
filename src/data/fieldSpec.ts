/**
 * 场地规格 —— 所有长度单位为 **毫米 (mm)**。
 *
 * 坐标系（与队伍 VEXAutoViz 保持一致）：
 *   X = 东, Y = 北, Z = 上, 原点 = 场地中心。
 *   three.js 是 Y-up，所以进入 three.js 时用 `toThree()` 交换 Y/Z。
 *
 * 这份文件里的几何是**按规则手册 + 现场照片反解出的程序化兜底**。
 * `tools/extract_field.py` 跑完后会在 `public/assets/field.json` 里给出
 * CAD 实测值（更精确的 Goal 形状、socket 孔位/半径、Toggle 变换、半体尺寸），
 * 前端加载到 field.json 时会用它覆盖这里的 fallback。
 */

export type GoalVariant = 'alliance-red' | 'alliance-blue' | 'neutral-short' | 'neutral-tall'
export type QuadrantId = 'top' | 'right' | 'bottom' | 'left'
export type ToggleState = 'red' | 'blue' | 'yellow'
export type PinColor = 'red' | 'blue' | 'yellow'
export type CupHalf = 'clear' | 'gray'
export type Alliance = 'red' | 'blue'

export const QUADRANTS: QuadrantId[] = ['top', 'right', 'bottom', 'left']

/**
 * 象限的名字用**场地方向**，不用画面上下左右 —— 因为默认视角是朝西看的，
 * 画面上的上下左右跟场地方向对不上。
 *
 *   西 = 红近（红方自己的近处）、南 = 红远、东 = 蓝近、北 = 蓝远
 */
export const QUADRANT_DIR: Record<QuadrantId, string> = {
  left: '西',
  bottom: '南',
  right: '东',
  top: '北',
}

export const QUADRANT_LABEL: Record<QuadrantId, string> = {
  left: '西 · 红近',
  bottom: '南 · 红远',
  right: '东 · 蓝近',
  top: '北 · 蓝远',
}

export const QUADRANT_ALLIANCE_TAG: Record<QuadrantId, string> = {
  left: '红近',
  bottom: '红远',
  right: '蓝近',
  top: '蓝远',
}

/** 象限 → Toggle（围栏每条边中点各一个 Toggle） */
export const QUADRANT_TOGGLE: Record<QuadrantId, QuadrantId> = {
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
}

/** 象限的联盟色（由该象限内的联盟桩决定）：上/右 = 蓝，下/左 = 红 */
export const QUADRANT_ALLIANCE: Record<QuadrantId, Alliance> = {
  top: 'blue',
  right: 'blue',
  bottom: 'red',
  left: 'red',
}

// ─────────────────────────── 场地常量 ───────────────────────────

export const FIELD = {
  /** 12 ft */
  size: 3657.6,
  half: 1828.8,
  /** 单条白色胶带宽度 (mm) */
  tapeWidth: 12,
  /** 自主线「一对」胶带之间的间距 (mm)，实测 2.16 in */
  midlineGap: 55,
  /** 中场菱形顶点到中心的距离 (mm)，= 25 in */
  diamondRadius: 635,
  /** 地面垫厚度（渲染用） */
  matThickness: 25,
} as const

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
  /** 该桩归属的联盟（中立桩为 null） */
  alliance: Alliance | null
  /** 桩体高度 (mm) */
  height: number
  /** 底面八边形外接圆半径 (mm) */
  baseRadius: number
  /** 顶面八边形外接圆半径 (mm) */
  topRadius: number
  socket: SocketSpec
}

/** 场地 12 ft，桩位全部落在 25 in 网格上 */
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
  // 中立矮桩 (5.8" = 146.5 mm)
  goal('g-n1', 'neutral-short', -a, b, 'top', null, 146.53),
  goal('g-n2', 'neutral-short', -b, a, 'left', null, 146.53),
  goal('g-n3', 'neutral-short', b, -a, 'right', null, 146.53),
  goal('g-n4', 'neutral-short', a, -b, 'bottom', null, 146.53),
  // 中立高桩 (8.7" = 222.7 mm)，在中场
  goal('g-center', 'neutral-tall', 0, 0, 'midfield', null, 222.73),
  // 红方桩 (3.25" = 82.5 mm)
  goal('g-r1', 'alliance-red', -b, -a, 'left', 'red', 82.59),
  goal('g-r2', 'alliance-red', -a, -b, 'bottom', 'red', 82.59),
  // 蓝方桩 (3.25" = 82.5 mm)
  goal('g-b1', 'alliance-blue', a, b, 'top', 'blue', 82.59),
  goal('g-b2', 'alliance-blue', b, a, 'right', 'blue', 82.59),
]

export const GOAL_BY_ID: Record<string, GoalSpec> = Object.fromEntries(
  GOALS.map((g) => [g.id, g]),
)

/** 象限 → 该象限里的两个桩 */
export const QUADRANT_GOALS: Record<QuadrantId, string[]> = {
  top: ['g-n1', 'g-b1'],
  right: ['g-b2', 'g-n3'],
  bottom: ['g-n4', 'g-r2'],
  left: ['g-n2', 'g-r1'],
}

// ─────────────────────────── Toggle ───────────────────────────

export interface ToggleSpec {
  id: QuadrantId
  /** 世界坐标 (mm)：贴在围栏每条边的中点 */
  position: [number, number, number]
  /** 沿围栏的方向 (rad)，0 = 沿 X 轴 */
  rotationZ: number
  /** 长 656.2 mm */
  length: number
  /** 宽 52.2 mm */
  width: number
}

export const TOGGLES: ToggleSpec[] = [
  { id: 'top', position: [0, FIELD.half + 6, 60], rotationZ: 0, length: 656.2, width: 52.2 },
  { id: 'right', position: [FIELD.half + 6, 0, 60], rotationZ: Math.PI / 2, length: 656.2, width: 52.2 },
  { id: 'bottom', position: [0, -FIELD.half - 6, 60], rotationZ: 0, length: 656.2, width: 52.2 },
  { id: 'left', position: [-FIELD.half - 6, 0, 60], rotationZ: Math.PI / 2, length: 656.2, width: 52.2 },
]

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
export const CUP_VARIANT = { id: 'cup', label: '透明 / 灰', halves: ['clear', 'gray'] as [CupHalf, CupHalf] }

// ─────────────────────────── 配色 ───────────────────────────

export const COLORS = {
  red: '#e4002b',
  blue: '#00aeef',
  yellow: '#ffd400',
  gray: '#4a4a4a',
  clear: '#dfe9f5',
  field: '#8e8e8e',
  tape: '#f4f4f4',
  perimeter: '#262626',
  neutralGoal: '#171717',
} as const

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
  /** 63 Pin + 56 Cup 的开局位姿 */
  startObjects?: {
    kind: 'pin' | 'cup'
    halves: string[]
    position: [number, number, number]
    rotation: [number, number, number]
  }[]
}

let spec: FieldJson = {
  buildId: 'fallback',
  source: 'built-in fallback (rules + field photo photogrammetry)',
  fieldSize: FIELD.size,
  goals: GOALS,
  toggles: TOGGLES.map((t) => ({
    id: t.id,
    position: t.position,
    rotationZ: t.rotationZ,
  })),
  halves: HALVES,
  pinHeight: PIN_HEIGHT,
  cupHeight: CUP_HEIGHT,
  nestDepth: NEST_DEPTH,
}

export function getFieldSpec(): FieldJson {
  return spec
}

/** 载入 CAD 导出的 field.json；失败或不全则保留 fallback */
export async function loadFieldSpec(url = 'assets/field.json'): Promise<FieldJson> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) throw new Error(`不是 JSON（${ct}）`)
    const json = (await res.json()) as FieldJson
    if (!json.goals?.length) throw new Error('没有 goals')

    // CAD 导出的 Goal 可能不全（早期版本少了 2 个中立矮桩），缺的就用兜底数据补齐
    const byId = new Map(json.goals.map((g) => [g.id, g]))
    const goals = GOALS.map((fb) => byId.get(fb.id) ?? fb)
    for (const g of json.goals) if (!goals.find((x) => x.id === g.id)) goals.push(g)

    spec = {
      ...json,
      goals,
    }
    return spec
  } catch (err) {
    console.info('[fieldSpec] 未载入 CAD 导出的 field.json，使用内置兜底数据：', err)
    return spec
  }
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
