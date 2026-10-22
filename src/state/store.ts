import { create } from 'zustand'
import type { QuadrantId, ToggleState } from '@/data/fieldSpec'
import { PIN_VARIANTS, CUP_VARIANTS, GOALS } from '@/data/fieldSpec'
import { checkPlacement } from './scoring'
import type { StackItem } from './scoring'

export type DragPayload =
  | { kind: 'palette'; item: StackItem; from: 'pin' | 'cup' }
  | { kind: 'stack'; item: StackItem; goalId: string }
  | { kind: 'loose'; item: StackItem; looseId: string }

/**
 * 场上**不在 goal 里**的得分物（散件）。
 *
 * 官方开局布局里有三类：
 *  · 站在垫子上的 cup / pin（有的 pin 插在 cup 里）
 *  · 侧躺着的 pin（官方摆法里有 16 根）
 *  · 装填区里备着的 cup / pin
 *
 * 散件**不参与计分**（手册只算 goal 里的 pin 和中场的机器人）。
 */
export interface LooseItem {
  id: string
  kind: 'pin' | 'cup'
  /** [下半, 上半] */
  halves: [string, string]
  /** 场地坐标 (X 东, Y 北)，mm */
  x: number
  y: number
  /** 底端离地高度（mm）；省略 = 按 kind / axis / nested 推算 */
  z?: number
  /** 侧躺时的轴向（场地系，下半 → 上半）；竖直时不写 */
  axis?: [number, number, number]
  /** 插在 cup 里（针尖探进 cup 的腰） */
  nested?: boolean
}

/** 画质档位：给弱机器（学校笔记本 / 投影仪）留的退路 */
export type Quality = 'high' | 'medium' | 'low'

/**
 * 「待放置的件」—— 先选件、再点 goal 就能放上去（不用拖）。
 *
 * · source='palette'：从左侧面板拿的（点一下面板上的件就是「端着」它）
 * · source='loose'  ：场上捡起来的散件（点它一下就是「端着」它）
 */
export interface PendingItem {
  item: StackItem
  source: 'palette' | 'loose'
  /** 散件来源：它自己的 id（放上 goal 后要从散件里删掉） */
  looseId?: string
  /** 面板来源：variantId（翻转开关变了要跟着重建） */
  variantId?: string
}

