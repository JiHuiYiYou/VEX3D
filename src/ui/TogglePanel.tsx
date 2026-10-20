import { useApp } from '@/state/store'
import {
  QUADRANT_LABEL,
  QUADRANT_DIR,
  QUADRANT_ALLIANCE,
  QUADRANT_GOALS,
  GOAL_BY_ID,
} from '@/data/fieldSpec'
import type { QuadrantId } from '@/data/fieldSpec'
import { STATE_LABEL } from '@/scene/Toggles'

const ORDER: QuadrantId[] = ['top', 'right', 'bottom', 'left']

export function TogglePanel() {
  const toggles = useApp((s) => s.toggles)
  const cycleToggle = useApp((s) => s.cycleToggle)
  const selectGoal = useApp((s) => s.selectGoal)
  const showTint = useApp((s) => s.showQuadrantTint)

  return (
    <section className="panel panel-toggle">
      <div className="panel-title">Toggle（象限归属）</div>
      <div className="hint small">
        点击卡片切换：红 → 蓝 → 黄。设为红/蓝时，<b>该象限内的黄色 Pin</b>归该方所有（10 分/半）；
        设为黄色表示谁都不拥有。
        <label className="tint-toggle">
          <input
            type="checkbox"
            checked={showTint}
            onChange={() => useApp.getState().toggleQuadrantTint()}
          />
          象限染色
        </label>
      </div>
      <div className="toggle-grid">
        {ORDER.map((q) => {
          const state = toggles[q] ?? 'yellow'
          return (
            <button
              key={q}
              className={`toggle-card state-${state}`}
              onClick={() => cycleToggle(q)}
              onMouseEnter={() => useApp.getState().setHoverQuadrant(q)}
              onMouseLeave={() => useApp.getState().setHoverQuadrant(null)}
              title="点击切换状态"
            >
              <div className="toggle-name">
                {QUADRANT_DIR[q]}
                <span className="toggle-tag">{QUADRANT_LABEL[q].split('·')[1].trim()}</span>
              </div>
              <div className="toggle-state">{STATE_LABEL[state]}</div>
              <div className="toggle-goals">
                {QUADRANT_GOALS[q].map((gid) => (
                  <span
                    key={gid}
                    className="mini-goal"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectGoal(gid)
                    }}
                  >
                    {GOAL_BY_ID[gid]?.alliance === 'red' ? '红' : GOAL_BY_ID[gid]?.alliance === 'blue' ? '蓝' : '中'}
                    {gid.replace('g-', '')}
                  </span>
                ))}
              </div>
              <div className="toggle-quad">
                象限色：{QUADRANT_ALLIANCE[q] === 'red' ? '红' : '蓝'}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
