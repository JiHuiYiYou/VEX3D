import { useApp } from '@/state/store'
import {
  GOAL_BY_ID,
  QUADRANT_ALLIANCE_TAG,
  QUADRANT_GOALS,
  TOGGLE_STATE_LABEL,
  goalKind,
  goalName,
} from '@/data/fieldSpec'
import type { QuadrantId, ToggleState } from '@/data/fieldSpec'

const STATES: ToggleState[] = ['red', 'blue', 'yellow']

/**
 * 左侧面板的「toggle 设置」视图 —— 点场上的哪个 toggle，就编辑哪个。
 *
 * 三个颜色按钮直接**设值**（不是循环），因为现在一次只面对一个 toggle，
 * 循环反而容易点错。
 */
export function ToggleView({ quadrant }: { quadrant: QuadrantId }) {
  const toggles = useApp((s) => s.toggles)
  const setToggle = useApp((s) => s.setToggle)
  const selectGoal = useApp((s) => s.selectGoal)
  const showTint = useApp((s) => s.showQuadrantTint)

  const state = toggles[quadrant] ?? 'yellow'
  const region = QUADRANT_ALLIANCE_TAG[quadrant]

  return (
    <>
      <div className="selected-goal">
        已选中：<b>Toggle · {region}</b>
        <span className="muted">围栏上控制这个区域的 toggle</span>
      </div>

      <div className="toggle-picker">
        {STATES.map((s) => (
          <button
            key={s}
            className={`toggle-color state-${s} ${state === s ? 'active' : ''}`}
            onClick={() => setToggle(quadrant, s)}
            title={`把这个 toggle 设成${TOGGLE_STATE_LABEL[s]}`}
          >
            {TOGGLE_STATE_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="hint small">
        {state === 'yellow' ? (
          <>
            这个区域里的<b>黄色 pin</b>谁都不拥有、不得分。
          </>
        ) : (
          <>
            这个区域里的<b>黄色 pin</b>归
            <b style={{ color: state === 'red' ? 'var(--red)' : 'var(--blue)' }}>
              {state === 'red' ? '红方' : '蓝方'}
            </b>{' '}
            所有（10 分/个）。
          </>
        )}
        <br />
        场地上那根条和这个区域的染色会同时跟着变。
      </div>

      <label className="tint-toggle">
        <input
          type="checkbox"
          checked={showTint}
          onChange={() => useApp.getState().toggleQuadrantTint()}
        />
        区域染色
      </label>

      <div className="panel-title" style={{ marginTop: 14 }}>
        这个区域里的 goal
      </div>
      <div className="toggle-goals">
        {QUADRANT_GOALS[quadrant].map((gid) => {
          const g = GOAL_BY_ID[gid]
          if (!g) return null
          return (
            <button
              key={gid}
              className="mini-goal"
              onClick={() => selectGoal(gid)}
              title={goalName(g)}
            >
              {goalKind(g)}
            </button>
          )
        })}
      </div>
    </>
  )
}