export const QUALITY_LABEL: Record<Quality, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export interface AppState {
  /** 每个 goal 上的堆栈，数组顺序 = 自下而上 */
  stacks: Record<string, StackItem[]>
  /** 场上不在 goal 里的得分物（散件） */
  loose: LooseItem[]
  /** 4 个 Toggle 的状态 */
  toggles: Record<QuadrantId, ToggleState>

  /** 当前选中的 goal（非空 = 编辑模式，左侧面板显示调色板） */
  selectedGoalId: string | null
  /** 当前选中的 toggle（非空 = 左侧面板显示那个 toggle 的设置） */
  selectedToggleId: QuadrantId | null
  /** 当前选中的已放置得分物 */
  selectedItemId: string | null
  /**
   * 「待放置的件」（先选件 → 再点 goal 放上去）。
   * 放着的时候左侧面板会显示提示，合法落点的 goal 会亮绿环。
   */
  pending: PendingItem | null
  /** 左侧面板的「翻转」总开关 */
  paletteFlipped: boolean
  /**
   * 赛局结束时**中场**里的机器人数量（`<SC5>b`：中场的黄色 pin 归数量多的一方）。
   * 默认 0 / 0 = 双方都不拥有。
   */
  midfieldCounts: { red: number; blue: number }

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
  /** 是否把区域按 Toggle 状态染色 */
  showQuadrantTint: boolean
  /** 鼠标悬停的区域（高亮用） */
  hoverQuadrant: QuadrantId | null

  // ── actions ──
  selectGoal: (id: string | null) => void
  /** 选中一个 toggle（左侧面板切到那个 toggle 的设置），与选 goal 互斥 */
  selectToggle: (id: QuadrantId | null) => void
  selectItem: (id: string | null) => void
  /** 「端着」一个件，等着点 goal 放上去（null = 不端了） */
  setPending: (p: PendingItem | null) => void
  /** 设置赛局结束时中场的机器人数量 */
  setMidfieldCounts: (red: number, blue: number) => void
  togglePaletteFlip: () => void
  /** 放置（非法叠放会被拒绝，返回 false 并写 placeError） */
  placeItem: (goalId: string, item: StackItem) => boolean
  removeItem: (goalId: string, itemId: string) => void
  /** 散件：设置 / 挪位置 / 删除 */
  setLoose: (items: LooseItem[]) => void
  moveLoose: (id: string, x: number, y: number) => void
  removeLoose: (id: string) => void
  /** 一键摆成官方开局的样子 */
  applySetup: (setup: { stacks: Record<string, StackItem[]>; loose: LooseItem[] }) => void
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

/** 每方只有 2 台机器人，所以中场的机器人数只能是 0…2 */
export const MAX_ROBOTS_PER_ALLIANCE = 2

const clampRobots = (n: number) =>
  Math.max(0, Math.min(MAX_ROBOTS_PER_ALLIANCE, Math.round(n) || 0))

/**
 * Toggle 只有 **3 个有效朝向**：红 / 蓝 / 黄（手册 <SC4>）。
 * 黄色 = 「谁都不拥有该区域的黄色 Pin」；现场照片里场上的 4 个 Toggle 默认就是黄的。
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
  loose: [],
  toggles: initialToggles(),

  selectedGoalId: null,
  selectedToggleId: null,
  selectedItemId: null,
  pending: null,
  paletteFlipped: false,
  midfieldCounts: { red: 0, blue: 0 },

  dragging: null,
  hoverGoalId: null,
  overTrash: false,
  dropTarget: null,
  placeError: null,
  quality: initialQuality(),
  showQuadrantTint: true,
  hoverQuadrant: null,

  /** 选 goal：同时收起 toggle 面板（左边一次只显示一样东西） */
  selectGoal: (id) =>
    set((s) => ({
      selectedGoalId: id,
      selectedToggleId: null,
      selectedItemId: id === null ? null : s.selectedItemId,
    })),

  /** 选 toggle：同时收起 goal 调色板 */
  selectToggle: (id) =>
    set({
      selectedToggleId: id,
      selectedGoalId: null,
      selectedItemId: null,
    }),

  selectItem: (id) => set({ selectedItemId: id }),

  setPending: (p) => set({ pending: p }),

  setMidfieldCounts: (red, blue) =>
    set({
      midfieldCounts: {
        red: clampRobots(red),
        blue: clampRobots(blue),
      },
    }),

  togglePaletteFlip: () =>
    set((s) => {
      const flipped = !s.paletteFlipped
      // 手着的那个件也跟着翻（不然面板显示和手里的件对不上）
      let pending = s.pending
      if (pending && pending.source === 'palette' && pending.variantId) {
        const item = makePaletteItem(pending.variantId, flipped)
        if (item) pending = { ...pending, item }
      }
      return { paletteFlipped: flipped, pending }
    }),

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
      pending: null, // 放上去了就不「端着」了
    }))
    return true
  },

  /**
   * 拆掉一件 → **它上面的所有件也一并拆掉**。
   *
   * 物理上就是这样：得分物不能悬空，把底下那个抽走，上面的 Cup / Pin 就都掉了。
   * （垃圾桶删除、Delete 键都走这里。）
   */
  removeItem: (goalId, itemId) =>
    set((s) => {
      const stack = s.stacks[goalId] ?? []
      const idx = stack.findIndex((i) => i.id === itemId)
      if (idx < 0) return {}
      const kept = stack.slice(0, idx)
      // 被拆掉的是它自己或它上面的某件 → 选中态要清掉
      const selIdx = s.selectedItemId
        ? stack.findIndex((i) => i.id === s.selectedItemId)
        : -1
      return {
        stacks: { ...s.stacks, [goalId]: kept },
        selectedItemId: selIdx >= idx ? null : s.selectedItemId,
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

  setLoose: (items) => set({ loose: items }),

  moveLoose: (id, x, y) =>
    set((s) => ({
      loose: s.loose.map((it) => (it.id === id ? { ...it, x, y } : it)),
    })),

  removeLoose: (id) =>
    set((s) => ({
      loose: s.loose.filter((it) => it.id !== id),
      // 手里正端着它 → 删了就没了，别留个空壳
      pending: s.pending?.looseId === id ? null : s.pending,
    })),

  /** 一键摆成官方开局的样子（= 重置 + 灌预设） */
  applySetup: (setup) =>
    set({
      stacks: { ...setup.stacks },
      loose: setup.loose.map((it) => ({ ...it })),
      selectedGoalId: null,
      selectedItemId: null,
      selectedToggleId: null,
      pending: null,
      dragging: null,
      placeError: null,
    }),

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
      loose: [],
      toggles: initialToggles(),
      selectedGoalId: null,
      selectedToggleId: null,
      selectedItemId: null,
      pending: null,
      paletteFlipped: false,
      midfieldCounts: { red: 0, blue: 0 },
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

/**
 * 从左侧面板生成一个待放置的件。
 *
 * · **pin** 受「翻转」开关影响（上下两半对调）。
 * · **cup 的正反是两个独立选项**（`CUP_VARIANTS`），不受「翻转」开关影响 ——
 *   谁能罩住谁、罩住的是哪一半全看朝向，所以摆件时直接选朝向。
 */
export function makePaletteItem(variantId: string, flipped: boolean): StackItem | null {
  const pin = PIN_VARIANTS.find((p) => p.id === variantId)
  if (pin) {
    const halves = (flipped ? [pin.halves[1], pin.halves[0]] : pin.halves) as [typeof pin.halves[0], typeof pin.halves[1]]
    return { id: newId('pin'), kind: 'pin', halves }
  }
  const cup = CUP_VARIANTS.find((c) => c.id === variantId)
  if (cup) {
    return { id: newId('cup'), kind: 'cup', halves: [cup.halves[0], cup.halves[1]] }
  }
  return null
}

/** 区域 → 该区域的 Toggle（当前实现里一一对应） */
/** 空栈初始化 */
export const EMPTY_STACKS: Record<string, StackItem[]> = Object.fromEntries(GOALS.map((g) => [g.id, []]))
