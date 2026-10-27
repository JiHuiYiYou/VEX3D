import { useCallback } from 'react'
import { useApp, makePaletteItem, MAX_ROBOTS_PER_ALLIANCE } from '@/state/store'
import type { PendingItem } from '@/state/store'
import { PIN_VARIANTS, CUP_VARIANTS, COLORS, GOAL_BY_ID, goalKind, goalName } from '@/data/fieldSpec'
import { PIN_COLOR_LABEL, CUP_HALF_LABEL } from '@/data/terms'

const HEX: Record<string, string> = {
  red: COLORS.red,
  blue: COLORS.blue,
  yellow: COLORS.yellow,
  gray: COLORS.gray,
  clear: '#bcd9ee',
}

/** 半体图标：漏斗形（宽端在底部 = upright，倒过来 = inverted） */
function HalfIcon({
  color,
  inverted,
  x,
  y,
  w,
  h,
}: {
  color: string
  inverted?: boolean
  x: number
  y: number
  w: number
  h: number
}) {
  const topW = w * 0.55
  const pts = inverted
    ? `${x},${y} ${x + w},${y} ${x + w - (w - topW) / 2},${y + h} ${x + (w - topW) / 2},${y + h}`
    : `${x + (w - topW) / 2},${y} ${x + w - (w - topW) / 2},${y} ${x + w},${y + h} ${x},${y + h}`
  return (
    <>
      <polygon points={pts} fill={HEX[color]} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
      <rect
        x={inverted ? x : x - 2}
        y={inverted ? y - 4 : y + h - 4}
        width={w + 4}
        height="5"
        fill={HEX[color]}
        stroke="rgba(0,0,0,.35)"
        strokeWidth="1"
      />
    </>
  )
}

function PinIcon({ halves }: { halves: readonly [string, string] }) {
  return (
    <svg viewBox="0 0 44 84" className="piece-icon">
      {/* 下半：倒置（尖端朝下） */}
      <HalfIcon color={halves[0]} inverted x={10} y={42} w={24} h={38} />
      {/* 上半：正立（尖端朝上） */}
      <HalfIcon color={halves[1]} x={10} y={4} w={24} h={38} />
    </svg>
  )
}

/**
 * Cup = **杯口对杯口**的沙漏：两端是敞口的大翻边，中间是 Ø59 的细腰。
 * （Pin 才是翻边对翻边的线轴 —— 两者形状不同，别搞混。）
 */
function CupIcon({ halves }: { halves: readonly [string, string] }) {
  return (
    <svg viewBox="0 0 60 84" className="piece-icon">
      {/* 上半（halves[1]）：翻边在上、杯口朝下 */}
      <HalfIcon color={halves[1]} inverted x={4} y={4} w={52} h={38} />
      {/* 下半（halves[0]）：翻边在下、杯口朝上 */}
      <HalfIcon color={halves[0]} x={4} y={42} w={52} h={38} />
    </svg>
  )
}

/** 「端着的件」叫什么（提示文字用） */
function pendingLabel(p: PendingItem): string {
  if (p.item.kind === 'pin') {
    return `pin ${PIN_COLOR_LABEL[p.item.halves[0]]} / ${PIN_COLOR_LABEL[p.item.halves[1]]}`
  }
  return `cup ${CUP_HALF_LABEL[p.item.halves[0]]} / ${CUP_HALF_LABEL[p.item.halves[1]]}`
}

/**
 * 右栏下半部分：**得分物调色板** + **选中件的操作** + **中场机器人数量**。
 *
 * 三种放法（都守同一套叠放规则，非法一律拒绝 + 弹提示）：
 *  1. **拖**：右栏的得分物拖到场上的任意 goal；场上的散件也能拖进 goal 的摞。
 *  2. **先选 goal 再选件**：先点中一个 goal，再**单击**得分物 → 直接落在它上面。
 *  3. **先选件再选 goal**（`store.pending`，「端着」）：**单击**一个得分物 = 把它端起来，
 *     接着点场上的一个 goal → 放上去。
 */
