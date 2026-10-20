/**
 * V5RC Override 计分引擎
 * =====================================================================
 * 全部规则逻辑集中在本文件。改动规则口径只改这里。
 *
 * 规则原文（VEX V5 2026-2027 Override Game Manual v0.1，中英双语已交叉核对）：
 *
 * <SC2> A Pin is considered Placed if it meets all of the following criteria at the end of the Match:
 *   a. The Pin is partially or entirely nested with a Goal, or with a Cup that is partially or
 *      entirely nested to another Placed Pin.
 *   b. That half of the Cup only contains one Pin.
 *   nested = one half of a Pin is partially or completely contained within the inner volume of the
 *   Cup, i.e. the Pin is breaking an imaginary plane at the opening of a Cup, in any way.
 *
 * <SC3> Each Pin consists of two halves. Each Placed Pin can have one or two Scored halves.
 *   A half counts as Placed for the corresponding Alliance if it is either
 *   nested inside the transparent half of a Cup  OR  not covered by a Cup.
 *   a. 红色 Pin → 红方联队
 *   b. 蓝色 Pin → 蓝方联队
 *   c. 黄色 Pin → 拥有这个 Pin 的联队（见 <SC5>）
 *
 * <SC4> Toggle 只有 3 种可计分朝向（红 / 蓝 / 黄）；未就位则为中立，双方都不拥有。
 *
 * <SC5> a. 象限内的黄色 Pin 由该象限 Toggle 的颜色决定归属；Toggle 设为黄色则不得分。
 *      b. 中场区域内的黄色 Pin 由中场机器人数量多的一方拥有；相等则双方都不拥有。
 *
 * 分值：联盟色 Pin 半 5 分，被拥有的黄色 Pin 半 10 分。
 *
 * ── 本引擎采用的物理模型（与 CAD 实测几何对表，见 §七 开放项）──
 *   · 一个「件」= 一个完整的 Pin（两个同色系半体）或一个完整的 Cup（透明半 + 灰半）。
 *   · 堆栈自下而上：stack[0] 最靠近 Goal。
 *   · 罩住关系：stack[i+1] 罩住 stack[i]。若 stack[i+1] 是 Cup，罩住它的是该 Cup 的
 *     **下半**（把东西装进去的那一半）；下半透明 → 下方的 Pin 半体「嵌在透明半体里」→ 计分；
 *     下半不透明(灰) → 「被不透明杯遮挡」→ 不计分。
 *   · 若 stack[i+1] 是 Pin，规则只承认「被 Cup 覆盖」才挡分，所以不算遮挡。
 *   · 一个 Pin 的下半只被自己的上半（非 Cup）盖住 → 永远计分；上半可能被上方的 Cup 挡住。
 *     这正好对应手册说的「一个 placed 的 Pin 可以有 1 个或 2 个得分端子」。
 *   · Placed 判定（<SC2>a）：只有「直接嵌在 Goal 上」或「嵌在一个与已 placed 的 Pin 啮合的
 *     Cup 里」的 Pin 才是 placed；直接压在另一个 Pin 上（中间没有 Cup）的不算 placed。
 */

import type { Alliance, CupHalf, GoalSpec, PinColor, QuadrantId, ToggleState } from '@/data/fieldSpec'

export type StackItem =
  | { id: string; kind: 'pin'; halves: [PinColor, PinColor] }
  | { id: string; kind: 'cup'; halves: [CupHalf, CupHalf] }

export interface HalfResult {
  goalId: string
  itemId: string
  /** 0 = 下半, 1 = 上半 */
  halfIndex: 0 | 1
  color: PinColor
  /** 是否满足 <SC2> 的 placed 条件 */
  placed: boolean
  /** 是否计分（满足 <SC3>） */
  scored: boolean
  alliance: Alliance | null
  points: number
  /** 判定理由，直接显示给用户，方便按官方口径核对 */
  reason: string
}

export interface GoalScore {
  red: number
  blue: number
  placedHalves: number
  scoredHalves: number
}

export interface ScoreResult {
  red: number
  blue: number
  halves: HalfResult[]
  perGoal: Record<string, GoalScore>
  /** 被扣掉的（不计分的）半体数量 */
  blocked: number
}

export interface ScoringInput {
  stacks: Record<string, StackItem[]>
  toggles: Record<QuadrantId, ToggleState>
  goals: GoalSpec[]
  /** 中场机器人数量（用户没选机器人功能，默认双方 0 台 → 中场黄色 Pin 0 分） */
  midfieldCounts?: { red: number; blue: number }
}

const POINTS_ALLIANCE = 5
const POINTS_YELLOW = 10

/** <SC5> 黄色 Pin 的拥有方 */
export function yellowOwner(
  goal: GoalSpec,
  toggles: Record<QuadrantId, ToggleState>,
  midfieldCounts: { red: number; blue: number },
): { owner: Alliance | null; reason: string } {
  if (goal.quadrant === 'midfield') {
    // <SC5>b 中场区域：机器人数量多的一方拥有
    if (midfieldCounts.red > midfieldCounts.blue) {
      return { owner: 'red', reason: '中场红方机器人更多 → 归红方' }
    }
    if (midfieldCounts.blue > midfieldCounts.red) {
      return { owner: 'blue', reason: '中场蓝方机器人更多 → 归蓝方' }
    }
    return { owner: null, reason: '中场双方机器人数量相同 → 双方都不拥有，不得分' }
  }
  // <SC5>a 象限内：由该象限 Toggle 的颜色决定
  const state = toggles[goal.quadrant]
  if (state === 'red') return { owner: 'red', reason: '该象限 Toggle 设为红色 → 归红方' }
  if (state === 'blue') return { owner: 'blue', reason: '该象限 Toggle 设为蓝色 → 归蓝方' }
  return { owner: null, reason: '该象限 Toggle 设为黄色 → 谁都不拥有，黄色 Pin 不得分' }
}

