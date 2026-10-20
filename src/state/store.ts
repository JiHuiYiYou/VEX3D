import { create } from 'zustand'
import type { QuadrantId, ToggleState } from '@/data/fieldSpec'
import { PIN_VARIANTS, CUP_VARIANT, GOALS, QUADRANT_TOGGLE } from '@/data/fieldSpec'
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
  placeItem: (goalId: string, item: StackItem) => void
  removeItem: (goalId: string, itemId: string) => void
  flipItem: (goalId: string, itemId: string) => void
  setToggle: (q: QuadrantId, state: ToggleState) => void
  cycleToggle: (q: QuadrantId) => void
  setDragging: (d: DragPayload | null) => void
  setHoverGoal: (id: string | null) => void
  setOverTrash: (v: boolean) => void
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

  placeItem: (goalId, item) =>
    set((s) => {
      const stack = s.stacks[goalId] ?? []
      return { stacks: { ...s.stacks, [goalId]: [...stack, item] } }
    }),

  removeItem: (goalId, itemId) =>
    set((s) => {
      const stack = s.stacks[goalId] ?? []
      return {
        stacks: { ...s.stacks, [goalId]: stack.filter((i) => i.id !== itemId) },
        selectedItemId: s.selectedItemId === itemId ? null : s.selectedItemId,
      }
    }),

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

  setDragging: (d) => set({ dragging: d, hoverGoalId: null, overTrash: false }),  setHoverGoal: (id) => {
    if (get().hoverGoalId !== id) set({ hoverGoalId: id })
  },
  setOverTrash: (v) => {
    if (get().overTrash !== v) set({ overTrash: v })
  },

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