export function SidePanel() {
  const selectedGoalId = useApp((s) => s.selectedGoalId)
  const selectedLooseId = useApp((s) => s.selectedLooseId)
  const selectedItemId = useApp((s) => s.selectedItemId)
  const pending = useApp((s) => s.pending)
  const flipped = useApp((s) => s.paletteFlipped)
  const togglePaletteFlip = useApp((s) => s.togglePaletteFlip)
  const setDragging = useApp((s) => s.setDragging)
  const flipItem = useApp((s) => s.flipItem)
  const flipLoose = useApp((s) => s.flipLoose)
  const splitLoose = useApp((s) => s.splitLoose)
  const loose = useApp((s) => s.loose)
  const goal = selectedGoalId ? GOAL_BY_ID[selectedGoalId] : null

  // 选中的散件组（能拆分的只有它）
  const looseGroup = selectedLooseId ? loose.find((g) => g.id === selectedLooseId) : undefined
  const canSplit = !!looseGroup && looseGroup.pieces.length > 1
  const canFlip = selectedLooseId
    ? !!selectedItemId
    : !!selectedGoalId && !!selectedItemId

  const startDrag = useCallback(
    (variantId: string) => (e: React.PointerEvent) => {
      e.preventDefault()
      const item = makePaletteItem(variantId, useApp.getState().paletteFlipped)
      if (!item) return
      setDragging({ kind: 'palette', item, from: variantId.startsWith('cup') ? 'cup' : 'pin' })
    },
    [setDragging],
  )

  /**
   * 单击 → 两种走法：
   *  · **已经选好了 goal** → 直接放上去
   *  · **没选 goal** → 先「端着」这个件，接着点场上的一个 goal 就放上去（不用拖）
   *    （再点一次同一个件 = 取消）
   *
   * 叠放不合法时 `placeItem` 会拒绝并弹提示 ✓（比如 pin 叠 pin）。
   */
  const onPaletteClick = useCallback((variantId: string) => {
    const st = useApp.getState()
    const item = makePaletteItem(variantId, st.paletteFlipped)
    if (!item) return
    if (st.selectedGoalId) {
      const ok = st.placeItem(st.selectedGoalId, item)
      // 放不上去（非法叠放）→ 把它留着「端着」，换个 goal 再点就行
      if (!ok) st.setPending({ item, variantId })
      return
    }
    if (st.pending?.variantId === variantId) {
      st.setPending(null)
    } else {
      st.setPending({ item, variantId })
    }
  }, [])

  const flip = (halves: readonly [string, string]) =>
    flipped ? ([halves[1], halves[0]] as const) : halves

  const onFlipSelected = () => {
    if (!selectedItemId) return
    if (selectedLooseId) flipLoose(selectedLooseId, selectedItemId)
    else if (selectedGoalId) flipItem(selectedGoalId, selectedItemId)
  }

  return (
    <>
      <section className="panel panel-palette">
        <div className="panel-title">得分物</div>

        {goal && (
          <div className="selected-goal">
            已选中：<b>{goalName(goal)}</b>
            <span className="muted">{goalKind(goal)}</span>
          </div>
        )}

        <button
          className="flip-btn"
          onClick={togglePaletteFlip}
          title="把 4 种 pin 的上下两半对调（cup 的正反是下面两个独立选项，不受这个开关影响）"
        >
          翻转 pin {flipped ? '（已翻转）' : ''}
        </button>

        <div className="palette">
          {PIN_VARIANTS.map((v) => (
            <div
              key={v.id}
              className={
                'palette-item' + (pending?.variantId === v.id ? ' armed' : '')
              }
              onPointerDown={startDrag(v.id)}
              onClick={() => onPaletteClick(v.id)}
              title={`拖到 goal 上，或**单击**直接放上去：${v.label}`}
            >
              <PinIcon halves={flip(v.halves)} />
              <div className="palette-label">{v.label}</div>
            </div>
          ))}
          {CUP_VARIANTS.map((c) => (
            <div
              key={c.id}
              className={
                'palette-item' + (pending?.variantId === c.id ? ' armed' : '')
              }
              onPointerDown={startDrag(c.id)}
              onClick={() => onPaletteClick(c.id)}
              title={`拖到 goal 上，或**单击**直接放上去：${c.label}（cup ${c.id === 'cup' ? '正' : '反'}）`}
            >
              <CupIcon halves={c.halves} />
              <div className="palette-label">{c.label}</div>
            </div>
          ))}
        </div>

        {/* 「端着」一个件：接着点场上的一个 goal 就放上去 */}
        {pending && (
          <div className="hint small pending-hint">
            {pending.looseId ? '已端起场上的' : '已端着：'}
            <b>{pendingLabel(pending)}</b> —— 点场上的一个 <b>goal</b> 放上去
          </div>
        )}
      </section>

      {/* 选中件的操作：没选中就不显示 */}
      {(canFlip || canSplit) && (
        <section className="panel panel-actions">
          {canFlip && (
            <button className="act-btn" onClick={onFlipSelected} title="翻转这个件的上下两半">
              翻转选中件
            </button>
          )}
          {canSplit && (
            <button
              className="act-btn"
              onClick={() => splitLoose(selectedLooseId!)}
              title="把这一组拆开，各自变成独立的件"
            >
              拆分
            </button>
          )}
        </section>
      )}

      <MidfieldCounts />
    </>
  )
}

/**
 * 中场的机器人数量（赛局结束时的值）—— **常驻**。
 *
 * `<SC5>b`：中场区域 placed 的黄色 pin，归**赛局结束时中场机器人数多的一方**；
 * 数量相同则不被任何一方拥有。每台 8 分。
 */
function MidfieldCounts() {
  const counts = useApp((s) => s.midfieldCounts)
  const setCounts = useApp((s) => s.setMidfieldCounts)

  const row = (label: string, alliance: 'red' | 'blue', value: number) => (
    <div className="count-row" key={alliance}>
      <span className={`count-label ${alliance}`}>{label}</span>
      <button
        className="count-btn"
        disabled={value <= 0}
        aria-label={`${label}机器人减一`}
        onClick={() =>
          setCounts(counts.red - (alliance === 'red' ? 1 : 0), counts.blue - (alliance === 'blue' ? 1 : 0))
        }
      >
        −
      </button>
      <span className="count-value">{value}</span>
      <button
        className="count-btn"
        disabled={value >= MAX_ROBOTS_PER_ALLIANCE}
        aria-label={`${label}机器人加一`}
        onClick={() =>
          setCounts(counts.red + (alliance === 'red' ? 1 : 0), counts.blue + (alliance === 'blue' ? 1 : 0))
        }
      >
        ＋
      </button>
    </div>
  )

  return (
    <section className="panel panel-midfield">
      <div className="panel-title">中场机器人数量</div>
      {row('红方', 'red', counts.red)}
      {row('蓝方', 'blue', counts.blue)}
    </section>
  )
}