/**
 * <SC2>a：判断栈里每一件是否为 placed 的 Pin。
 * 只有 Pin 需要判定；Cup 只是「罩子」，不参与 placed。
 */
function computePlacedFlags(stack: StackItem[]): boolean[] {
  const placed = stack.map(() => false)
  for (let i = 0; i < stack.length; i++) {
    const item = stack[i]
    if (item.kind !== 'pin') continue
    if (i === 0) {
      // 直接嵌在 Goal 上
      placed[i] = true
    } else {
      const below = stack[i - 1]
      if (below.kind === 'cup') {
        // 嵌在一个 Cup 里；该 Cup 必须与「另一个已 placed 的 Pin」啮合
        if (i - 2 >= 0 && placed[i - 2]) placed[i] = true
      }
      // below 是 Pin → 既没嵌在 Goal 上，也没嵌在 Cup 里 → 不算 placed
    }
  }
  return placed
}

export function scoreGoal(
  goal: GoalSpec,
  stack: StackItem[],
  toggles: Record<QuadrantId, ToggleState>,
  midfieldCounts: { red: number; blue: number },
): { halves: HalfResult[]; red: number; blue: number } {
  const halves: HalfResult[] = []
  let red = 0
  let blue = 0
  const placedFlags = computePlacedFlags(stack)

  for (let i = 0; i < stack.length; i++) {
    const item = stack[i]
    if (item.kind !== 'pin') continue
    const below = stack[i - 1]
    const above = stack[i + 1]
    /** 本件套在哪个 Cup 里（下面的那个杯的腔体） */
    const belowCup = below && below.kind === 'cup' ? below : null
    /** 罩在本件上面的那个 Cup */
    const aboveCup = above && above.kind === 'cup' ? above : null

    for (const halfIndex of [0, 1] as const) {
      const color = item.halves[halfIndex]
      const placed = placedFlags[i]

      // ── <SC3> 遮挡判定 ────────────────────────────────────────────
      // 一个 Pin 有两个端子：
      //  · 下半可能套在**下面那个 Cup** 的腔体里 → 被那个 Cup 的下半罩着
      //  · 上半可能被**上面那个 Cup** 罩着
      // 罩住的那一半若是**不透明(灰)** → 该端子不得分；
      // 若是**透明** → 「嵌在透明杯半体内」→ 仍然计分。
      let scored: boolean
      let coverReason: string
      if (halfIndex === 0) {
        if (belowCup) {
          if (belowCup.halves[0] === 'clear') {
            scored = placed
            coverReason = '下半嵌在透明杯半体内 → 计分'
          } else {
            scored = false
            coverReason = '下半被不透明(灰)杯罩住 → 不计分'
          }
        } else {
          scored = placed
          coverReason = '下半未被 Cup 覆盖'
        }
      } else if (aboveCup) {
        if (aboveCup.halves[0] === 'clear') {
          scored = placed
          coverReason = '上半嵌在透明杯半体内 → 计分'
        } else {
          scored = false
          coverReason = '上半被不透明(灰)杯遮挡 → 不计分'
        }
      } else {
        scored = placed
        coverReason = '上半露在外面，未被 Cup 覆盖'
      }

      if (!placed) {
        coverReason = '未嵌套在 Goal 或与已 placed 的 Pin 啮合的 Cup 中 → 不算 placed'
      }

      // ── 联盟归属 ──────────────────────────────────────────────────
      let alliance: Alliance | null = null
      let points = 0
      let ownReason: string
      if (color === 'red') {
        alliance = 'red'
        points = POINTS_ALLIANCE
        ownReason = '红色端子 → 红方联队'
      } else if (color === 'blue') {
        alliance = 'blue'
        points = POINTS_ALLIANCE
        ownReason = '蓝色端子 → 蓝方联队'
      } else {
        const { owner, reason } = yellowOwner(goal, toggles, midfieldCounts)
        alliance = owner
        points = POINTS_YELLOW
        ownReason = reason
      }

      const finalScored = scored && alliance !== null
      const pointsAwarded = finalScored ? points : 0
      if (finalScored) {
        if (alliance === 'red') red += pointsAwarded
        else blue += pointsAwarded
      }

      halves.push({
        goalId: goal.id,
        itemId: item.id,
        halfIndex,
        color,
        placed,
        scored: finalScored,
        alliance: finalScored ? alliance : null,
        points: pointsAwarded,
        reason: finalScored ? `${ownReason}｜${coverReason}` : `${coverReason}｜${ownReason}`,
      })
    }
  }

  return { halves, red, blue }
}

export function scoreField(input: ScoringInput): ScoreResult {
  const { stacks, toggles, goals } = input
  const midfieldCounts = input.midfieldCounts ?? { red: 0, blue: 0 }
  const halves: HalfResult[] = []
  const perGoal: Record<string, GoalScore> = {}
  let red = 0
  let blue = 0
  let blocked = 0

  for (const goal of goals) {
    const stack = stacks[goal.id] ?? []
    const r = scoreGoal(goal, stack, toggles, midfieldCounts)
    halves.push(...r.halves)
    red += r.red
    blue += r.blue
    perGoal[goal.id] = {
      red: r.red,
      blue: r.blue,
      placedHalves: r.halves.filter((h) => h.placed).length,
      scoredHalves: r.halves.filter((h) => h.scored).length,
    }
    blocked += r.halves.filter((h) => h.placed && !h.scored).length
  }

  return { red, blue, halves, perGoal, blocked }
}
