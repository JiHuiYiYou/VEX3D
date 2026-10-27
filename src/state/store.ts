import { create } from 'zustand'
import type { CupHalf, PinColor, QuadrantId, ToggleState } from '@/data/fieldSpec'
import { PIN_VARIANTS, CUP_VARIANTS, GOALS, QUADRANT_ALLIANCE } from '@/data/fieldSpec'
import { checkGoalStack, checkPlacement, checkStackKinds } from './scoring'
import { DEBUG } from '@/devTools'
import type { PlacementCheck, StackItem } from './scoring'

export type DragPayload =
  | { kind: 'palette'; item: StackItem; from: 'pin' | 'cup' }
  | { kind: 'stack'; item: StackItem; goalId: string }
  | { kind: 'loose'; item: StackItem; groupId: string }

/**
 * 场上**不在 goal 里**的得分物（散件）—— 一**组**是一个整体。
 *
 * 一组可以是：
 *  · 一根单独的 pin / cup（站在垫子上，或侧躺着）
 *  · **一个 cup + 插在它腰里的 pin**（官方摆法里的 16 个落位就是这种）
 *
 * 「一组 = 一个整体」意味着：拖一个动全部、删一个删全部、端起来也一起端。
 * 用户还能**手动组合**（把一个散件拖到另一个上）和**手动拆分**（点「拆分」）。
 *
 * 散件**不参与计分**（手册只算 goal 里的 pin 和中场的机器人）。
 */
export interface LooseGroup {
  id: string
  /** 场地坐标 (X 东, Y 北)，mm */
  x: number
  y: number
  /** 从下到上 */
  pieces: LoosePiece[]
}

/** 一组里的一段（一根 pin 或一个 cup） */
export interface LoosePiece {
  id: string
  kind: 'pin' | 'cup'
  /** [下半, 上半] */
  halves: [string, string]
  /** 侧躺时的轴向（场地系，下半 → 上半）；竖直时不写 */
  axis?: [number, number, number]
}

/** 画质档位：给弱机器（学校笔记本 / 投影仪）留的退路 */
export type Quality = 'high' | 'medium' | 'low'

/**
 * 「待放置的件」—— 拿一个件、接着点 goal 就放上去（不用拖）。
 *
 * 两种来源：
 *  · **左侧面板**（有 `variantId`）：点一下面板上的件 = 把它端起来
 *  · **场上的散件**（有 `looseId`）：点一下场上的件 = 把它端起来（再点一次 = 放下）
 *
 * ⚠️ 摞里的件**不端起来**（点它只是选中它和它所在的 goal；要挪位置请拖）。
 *
 * ★ 只要手里端着东西，点 goal 的第一反应就是**把它放上去**（叠在摞顶），
 *   而不是「选中那个 goal」—— 见 `placePending`。
 */
export interface PendingItem {
  item: StackItem
  /** 面板来源：variantId（翻转开关变了要跟着重建） */
  variantId?: string
  /** 场上散件来源：**整组**的 id（放上 goal 之后整组从场上删掉） */
  looseId?: string
}

