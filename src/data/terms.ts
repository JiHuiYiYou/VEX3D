/**
 * 全 app 统一的**词表**（颜色、区域名、零件名）。
 *
 * 这个文件**不 import 任何东西** —— 因为 `src/state/scoring.ts` 要能被
 * `node tools/test_scoring.ts` 直接加载（Node 原生剥离类型），那边不能有
 * 运行时依赖。所以词表单独放一份，`fieldSpec.ts` 再把它 re-export 出去。
 *
 * 命名约定（全 app 只用这一套，不再混用旧词）：
 *   · 得分物叫 **pin** / **cup**（不再叫「端子」「半体」）
 *   · 场上的 9 个桩叫 **goal**（不再叫「桩」）
 *   · 四个区域叫 **红近 / 红远 / 蓝近 / 蓝远**（不再叫「象限」「上象限」）
 */

export type ToggleState = 'red' | 'blue' | 'yellow'
export type PinColor = 'red' | 'blue' | 'yellow'
export type CupHalf = 'clear' | 'gray'
export type Alliance = 'red' | 'blue'
export type QuadrantId = 'top' | 'right' | 'bottom' | 'left'

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

/**
 * 四个区域的**统一叫法**：颜色 + 近/远。
 *
 *   红近 / 红远 = 红方联盟的两个区域（近 = 靠红方站位区那侧）
 *   蓝近 / 蓝远 = 蓝方联盟的两个区域
 *
 * 「近/远」是相对**该联盟自己**说的：红方的近端在西侧，所以 西=红近、南=红远、
 * 东=蓝近、北=蓝远。UI 里一律用这套名字。
 */
export const QUADRANT_ALLIANCE_TAG: Record<QuadrantId, string> = {
  left: '红近',
  bottom: '红远',
  right: '蓝近',
  top: '蓝远',
}

/** 区域在场地上的方位（只用于 3D 内部定位，UI 不显示） */
export const QUADRANT_DIR: Record<QuadrantId, string> = {
  left: '西',
  bottom: '南',
  right: '东',
  top: '北',
}

/** 区域所属的联盟色（由该区域里的联盟 goal 决定）：上/右 = 蓝，下/左 = 红 */
export const QUADRANT_ALLIANCE: Record<QuadrantId, Alliance> = {
  top: 'blue',
  right: 'blue',
  bottom: 'red',
  left: 'red',
}

/** toggle 的三种状态：中文名 + 颜色 */
export const TOGGLE_STATE_LABEL: Record<ToggleState, string> = {
  red: '红',
  blue: '蓝',
  yellow: '黄',
}

export const TOGGLE_STATE_COLOR: Record<ToggleState, string> = {
  red: COLORS.red,
  blue: COLORS.blue,
  yellow: COLORS.yellow,
}

/** pin / cup 半体的颜色中文名 */
export const PIN_COLOR_LABEL: Record<PinColor, string> = {
  red: '红',
  blue: '蓝',
  yellow: '黄',
}

export const CUP_HALF_LABEL: Record<CupHalf, string> = {
  clear: '透明',
  gray: '灰',
}
