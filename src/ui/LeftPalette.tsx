import { useCallback } from 'react'
import { useApp, makePaletteItem } from '@/state/store'
import { PIN_VARIANTS, CUP_VARIANT, COLORS, GOAL_BY_ID, goalKind, goalName } from '@/data/fieldSpec'
import { ToggleView } from './ToggleView'

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

export function LeftPalette() {
  const selectedGoalId = useApp((s) => s.selectedGoalId)
  const selectedToggleId = useApp((s) => s.selectedToggleId)
  const flipped = useApp((s) => s.paletteFlipped)
  const togglePaletteFlip = useApp((s) => s.togglePaletteFlip)
  const setDragging = useApp((s) => s.setDragging)
  const dropTarget = useApp((s) => s.dropTarget)
  const goal = selectedGoalId ? GOAL_BY_ID[selectedGoalId] : null
  const isMidfield = goal?.quadrant === 'midfield'

  const startDrag = useCallback(
    (variantId: string) => (e: React.PointerEvent) => {
      e.preventDefault()
      const item = makePaletteItem(variantId, useApp.getState().paletteFlipped)
      if (!item) return
      setDragging({ kind: 'palette', item, from: variantId.startsWith('cup') ? 'cup' : 'pin' })
    },
    [setDragging],
  )

  const flip = (halves: readonly [string, string]) =>
    flipped ? ([halves[1], halves[0]] as const) : halves

  return (
    <aside className="panel panel-left">
      <div className="panel-title">得分物</div>

      {selectedToggleId ? (
        <ToggleView quadrant={selectedToggleId} />
      ) : !goal ? (
        <div className="hint">
          点击场地上的任意一个 <b>goal</b>，即可在这里选择要放置的 pin / cup；
          点击围栏上的 <b>toggle</b>，可以设置它的颜色。
          <br />
          <br />
          · 4 种 pin 配色：红蓝 / 红黄 / 蓝黄 / 黄黄
          <br />
          · 1 种 cup：透明半 + 不透明（灰）半
          <br />
          · <b>翻转</b>按钮会交换每一件的上下两半
          <br />
          · 叠放规则：<b>pin 只能放在 cup 上或直接放在 goal 上</b>，
          <b>cup 只能放在 pin 上</b>，其它组合算非法
        </div>
      ) : (
        <>
          <div className="selected-goal">
            已选中：<b>{goalName(goal)}</b>
            <span className="muted">{goalKind(goal)}</span>
          </div>

          <button className="flip-btn" onClick={togglePaletteFlip}>
            翻转 {flipped ? '（已翻转）' : ''}
          </button>

          <div className="palette">
            {PIN_VARIANTS.map((v) => (
              <div
                key={v.id}
                className="palette-item"
                onPointerDown={startDrag(v.id)}
                title={`拖到 goal 上放置：${v.label}`}
              >
                <PinIcon halves={flip(v.halves)} />
                <div className="palette-label">{v.label}</div>
              </div>
            ))}
            <div
              className="palette-item"
              onPointerDown={startDrag(CUP_VARIANT.id)}
              title="拖到 goal 上放置：透明 / 灰"
            >
              <CupIcon halves={flip(CUP_VARIANT.halves)} />
              <div className="palette-label">透明 / 灰</div>
            </div>
          </div>

          {/* 中场：黄色 pin 归「中场机器人数多的一方」（<SC5>b） */}
          {isMidfield && <MidfieldCounts />}

          <div className="hint small">
            把上面任意一件<b>拖</b>到场地上的 goal 即可放置，可以叠多层。
            <br />
            <b>pin 只能放在 cup 上或直接放在 goal 上</b>，<b>cup 只能放在 pin 上</b>。
            <br />
            已放置的件：<b>拖到画面边缘</b>四周会亮起红光、弹出红色垃圾桶，丢进去删除。
            <br />
            拆掉一个，<b>它上面的 pin / cup 会一并拆掉</b>（得分物不能悬空）。
          </div>

          {/* 拖拽过程中实时提示：当前落点非法 */}
          {dropTarget && !dropTarget.legal && (
            <div className="hint small warn">不能放在这里：{dropTarget.reason}</div>
          )}
        </>
      )}
    </aside>
  )
}

/**
 * 中场的机器人数量（赛局结束时的值）。
 *
 * `<SC5>b`：中场区域 placed 的黄色 pin，归**赛局结束时中场机器人数多的一方**；
 * 数量相同则不被任何一方拥有。
 */
function MidfieldCounts() {
  const counts = useApp((s) => s.midfieldCounts)
  const setCounts = useApp((s) => s.setMidfieldCounts)

  const row = (label: string, alliance: 'red' | 'blue', value: number) => (
    <div className="count-row" key={alliance}>
      <span className={`count-label ${alliance}`}>{label}</span>
      <button
        className="count-btn"
        onClick={() => setCounts(counts.red - (alliance === 'red' ? 1 : 0), counts.blue - (alliance === 'blue' ? 1 : 0))}
      >
        −
      </button>
      <span className="count-value">{value}</span>
      <button
        className="count-btn"
        onClick={() => setCounts(counts.red + (alliance === 'red' ? 1 : 0), counts.blue + (alliance === 'blue' ? 1 : 0))}
      >
        ＋
      </button>
    </div>
  )

  return (
    <div className="midfield-counts">
      <div className="panel-title" style={{ marginTop: 12 }}>
        中场机器人数量
      </div>
      <div className="hint small">填**赛局结束时**中场的机器人数量（`&lt;SC5&gt;b` / `&lt;SC6&gt;`）。</div>
      {row('红方', 'red', counts.red)}
      {row('蓝方', 'blue', counts.blue)}
      <div className="hint small">
        {counts.red === counts.blue
          ? '双方一样多 → 中场的黄色 pin 谁都不拥有，不得分。'
          : `中场机器人数多的是${counts.red > counts.blue ? '红方' : '蓝方'} → 中场的黄色 pin 归${
              counts.red > counts.blue ? '红方' : '蓝方'
            }。`}
      </div>
    </div>
  )
}
