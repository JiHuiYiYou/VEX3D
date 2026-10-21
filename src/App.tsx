import { useEffect, useState } from 'react'
import { FieldScene } from './scene/FieldScene'
import { LeftPalette } from './ui/LeftPalette'
import { ScoreBoard } from './ui/ScoreBoard'
import { TogglePanel } from './ui/TogglePanel'
import { TrashZone } from './ui/TrashZone'
import { PlaceHint } from './ui/PlaceHint'
import { TopBar } from './ui/TopBar'
import { RulesDrawer } from './ui/RulesDrawer'
import { useApp } from './state/store'
import { useDragController } from './state/useDragController'
import { loadFieldSpec } from './data/fieldSpec'

export default function App() {
  const [ready, setReady] = useState(false)
  useDragController()

  useEffect(() => {
    loadFieldSpec().then(() => setReady(true))
  }, [])

  // 快捷键：F 翻转选中件 / Delete 删除 / Esc 取消选中
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState()
      if (e.key === 'Escape') {
        st.selectGoal(null)
        st.selectItem(null)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selectedGoalId && st.selectedItemId) {
          st.removeItem(st.selectedGoalId, st.selectedItemId)
          e.preventDefault()
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        if (st.selectedGoalId && st.selectedItemId) {
          st.flipItem(st.selectedGoalId, st.selectedItemId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <LeftPalette />
        <div className="stage">
          {ready ? <FieldScene /> : <div className="loading">正在载入场地…</div>}
          <TrashZone />
          <PlaceHint />
        </div>
        <div className="right-col">
          <ScoreBoard />
          <TogglePanel />
          <RulesDrawer />
        </div>
      </div>
    </div>
  )
}
