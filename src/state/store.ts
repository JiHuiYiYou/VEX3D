import { create } from 'zustand'
import type { QuadrantId, ToggleState } from '@/data/fieldSpec'
import { PIN_VARIANTS, CUP_VARIANT, GOALS, QUADRANT_TOGGLE } from '@/data/fieldSpec'
import { checkPlacement } from './scoring'
import type { StackItem } from './scoring'

export type DragPayload =
  | { kind: 'palette'; item: StackItem; from: 'pin' | 'cup' }
  | { kind: 'stack'; item: StackItem; goalId: string }

/** 画质档位：给弱机器（学校笔记本 / 投影仪）留的退路 */
export type Quality = 'high' | 'medium' | 'low'

export const QUALITY_LABEL: Record<Quality, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export interface AppState {
  /** 每个桩上的堆栈，数组顺序 = 自下而上 */
  stacks: Record<string, StackItem[]>
  /** 4 个 Toggle 的状态 */
  toggles: Record<QuadrantId, ToggleState>

  /** 当前选中的桩（非空 = 编辑模式，左侧面板显示调色板） */
  selectedGoalId: string | null
  /** 当前选中的已放置得分物 */
  selectedItemId: string | null
  /** 左侧面板的「翻转」总开关 */
  paletteFlipped: boolean

  /** 正在拖拽的东西 */
  dragging: DragPayload | null
  /** 拖拽时悬停的目标桩 */
  hoverGoalId: string | null
  /** 拖拽时指针是否在垃圾桶上 */
  overTrash: boolean
  /**
   * 拖拽时当前落点的判定。
   * legal=false 时目标不高亮、幽灵染红，松手会被拒绝。
   */
  dropTarget: { goalId: string; legal: boolean; reason: string } | null
  /** 最近一次被拒绝的放置（UI 弹提示用） */
  placeError: { goalId: string; reason: string; at: number } | null
  /** 画质 */
  quality: Quality
  /** 是否把象限按 Toggle 状态染色 */
  showQuadrantTint: boolean
  /** 鼠标悬停的象限（高亮用） */
  hoverQuadrant: QuadrantId | null

  // ── actions ──
  selectGoal: (id: string | null) => void
  selectItem: (id: string | null) => void
  togglePaletteFlip: () => void
  /** 放置（非法叠放会被拒绝，返回 false 并写 placeError） */
  placeItem: (goalId: string, item: StackItem) => boolean
  removeItem: (goalId: string, itemId: string) => void
  flipItem: (goalId: string, itemId: string) => void
  setToggle: (q: QuadrantId, state: ToggleState) => void
  cycleToggle: (q: QuadrantId) => void
  setDragging: (d: DragPayload | null) => void
  setHoverGoal: (id: string | null) => void
  setOverTrash: (v: boolean) => void
  /** 拖拽时更新落点判定（内部算合法性） */
  setDropTarget: (goalId: string | null) => void
  clearPlaceError: () => void
  setQuality: (q: Quality) => void
  toggleQuadrantTint: () => void
  setHoverQuadrant: (q: QuadrantId | null) => void
  resetField: () => void
}

let uid = 0
export const newId = (prefix: string) => `${prefix}-${++uid}-${Date.now().toString(36)}`

const TOGGLE_CYCLE: ToggleState[] = ['red', 'blue', 'yellow']

/**
 * Toggle 只有 **3 个有效朝向**：红 / 蓝 / 黄（手册 <SC4>）。
 * 黄色 = 「谁都不拥有该象限的黄色 Pin」；现场照片里场上的 4 个 Toggle 默认就是黄的。
 * 没就位（不是有效朝向）按规则同样不得分，所以不再单拎一个「中立」状态出来。
 */
const initialToggles = (): Record<QuadrantId, ToggleState> => ({
  top: 'yellow',
  right: 'yellow',
  bottom: 'yellow',
  left: 'yellow',
})

/** 画质初值：可以用 ?quality=low 强制（弱机器 / 自动化测试） */
const initialQuality = (): Quality => {
  const q = new URLSearchParams(window.location.search).get('quality')
  return q === 'low' || q === 'medium' || q === 'high' ? q : 'high'
}

