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
 * ── 本引擎采用的物理模型（CAD 装配树实测 + 手册图 SC5-1/2）──
 *   · 一个「件」= 一个完整的 Pin（两个同色系半体）或一个完整的 Cup（透明半 + 灰半）。
 *   · **Pin = 翻边对翻边**（线轴，腰在中间，高 165）；**Cup = 杯口对杯口**（沙漏，
 *     两端敞口宽沿、中间 Ø59 细腰，高 164.5）—— 两种件形状不同，别混。
 *   · 堆栈自下而上：stack[0] 最靠近 Goal。
 *   · **罩住关系（关键）**：
 *       · Pin 的**上半**被**上面那个 Cup 的下半**罩住  → 用 aboveCup.halves[0] 判
 *       · Pin 的**下半**被**下面那个 Cup 的上半**罩住  → 用 belowCup.halves[1] 判
 *     罩住的那一半若是**透明(clear)** → 该端子「嵌在透明半体里」→ 照常计分；
 *     若是**不透明(gray)** → 「被不透明杯遮挡」→ 不得分。
 *     等价的说法：Cup 的下半罩住它**下面**那个 Pin 的上半；Cup 的上半罩住它**上面**那个 Pin 的下半。
 *   · Goal 不是 Cup，**不挡分**：直接放在 Goal 上的 Pin 两半都照常计分。
 *   · 摆放规则：Pin 只能放在 Cup 上，或直接放在 Goal 上；Cup 只能放在 Pin 上。
 *     所以栈必然是 Pin/Cup/Pin/Cup… 交替，第 0 件是直接嵌在 Goal 上的 Pin。
 *   · Placed 判定（<SC2>a）：直接嵌在 Goal 上的 Pin 是 placed；嵌在一个「与已 placed 的
 *     Pin 啮合的 Cup」里的 Pin 也是 placed；压在另一个 Pin 上（中间没有 Cup）的不算。
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
  /** 是否被 Cup 罩住（罩住的那一半是透明还是灰决定计不计分） */
  covered: boolean
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
 *
 * 合法摞是 Pin/Cup 交替：栈底 Pin 直接嵌在 Goal 上 → placed；
 * 其余 Pin 嵌在一个 Cup 里，而那个 Cup 又与它下面那个 Pin 啮合 → placed。
 */
function computePlacedFlags(stack: StackItem[]): boolean[] {
  const placed = stack.map(() => false)
  for (let i = 0; i < stack.length; i++) {
    const item = stack[i]
    if (item.kind !== 'pin') continue
    if (i === 0) {
      // 直接嵌在 Goal 上
      placed[i] = true
      continue
    }
    const below = stack[i - 1]
    if (below.kind !== 'cup') continue
    // 嵌在一个 Cup 里；该 Cup 必须与「另一个已 placed 的 Pin」啮合
    if (i - 2 >= 0 && placed[i - 2]) placed[i] = true
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
      //  · 下半被**下面那个 Cup 的上半**罩住（Cup 的上半正好罩住它上面那件的下半）
      //  · 上半被**上面那个 Cup 的下半**罩住
      // 罩住的那一半若是**不透明(灰)** → 该端子不得分；
      // 若是**透明** → 「嵌在透明杯半体内」→ 仍然计分。
      let scored: boolean
      let coverReason: string
      let covered = false
      if (halfIndex === 0) {
        if (belowCup) {
          covered = true
          if (belowCup.halves[1] === 'clear') {
            scored = placed
            coverReason = '下半嵌在下方 Cup 的上半（透明半）里 → 计分'
          } else {
            scored = false
            coverReason = '下半被下方 Cup 的上半（不透明/灰半）遮住 → 不计分'
          }
        } else {
          scored = placed
          coverReason = '下半未被 Cup 覆盖 → 计分'
        }
      } else if (aboveCup) {
        covered = true
        if (aboveCup.halves[0] === 'clear') {
          scored = placed
          coverReason = '上半嵌在上方 Cup 的下半（透明半）里 → 计分'
        } else {
          scored = false
          coverReason = '上半被上方 Cup 的下半（不透明/灰半）遮住 → 不计分'
        }
      } else {
        scored = placed
        coverReason = '上半未被 Cup 覆盖 → 计分'
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
        covered,
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
    blocked += r.halves.filter((h) => h.covered && !h.scored).length
  }

  return { red, blue, halves, perGoal, blocked }
}

export interface PlacementCheck {
  ok: boolean
  /** 不合法时给用户看的中文原因 */
  reason: string
}

/**
 * 摆放合法性（用户给定口径）：
 *
 *   · **Pin 只能放在 Cup 上，或直接放在 Goal 上**（作为摞的最底下一个）
 *   · **Cup 只能放在 Pin 上**
 *   · Pin 叠 Pin、Cup 叠 Cup、Cup 直接放 Goal → 非法，UI 应当拒绝放置
 *
 * 所以合法的摞必然是 Pin / Cup / Pin / Cup … 交替。
 *
 * 注意：本文件被 `node tools/test_scoring.ts` 直接加载（原生剥离类型），
 * 所以这里**只能用 type-only import**，不能引运行时依赖。
 */
export function checkPlacement(kind: 'pin' | 'cup', stack: StackItem[]): PlacementCheck {
  const top = stack[stack.length - 1]
  if (!top) {
    return kind === 'pin'
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'Cup 不能直接放在桩上：桩上只能先放 Pin' }
  }
  if (kind === 'pin') {
    return top.kind === 'cup'
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'Pin 不能叠在 Pin 上：Pin 只能放在 Cup 上' }
  }
  return top.kind === 'pin'
    ? { ok: true, reason: '' }
    : { ok: false, reason: 'Cup 不能叠在 Cup 上：Cup 只能放在 Pin 上' }
}