export const QUALITY_LABEL: Record<Quality, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export interface AppState {
  /** 每个 goal 上的堆栈，数组顺序 = 自下而上 */
  stacks: Record<string, StackItem[]>
  /** 场上不在 goal 里的得分物（散件），每一项是一**组** */
  loose: LooseGroup[]
  /** 4 个 Toggle 的状态 */
  toggles: Record<QuadrantId, ToggleState>

  /** 当前选中的 goal（非空 = 编辑模式，右栏显示调色板） */
  selectedGoalId: string | null
  /** 当前选中的散件**组**（null = 选的不是场上的散件） */
  selectedLooseId: string | null
  /** 当前选中的已放置得分物（goal 摞里的件，或散件组里的某一段） */
  selectedItemId: string | null
  /**
   * 「待放置的件」（先选件 → 再点 goal 放上去）。
   * 放着的时候合法落点的 goal 会亮绿环。
   */
  pending: PendingItem | null
  /** 调色板的「翻转」总开关（只对 pin 生效） */
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
  /** 拖拽时悬停的散件组（= 可以跟它组合） */
  hoverLooseId: string | null
  /** 拖拽时指针是否在右上角的删除方块上 */
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
  /** 选中场上的一个散件组（与选 goal 互斥） */
  selectLoose: (id: string | null) => void
  selectItem: (id: string | null) => void
  /** 「端着」一个件，等着点 goal 放上去（null = 不端了） */
  setPending: (p: PendingItem | null) => void
  /**
   * 把「端着的件」放进某个 goal —— **点 goal 的第一反应就是这个**。
   *
   * · 合法 → 放上去（叠在摞顶），清掉「端着」的状态；场上散件会从场上删掉。
   * · 非法 → 拒绝并写下 placeError（UI 弹提示），**件还端着** → 换个 goal 再点。
   */
  placePending: (goalId: string) => boolean
  /**
   * 把**整组**散件摞到 goal 上（拖过去 / 点过去都走这里）。
   *
   * 合法 → 整摞追加到 goal 的摞顶，组从场上消失；
   * 非法 → 拒绝并弹提示，组还在场上。
   */
  placeLooseGroup: (goalId: string, groupId: string) => boolean
  /** 设置赛局结束时中场的机器人数量 */
  setMidfieldCounts: (red: number, blue: number) => void
  togglePaletteFlip: () => void
  /** 放置（非法叠放会被拒绝，返回 false 并写 placeError） */
  placeItem: (goalId: string, item: StackItem) => boolean
  removeItem: (goalId: string, itemId: string) => void
  /** 散件组：设置 / 挪位置 / 删除 */
  setLoose: (groups: LooseGroup[]) => void
  moveLoose: (id: string, x: number, y: number) => void
  removeLoose: (id: string) => void
  /** 翻转散件组里的某一段（交换上下两半） */
  flipLoose: (groupId: string, pieceId: string) => void
  /**
   * **手动组合**：把 source 组叠到 target 组上 → 合成一组。
   * 非法叠放（pin 叠 pin、cup 叠 cup、往侧躺的组上叠…）会被拒绝。
   */
  combineLoose: (targetId: string, sourceId: string) => boolean
  /** **手动拆分**：把一组拆成各自独立的几组（各自都能拖） */
  splitLoose: (groupId: string) => void
  /** 一键摆成官方开局的样子 */
  applySetup: (setup: { stacks: Record<string, StackItem[]>; loose: LooseGroup[] }) => void
  flipItem: (goalId: string, itemId: string) => void
  setToggle: (q: QuadrantId, state: ToggleState) => void
  cycleToggle: (q: QuadrantId) => void
  setDragging: (d: DragPayload | null) => void
  setHoverGoal: (id: string | null) => void
  setHoverLoose: (id: string | null) => void
  setOverTrash: (v: boolean) => void
  /** 拖拽时更新落点判定（内部算合法性） */
  setDropTarget: (goalId: string | null) => void
  clearPlaceError: () => void
  setQuality: (q: Quality) => void
  toggleQuadrantTint: () => void
  setHoverQuadrant: (q: QuadrantId | null) => void
  /** 视角锁定：锁定后相机不能动、视角卡片失效 */
  viewLocked: boolean
  setViewLocked: (v: boolean) => void
  resetField: () => void
}

let uid = 0
export const newId = (prefix: string) => `${prefix}-${++uid}-${Date.now().toString(36)}`

const TOGGLE_CYCLE: Record<'red' | 'blue', ToggleState[]> = {
  // 红色半场（西墙·红近 + 南墙·红远）：黄 → 蓝 → 红 → 黄 …
  red: ['yellow', 'blue', 'red'],
  // 蓝色半场（东墙·蓝近 + 北墙·蓝远）：黄 → 红 → 蓝 → 黄 …
  blue: ['yellow', 'red', 'blue'],
}