export const useApp = create<AppState>((set, get) => ({
  stacks: {},
  toggles: initialToggles(),

  selectedGoalId: null,
  selectedItemId: null,
  paletteFlipped: false,

  dragging: null,
  hoverGoalId: null,
  overTrash: false,
  dropTarget: null,
  placeError: null,
  quality: initialQuality(),
  showQuadrantTint: true,
  hoverQuadrant: null,

  selectGoal: (id) =>
    set((s) => ({
      selectedGoalId: id,
      selectedItemId: id === null ? null : s.selectedItemId,
    })),

  selectItem: (id) => set({ selectedItemId: id }),

  togglePaletteFlip: () => set((s) => ({ paletteFlipped: !s.paletteFlipped })),

  /**
   * 放置的唯一入口：先判合法性，非法就**拒绝**（并记下原因给 UI 弹提示）。
   *
   * 规则（用户口径）：Pin 只能放在 Cup 上或直接放在 Goal 上；Cup 只能放在 Pin 上。
   */
  placeItem: (goalId, item) => {
    const stack = get().stacks[goalId] ?? []
    const check = checkPlacement(item.kind, stack)
    if (!check.ok) {
      set({ placeError: { goalId, reason: check.reason, at: Date.now() } })
      return false
    }
    set((s) => ({
      stacks: { ...s.stacks, [goalId]: [...(s.stacks[goalId] ?? []), item] },
      placeError: null,
    }))
    return true
  },

  removeItem: (goalId, itemId) =>
    set((s) => {
      const stack = s.stacks[goalId] ?? []
      return {
        stacks: { ...s.stacks, [goalId]: stack.filter((i) => i.id !== itemId) },
        selectedItemId: s.selectedItemId === itemId ? null : s.selectedItemId,
      }
    }),

  /**
   * 翻转：交换上下两半。
   *
   * 对 Pin：换的是哪一半在上面（颜色变了）。
   * 对 Cup：换的是**哪一半罩住了谁** —— halves[0] = 下半（罩住它下面那个 Pin 的上半），
   * halves[1] = 上半（罩住它上面那个 Pin 的下半）。翻过来就换了一对透明/不透明，
   * 直接决定被罩住的那一半计不计分。
   */
  flipItem: (goalId, itemId) =>
    set((s) => {
      const stack = s.stacks[goalId] ?? []
      const next = stack.map((i): StackItem => {
        if (i.id !== itemId) return i
        return i.kind === 'pin'
          ? { ...i, halves: [i.halves[1], i.halves[0]] }
          : { ...i, halves: [i.halves[1], i.halves[0]] }
      })
      return { stacks: { ...s.stacks, [goalId]: next } }
    }),

  setToggle: (q, state) => set((s) => ({ toggles: { ...s.toggles, [q]: state } })),

  cycleToggle: (q) =>
    set((s) => {
      const cur = s.toggles[q] ?? 'yellow'
      const next = TOGGLE_CYCLE[(TOGGLE_CYCLE.indexOf(cur) + 1) % TOGGLE_CYCLE.length]
      return { toggles: { ...s.toggles, [q]: next } }
    }),

  setDragging: (d) =>
    set({
      dragging: d,
      hoverGoalId: null,
      overTrash: false,
      dropTarget: null,
      // 只在**开始**新拖拽时清掉旧提示；结束时（d === null）要保留刚拒绝的那条
      placeError: d ? null : get().placeError,
    }),
  setHoverGoal: (id) => {
    if (get().hoverGoalId !== id) set({ hoverGoalId: id })
  },
  setOverTrash: (v) => {
    if (get().overTrash !== v) set({ overTrash: v })
  },

  /** 拖拽时更新落点判定（只有「从面板拖新件」才需要判定） */
  setDropTarget: (goalId) => {
    const s = get()
    if (!goalId || s.dragging?.kind !== 'palette') {
      if (s.dropTarget !== null) set({ dropTarget: null })
      return
    }
    const check = checkPlacement(s.dragging.item.kind, s.stacks[goalId] ?? [])
    const cur = s.dropTarget
    if (cur && cur.goalId === goalId && cur.legal === check.ok && cur.reason === check.reason) {
      return
    }
    set({ dropTarget: { goalId, legal: check.ok, reason: check.reason } })
  },

  clearPlaceError: () => set({ placeError: null }),

  setQuality: (q) => set({ quality: q }),

  toggleQuadrantTint: () => set((s) => ({ showQuadrantTint: !s.showQuadrantTint })),
  setHoverQuadrant: (q) => {
    if (get().hoverQuadrant !== q) set({ hoverQuadrant: q })
  },

  resetField: () =>
    set({
      stacks: {},
      toggles: initialToggles(),
      selectedGoalId: null,
      selectedItemId: null,
      paletteFlipped: false,
      dragging: null,
      hoverGoalId: null,
      overTrash: false,
      dropTarget: null,
      placeError: null,
    }),
}))

// 开发模式下把 store 挂到 window，方便端到端脚本检查内部状态
if (import.meta.env.DEV) {
  ;(window as unknown as { __vex3d?: typeof useApp }).__vex3d = useApp
}

/** 从左侧面板生成一个待放置的件（受「翻转」开关影响） */
export function makePaletteItem(variantId: string, flipped: boolean): StackItem | null {
  const pin = PIN_VARIANTS.find((p) => p.id === variantId)
  if (pin) {
    const halves = (flipped ? [pin.halves[1], pin.halves[0]] : pin.halves) as [typeof pin.halves[0], typeof pin.halves[1]]
    return { id: newId('pin'), kind: 'pin', halves }
  }
  if (variantId === CUP_VARIANT.id) {
    const halves = (flipped
      ? [CUP_VARIANT.halves[1], CUP_VARIANT.halves[0]]
      : CUP_VARIANT.halves) as [typeof CUP_VARIANT.halves[0], typeof CUP_VARIANT.halves[1]]
    return { id: newId('cup'), kind: 'cup', halves }
  }
  return null
}

/** 象限 → 该象限的 Toggle（当前实现里一一对应） */
export function toggleOfQuadrant(q: QuadrantId): QuadrantId {
  return QUADRANT_TOGGLE[q]
}

/** 空栈初始化 */
export const EMPTY_STACKS: Record<string, StackItem[]> = Object.fromEntries(GOALS.map((g) => [g.id, []]))
