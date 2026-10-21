import { CUP_HEIGHT, GOAL_BY_ID, HALVES, PIN_HEIGHT } from '@/data/fieldSpec'
import type { GoalSpec } from '@/data/fieldSpec'
import type { StackItem } from '@/state/scoring'

/**
 * 堆叠的纯几何计算（3D 场景、拖拽幽灵件、端到端脚本共用一份）。
 *
 * ── 半体的局部约定（CAD 导出与程序化几何一致）──
 *   翻边（最宽的那圈）在原点，半体沿 **-Y** 延伸，尖端/杯口在 y = -height。
 *   旋转 0 → 翻边在上、尖端在下；绕 X 轴转 π → 翻边在下、尖端在上。
 *
 * ── 两种拼法（CAD 装配树实测）──
 *   · **Pin = 翻边对翻边** → 线轴：两个尖端朝外，腰（翻边）在中间，高 165.0。
 *   · **Cup = 杯口对杯口** → 沙漏：两个宽沿在外，腰（两个杯口）在中间，高 164.5。
 *     （CAD 里 Cup 的 Clear 半在 -85 不旋转、Dark Gray 半在 +85 且绕 Z 转 180°，
 *       两个杯口因此在中间接合。）
 *
 * ── 嵌套 ──
 *   · Cup 放在 Pin 上：Cup 的下沿坐在 Pin 的腰上      → +82.5
 *   · Pin 放在 Cup 上：Pin 的腰坐在 Cup 的上沿上      → +82.0
 *   · Pin 直接放在 Goal 上：腰坐在 socket 孔沿上，尖端进到喉口。
 */
export const PIN_WAIST = PIN_HEIGHT / 2 // 82.5
/** Pin 的腰坐在 Cup 上沿时，Pin 底端相对 Cup 底端的高度 */
export const NEST_ON_CUP = CUP_HEIGHT - PIN_WAIST // 82.0
/**
 * 接触面留一点缝：Cup 的下沿（Ø80.2）和 Pin 的腰部翻边（Ø80.3）几乎同径且共面，
 * 不留缝会闪 z-fighting 麻点。0.3 mm 在 12 ft 的场地上肉眼不可见。
 */
export const SEAT_EPS = 0.3

export function halfHeight(item: StackItem) {
  return item.kind === 'pin' ? HALVES.pin.height : HALVES.cup.height
}

/** 一个完整 Pin / Cup 的高度（CAD 实测 165 / 164.5） */
export function itemHeight(item: StackItem) {
  return item.kind === 'pin' ? PIN_HEIGHT : CUP_HEIGHT
}

/** 两个半体交叠的深度（Pin 10 mm = 翻边交叠；Cup 7.5 mm = 杯口交叠） */
export function halfOverlap(item: StackItem) {
  return halfHeight(item) * 2 - itemHeight(item)
}

/**
 * ★ 一个半体在 3D 里的摆放。
 *
 *   Pin（翻边对翻边 · 线轴）
 *     halves[0] 尖端朝下 → rotX = 0，  翻边在 baseY + 87.5
 *     halves[1] 尖端朝上 → rotX = π，  翻边在 baseY + 77.5（与下半交叠 10）
 *
 *   Cup（杯口对杯口 · 沙漏）★ 修正点：以前 Cup 也按翻边对翻边拼，是错的
 *     halves[0] 宽沿在下、杯口朝上 → rotX = π，翻边（宽沿）在 baseY
 *     halves[1] 宽沿在上、杯口朝下 → rotX = 0， 翻边（宽沿）在 baseY + 164.5
 *     两个杯口因此交叠 7.5（= 2×86 − 164.5），腰部正落在整件中间
 */
export function halfTransform(
  item: StackItem,
  halfIndex: 0 | 1,
  itemBaseY: number,
): { pos: [number, number, number]; rotX: number } {
  if (item.kind === 'pin') {
    const h = halfHeight(item)
    if (halfIndex === 0) return { pos: [0, itemBaseY + h, 0], rotX: 0 }
    return { pos: [0, itemBaseY + h - halfOverlap(item), 0], rotX: Math.PI }
  }
  if (halfIndex === 0) return { pos: [0, itemBaseY, 0], rotX: Math.PI }
  return { pos: [0, itemBaseY + itemHeight(item), 0], rotX: 0 }
}

export interface StackSlot {
  item: StackItem
  /** 该件底端的高度（Goal 局部坐标，mm） */
  baseY: number
}

/** 栈底那件（直接嵌在 Goal 上的 Pin）的落点：腰架在 socket 孔沿上，尖端进到喉口 */
export function pinBaseOnGoal(goal: GoalSpec): number {
  return Math.max(goal.socket.z - PIN_WAIST, goal.socket.z - goal.socket.depth)
}

/** 栈里每一件的落点（baseY = 该件**底端**高度，Goal 局部坐标） */
export function layoutStack(goal: GoalSpec, stack: StackItem[]): StackSlot[] {
  const out: StackSlot[] = []
  for (const item of stack) {
    const prev = out[out.length - 1]
    let baseY: number
    if (!prev) {
      baseY = pinBaseOnGoal(goal)
    } else if (prev.item.kind === 'pin' && item.kind === 'cup') {
      baseY = prev.baseY + PIN_WAIST + SEAT_EPS
    } else if (prev.item.kind === 'cup' && item.kind === 'pin') {
      baseY = prev.baseY + NEST_ON_CUP + SEAT_EPS
    } else {
      // 非法组合的兜底：不重叠
      baseY = prev.baseY + itemHeight(prev.item)
    }
    out.push({ item, baseY })
  }
  return out
}

/** 栈顶（最后一件的顶端）高度 */
export function stackTopY(goal: GoalSpec, stack: StackItem[]): number {
  const slots = layoutStack(goal, stack)
  const last = slots[slots.length - 1]
  return last ? last.baseY + itemHeight(last.item) : goal.socket.z
}

/** 再放一件时它的落点（kind = 即将放入的那一件） */
export function nextBaseY(
  goal: GoalSpec,
  stack: StackItem[],
  kind: 'pin' | 'cup',
): number {
  const top = layoutStack(goal, stack).at(-1)
  if (!top) return pinBaseOnGoal(goal)
  return kind === 'cup'
    ? top.baseY + PIN_WAIST + SEAT_EPS
    : top.baseY + NEST_ON_CUP + SEAT_EPS
}

// 开发模式下暴露给端到端脚本（tools/verify_ui.py 断言嵌套偏移用）
if (import.meta.env.DEV) {
  ;(window as unknown as { __stackLayout?: unknown }).__stackLayout = (
    goalId: string,
    stack: StackItem[],
  ) => {
    const goal = GOAL_BY_ID[goalId]
    if (!goal) return []
    return layoutStack(goal, stack).map((s) => ({ id: s.item.id, baseY: s.baseY }))
  }
}
