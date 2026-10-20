import { useMemo, useState } from 'react'
import { useApp } from '@/state/store'
import { scoreField } from '@/state/scoring'
import { getFieldSpec, GOAL_BY_ID } from '@/data/fieldSpec'

export function useScores() {
  const stacks = useApp((s) => s.stacks)
  const toggles = useApp((s) => s.toggles)
  return useMemo(() => {
    const spec = getFieldSpec()
    return scoreField({ stacks, toggles, goals: spec.goals })
  }, [stacks, toggles])
}

export function ScoreBoard() {
  const scores = useScores()
  const [hover, setHover] = useState<string | null>(null)

  const byGoal = useMemo(() => {
    const map: Record<string, typeof scores.halves> = {}
    for (const h of scores.halves) {
      ;(map[h.goalId] ??= []).push(h)
    }
    return map
  }, [scores])

  return (
    <section className="panel panel-score">
      <div className="panel-title">实时计分</div>

      <div className="score-row big">
        <div className="score-cell red">
          <div className="score-num">{scores.red}</div>
          <div className="score-label">红方</div>
        </div>
        <div className="score-vs">:</div>
        <div className="score-cell blue">
          <div className="score-num">{scores.blue}</div>
          <div className="score-label">蓝方</div>
        </div>
      </div>

      <div className="score-note">
        联盟色 Pin 半 5 分 · 被拥有的黄色 Pin 半 10 分
        {scores.blocked > 0 && (
          <>
            <br />
            <span className="warn">⚠ {scores.blocked} 个端子被不透明杯遮挡，不得分</span>
          </>
        )}
      </div>

      <div className="score-list">
        {Object.entries(byGoal).map(([goalId, halves]) => {
          const g = GOAL_BY_ID[goalId]
          const red = halves.filter((h) => h.alliance === 'red').reduce((s, h) => s + h.points, 0)
          const blue = halves.filter((h) => h.alliance === 'blue').reduce((s, h) => s + h.points, 0)
          return (
            <div key={goalId} className="score-goal">
              <div className="score-goal-head">
                <span>{g?.id ?? goalId}</span>
                <span>
                  <b className="red-txt">{red}</b> / <b className="blue-txt">{blue}</b>
                </span>
              </div>
              {halves.map((h) => {
                const key = `${h.itemId}-${h.halfIndex}`
                return (
                  <div
                    key={key}
                    className={`half-row ${h.scored ? '' : 'blocked'}`}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                    title={h.reason}
                  >
                    <i className={`dot ${h.color}`} />
                    <span className="half-name">
                      {h.color}
                      {h.halfIndex === 0 ? '（下）' : '（上）'}
                    </span>
                    <span className="half-pts">
                      {h.scored ? `+${h.points} ${h.alliance === 'red' ? '红' : '蓝'}` : '0'}
                    </span>
                    {hover === key && <div className="reason">{h.reason}</div>}
                  </div>
                )
              })}
            </div>
          )
        })}
        {Object.keys(byGoal).length === 0 && <div className="hint small">还没有放置任何得分物。</div>}
      </div>
    </section>
  )
}
