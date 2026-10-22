import { useCallback, useEffect, useState } from 'react'
import { FieldScene } from './scene/FieldScene'
import { checkAssets } from './scene/assets'
import { LeftPalette } from './ui/LeftPalette'
import { ScoreBoard } from './ui/ScoreBoard'
import { TrashZone } from './ui/TrashZone'
import { PlaceHint } from './ui/PlaceHint'
import { TopBar } from './ui/TopBar'
import { RulesDrawer } from './ui/RulesDrawer'
import { useApp } from './state/store'
import { useDragController } from './state/useDragController'
import { loadFieldSpec } from './data/fieldSpec'

/**
 * 启动状态。
 *
 * ★ 场地的几何只有 CAD 一份来源：CAD 资产不在，就**直接报错**，
 *   不用「按手册手搓的近似场地」顶替（那看着像官方场地，其实不是）。
 */
type Boot =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

export default function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' })
  useDragController()

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // 先体检：少任何一个 CAD 资产就直接说清楚缺哪个
        const { missing } = await checkAssets()
        if (missing.length) {
          throw new Error(`缺少 CAD 资产：${missing.join('、')}`)
        }
        await loadFieldSpec()
        if (alive) setBoot({ status: 'ready' })
      } catch (err) {
        if (!alive) return
        setBoot({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 快捷键：F 翻转选中件 / Delete 删除 / Esc 取消选中
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState()
      if (e.key === 'Escape') {
        st.selectGoal(null)
        st.selectToggle(null)
        st.selectItem(null)
        st.setPending(null) // 手里的件放下了
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

  // 稳定引用：CadField 的 effect 依赖它，identity 变了就会重跑
  const fail = useCallback((message: string) => {
    setBoot((b) =>
      b.status === 'error' && b.message === message ? b : { status: 'error', message },
    )
  }, [])

  if (boot.status === 'loading') {
    return <div className="loading">正在载入场地…</div>
  }

  if (boot.status === 'error') {
    return (
      <div className="boot-error">
        <h1>没有 CAD 场地资产</h1>
        <p className="boot-error-msg">{boot.message}</p>
        <p>
          这个 app 的场地几何<strong>只有官方 Field CAD 一份来源</strong>，没有手搓的兜底版本 ——
          缺资产就直接报错，免得看到一个「像官方场地但其实不是」的东西。
        </p>
        <pre>
          {`# 1. 解析官方 STEP（首次约 8 分钟）
tools/.venv/Scripts/python.exe tools/build_cache.py
# 2. 出资产（约 15 秒）
tools/.venv/Scripts/python.exe tools/extract_field.py --with-wall-trim`}
        </pre>
        <p className="boot-error-hint">细节见 README「重新生成 CAD 资产」。</p>
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <LeftPalette />
        <div className="stage">
          <FieldScene onError={fail} />
          <TrashZone />
          <PlaceHint />
        </div>
        <div className="right-col">
          <ScoreBoard />
          <RulesDrawer />
        </div>
      </div>
    </div>
  )
}
