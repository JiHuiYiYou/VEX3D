import { useMemo, useState } from 'react'
import { useApp } from '@/state/store'
import { scoreField } from '@/state/scoring'
import { getFieldSpec, GOAL_BY_ID, PIN_COLOR_LABEL, goalName } from '@/data/fieldSpec'
import type { HalfResult } from '@/state/scoring'

export function useScores() {
  const stacks = useApp((s) => s.stacks)
  const toggles = useApp((s) => s.toggles)
  const midfieldCounts = useApp((s) => s.midfieldCounts)
  return useMemo(() => {
    const spec = getFieldSpec()
    return scoreField({
      stacks,
      toggles,
      goals: spec.goals,
      midfieldCounts,
    })
  }, [stacks, toggles, midfieldCounts])
}

/** 一个 pin 的两半（聚成一行显示） */
interface PinRow {
  itemId: string
  lower: HalfResult
  upper: HalfResult
  red: number
  blue: number
  blocked: boolean
}

export function ScoreBoard() {
  const scores = useScores()
  const counts = useApp((s) => s.midfieldCounts)
  const [hover, setHover] = useState<string | null>(null)

  /** 按 goal → pin 分组（一个 pin 一行，两个色点 = 上下两半） */
  const byGoal = useMemo(() => {
    const map: Record<string, PinRow[]> = {}
    for (const h of scores.halves) {
      ;(map[h.goalId] ??= [])
      const rows = map[h.goalId]
      let row = rows.find((r) => r.itemId === h.itemId)
      if (!row) {
        row = {
          itemId: h.itemId,
          lower: h,
          upper: h,
          red: 0,
          blue: 0,
          blocked: false,
        }
        rows.push(row)
      }
      if (h.halfIndex === 0) row.lower = h
      else row.upper = h
      if (h.scored) {
        if (h.alliance === 'red') row.red += h.points
        else row.blue += h.points
      }
      if (h.covered && !h.scored) row.blocked = true
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
        联盟色 pin 半 5 分 · 被拥有的黄色 pin 半 10 分 · 中场每台机器人 8 分
        {(counts.red > 0 || counts.blue > 0) && (
          <>
            <br />
            <span className="muted">
              中场机器人：红 {counts.red} 台 <b className="red-txt">+{scores.robotPoints.red}</b> ·
              蓝 {counts.blue} 台 <b className="blue-txt">+{scores.robotPoints.blue}</b>
            </span>
          </>
        )}
        {scores.blocked > 0 && (
          <>
            <br />
            <span className="warn">⚠ {scores.blocked} 个 pin 半被挡住，不得分</span>
          </>
        )}
      </div>

      <div className="score-list">
        {Object.entries(byGoal).map(([goalId, rows]) => {
          const g = GOAL_BY_ID[goalId]
          const red = rows.reduce((s, r) => s + r.red, 0)
          const blue = rows.reduce((s, r) => s + r.blue, 0)
          return (
            <div key={goalId} className="score-goal">
              <div className="score-goal-head">
                <span title={g ? goalName(g) : goalId}>{g ? goalName(g) : goalId}</span>
                <span>
                  <b className="red-txt">{red}</b> / <b className="blue-txt">{blue}</b>
                </span>
              </div>
              {rows.map((row) => {
                const key = row.itemId
                const reasons = [row.lower.reason, row.upper.reason]
                return (
                  <div
                    key={key}
                    className={`half-row ${row.blocked ? 'blocked' : ''}`}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                    title={reasons.join('\n')}
                  >
                    <i className={`dot ${row.lower.color}`} />
                    <i className={`dot ${row.upper.color}`} />
                    <span className="half-name">
                      {PIN_COLOR_LABEL[row.lower.color]} / {PIN_COLOR_LABEL[row.upper.color]}
                    </span>
                    <span className="half-pts">
                      <b className="red-txt">{row.red}</b> / <b className="blue-txt">{row.blue}</b>
                    </span>
                    {hover === key && (
                      <div className="reason">
                        <div>下：{reasons[0]}</div>
                        <div>上：{reasons[1]}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        {Object.keys(byGoal).length === 0 && (
          <div className="hint small">还没有放置任何得分物。</div>
        )}
      </div>
    </section>
  )
}
