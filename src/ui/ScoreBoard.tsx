import { useMemo } from 'react'
import { useApp } from '@/state/store'
import { scoreField } from '@/state/scoring'
import { getFieldSpec } from '@/data/fieldSpec'

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

/**
 * 实时计分 —— **只留两个大分数**。
 *
 * 规则说明、逐 goal / 逐 pin 的明细都删了（要看判定理由的话，
 * 规则都在 `src/state/scoring.ts` 里）。
 */
export function ScoreBoard() {
  const scores = useScores()

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
    </section>
  )
}