/** 每方只有 2 台机器人，所以中场的机器人数只能是 0…2 */
export const MAX_ROBOTS_PER_ALLIANCE = 2

/** 拆分时，各段之间错开多远（mm）—— 不然它们的拾取范围会完全重合 */
export const SPLIT_OFFSET = 100

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
  return q === 'low' || q === 'medium' || q === 'high' ? q : 'medium'
}

export const useApp = create<AppState>((set, get) => ({
  stacks: {},
  loose: [],
  toggles: initialToggles(),

  selectedGoalId: null,
  selectedLooseId: null,
  selectedItemId: null,
  pending: null,
  paletteFlipped: false,
  midfieldCounts: { red: 0, blue: 0 },

  dragging: null,
  hoverGoalId: null,
  hoverLooseId: null,
  overTrash: false,
  dropTarget: null,
  placeError: null,
  quality: initialQuality(),
  showQuadrantTint: true,
  hoverQuadrant: null,
  viewLocked: false,

  /** 选 goal：同时收起散件选中态 */
  selectGoal: (id) =>
    set((s) => ({
      selectedGoalId: id,
      selectedLooseId: null,
      selectedItemId: id === null ? null : s.selectedItemId,
    })),

  /** 选中场上的一个散件组：同时收起 goal 选中态 */
  selectLoose: (id) =>
    set((s) => ({
      selectedLooseId: id,
      selectedGoalId: null,
      selectedItemId: id === null ? null : s.selectedItemId,
    })),

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
      if (pending?.variantId) {
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
   * 把「端着的件」放进某个 goal。
   *
   * ★ **优先级**：手里端着东西时，点 goal 的第一反应是**放上去**（叠在摞顶），
   *   不是「选中这个 goal」。goal 上已经有东西也一样放 —— 摞顶是什么就叠什么。
   *
   * 非法叠放（pin 叠 pin、cup 叠 cup…）会被拒绝并弹提示，**件还端着**，
   * 换个 goal 再点就行 ✓。
   */
  placePending: (goalId) => {
    const s = get()
    const p = s.pending
    if (!p) return false
    // 场上的散件 → **整组**摞上去（不是只放抓起来的那一段）
    if (p.looseId) return s.placeLooseGroup(goalId, p.looseId)
    return s.placeItem(goalId, p.item)
  },

  /**
   * 把整组散件摞到 goal 上。
   *
   * 合法 = 摞完整之后还是「pin / cup 交替、且第一件是 pin」
   *（goal 上只能先放 pin —— 一组若是「cup 里插着 pin」，直接放 goal 是不合法的，
   *  得先「拆分」再把 pin 放进去）。
   */
  placeLooseGroup: (goalId, groupId) => {
    const s = get()
    const g = s.loose.find((x) => x.id === groupId)
    if (!g) return false
    const stack = s.stacks[goalId] ?? []
    const kinds = [...stack.map((i) => i.kind), ...g.pieces.map((p) => p.kind)]
    const check = checkGoalStack(kinds)
    if (!check.ok) {
      set({ placeError: { goalId, reason: check.reason, at: Date.now() } })
      return false
    }
    const items: StackItem[] = g.pieces.map((p) =>
      p.kind === 'pin'
        ? { id: p.id, kind: 'pin', halves: p.halves as [PinColor, PinColor] }
        : { id: p.id, kind: 'cup', halves: p.halves as [CupHalf, CupHalf] },
    )
    set((st) => ({
      stacks: { ...st.stacks, [goalId]: [...(st.stacks[goalId] ?? []), ...items] },
      loose: st.loose.filter((x) => x.id !== groupId),
      pending: null,
      placeError: null,
      selectedLooseId: null,
      selectedItemId: items.length ? items[items.length - 1].id : st.selectedItemId,
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
        // 手里端着的正好是它 → 手里空了（不然会把它又放回去）
        pending: s.pending?.item.id === itemId ? null : s.pending,
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
      // ★ 红蓝半场的循环顺序不一样（见 TOGGLE_CYCLE）：
      //   红方半场：黄 → 蓝 → 红 → 黄 …
      //   蓝方半场：黄 → 红 → 蓝 → 黄 …
      const order = TOGGLE_CYCLE[QUADRANT_ALLIANCE[q]]
      const next = order[(order.indexOf(cur) + 1) % order.length]
      return { toggles: { ...s.toggles, [q]: next } }
    }),

  setDragging: (d) =>
    set({
      dragging: d,
      hoverGoalId: null,
      hoverLooseId: null,
      overTrash: false,
      dropTarget: null,
      // 只在**开始**新拖拽时清掉旧提示；结束时（d === null）要保留刚拒绝的那条
      placeError: d ? null : get().placeError,
    }),
  setHoverGoal: (id) => {
    if (get().hoverGoalId !== id) set({ hoverGoalId: id })
  },
  setHoverLoose: (id) => {
    if (get().hoverLooseId !== id) set({ hoverLooseId: id })
  },
  setOverTrash: (v) => {
    if (get().overTrash !== v) set({ overTrash: v })
  },

  setLoose: (groups) => set({ loose: groups }),

  moveLoose: (id, x, y) =>
    set((s) => ({
      loose: s.loose.map((it) => (it.id === id ? { ...it, x, y } : it)),
    })),

  removeLoose: (id) =>
    set((s) => {
      const g = s.loose.find((it) => it.id === id)
      const pieceIds = new Set(g?.pieces.map((p) => p.id) ?? [])
      return {
        loose: s.loose.filter((it) => it.id !== id),
        // 手里端着的正好是它 → 手里空了
        pending: s.pending?.looseId === id ? null : s.pending,
        selectedLooseId: s.selectedLooseId === id ? null : s.selectedLooseId,
        selectedItemId:
          s.selectedItemId && pieceIds.has(s.selectedItemId) ? null : s.selectedItemId,
      }
    }),

  /** 翻转散件组里的某一段（交换上下两半） */
  flipLoose: (groupId, pieceId) =>
    set((s) => ({
      loose: s.loose.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              pieces: g.pieces.map((p) =>
                p.id === pieceId ? { ...p, halves: [p.halves[1], p.halves[0]] } : p,
              ),
            },
      ),
    })),

  /**
   * **手动组合**：把 source 组叠到 target 组上 → 合成一组。
   *
   * 合法的条件：两组的段数加起来之后仍然是 **pin / cup 交替**。
   * （场上的一组可以以 pin 或 cup 开头 —— 「cup 里插着 pin」就是以 cup 开头的。）
   *
   * ★ **侧躺的 pin 也能组合**：把它拖到 cup 上 = 被「拾起来插进 cup 里」
   *   （立起来，跟预设里那 16 组一模一样）—— 去掉轴向就变成竖着的那一段。
   *   反过来往侧躺的件上组合不行（它躺在垫子上，没法往上摞）。
   */
  combineLoose: (targetId, sourceId) => {
    const s = get()
    const target = s.loose.find((g) => g.id === targetId)
    const source = s.loose.find((g) => g.id === sourceId)
    if (!target || !source || target.id === source.id) return false
    // 目标侧躺着 → 没法往上摞东西
    if (target.pieces.some((p) => p.axis)) {
      set({
        placeError: {
          goalId: '',
          reason: '侧躺着的件不能再往上组合（它躺在垫子上）',
          at: Date.now(),
        },
      })
      return false
    }
    // 源里侧躺的那段 = 被拾起来插进 cup 里 → 立起来（去掉轴向）
    const hadLying = source.pieces.some((p) => p.axis)
    const sourcePieces = source.pieces.map((p) => {
      if (!p.axis) return { ...p }
      const { axis, ...rest } = p
      return rest
    })
    const kinds = [...target.pieces.map((p) => p.kind), ...sourcePieces.map((p) => p.kind)]
    const check = checkStackKinds(kinds)
    if (!check.ok) {
      // 「侧躺的 pin 插进 cup」插不进去时，多半是那个 cup 里已经有 pin 了
      const targetTop = target.pieces[target.pieces.length - 1]
      const reason =
        hadLying && targetTop?.kind === 'cup'
          ? '这个 cup 里已经插着 pin 了（一个 cup 半里最多放 1 个 pin）'
          : check.reason
      set({ placeError: { goalId: '', reason, at: Date.now() } })
      return false
    }
    set((st) => ({
      loose: st.loose
        .filter((g) => g.id !== sourceId)
        .map((g) =>
          g.id === targetId
            ? { ...g, pieces: [...g.pieces, ...sourcePieces.map((p) => ({ ...p }))] }
            : g,
        ),
      selectedLooseId: targetId,
      selectedItemId: sourcePieces[0]?.id ?? st.selectedItemId,
      placeError: null,
    }))
    return true
  },

  /**
   * **手动拆分**：把一组拆成各自独立的几组（各自都能拖、都能端起来）。
   *
   * 拆出来的几段**分开摆一点点**（每段错开 100 mm）——
   * 拆完还叠在同一个点上的话，两段的拾取范围完全重合，点哪都是上面那个 ✗
   */
  splitLoose: (groupId) =>
    set((s) => {
      const g = s.loose.find((x) => x.id === groupId)
      if (!g || g.pieces.length < 2) return {}
      const parts: LooseGroup[] = g.pieces.map((p, i) => ({
        id: newId('grp'),
        x: g.x + i * SPLIT_OFFSET,
        y: g.y,
        pieces: [{ ...p }],
      }))
      return {
        loose: s.loose.flatMap((x) => (x.id === groupId ? parts : [x])),
        selectedLooseId: parts[0].id,
        selectedItemId: parts[0].pieces[0].id,
      }
    }),

  /** 一键摆成官方开局的样子（= 重置 + 灌预设） */
  applySetup: (setup) =>
    set({
      stacks: { ...setup.stacks },
      loose: setup.loose.map((g) => ({ ...g, pieces: g.pieces.map((p) => ({ ...p })) })),
      selectedGoalId: null,
      selectedItemId: null,
      selectedLooseId: null,
      pending: null,
      dragging: null,
      placeError: null,
    }),

  /**
   * 拖拽时更新落点判定。
   *
   * · 从面板拖一个新件 → 判它能不能放在这个 goal 的摞顶
   * · 拖一整组散件 → 判**整摞**追加上去合不合法
   * · 拖 goal 上已有的件 → 不判（只是挪位置）
   */
  setDropTarget: (goalId) => {
    const s = get()
    const d = s.dragging
    let check: PlacementCheck | null = null
    if (goalId && d?.kind === 'palette') {
      check = checkPlacement(d.item.kind, s.stacks[goalId] ?? [])
    } else if (goalId && d?.kind === 'loose') {
      const g = s.loose.find((x) => x.id === d.groupId)
      if (g) {
        const kinds = [
          ...(s.stacks[goalId] ?? []).map((i) => i.kind),
          ...g.pieces.map((p) => p.kind),
        ]
        check = checkGoalStack(kinds)
      }
    }
    if (!goalId || !check) {
      if (s.dropTarget !== null) set({ dropTarget: null })
      return
    }
    const cur = s.dropTarget
    if (cur && cur.goalId === goalId && cur.legal === check.ok && cur.reason === check.reason) {
      return
    }
    set({ dropTarget: { goalId, legal: check.ok, reason: check.reason } })
  },

  clearPlaceError: () => set({ placeError: null }),

  setQuality: (q) => set({ quality: q }),

  /** 锁定 / 解锁视角（锁定后相机不能动，视角卡片也失效） */
  setViewLocked: (v) => set({ viewLocked: v }),

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
      selectedLooseId: null,
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

// 把 store 挂到 window，方便端到端脚本检查内部状态（生产构建要 ?debug=1）
if (DEBUG) {
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
