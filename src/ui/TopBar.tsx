import { useApp, QUALITY_LABEL } from '@/state/store'
import { getFieldSpec } from '@/data/fieldSpec'
import { INITIAL_GOAL_STACKS, INITIAL_LOOSE } from '@/data/presets'
import { applyView, type ViewPreset } from '@/scene/bridge'
import type { Quality } from '@/state/store'

const VIEWS: { id: ViewPreset; label: string; title: string }[] = [
  { id: 'iso', label: '45°', title: '默认斜视角（朝西看，相机在东侧）' },
  { id: 'top', label: '俯视', title: '正上方俯视（北在上）' },
  { id: 'west', label: '正西', title: '朝西平视（相机在东侧）' },
  { id: 'low', label: '贴地', title: '贴着场地、朝西看' },
]

const QUALITIES: Quality[] = ['high', 'medium', 'low']

export function TopBar() {
  const resetField = useApp((s) => s.resetField)
  const applySetup = useApp((s) => s.applySetup)
  const selectedGoalId = useApp((s) => s.selectedGoalId)
  const selectedItemId = useApp((s) => s.selectedItemId)
  const flipItem = useApp((s) => s.flipItem)
  const quality = useApp((s) => s.quality)
  const setQuality = useApp((s) => s.setQuality)
  const spec = getFieldSpec()

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-main">VEX Override 3D 战术分析</span>
        <span className="brand-sub">
          {spec.source.startsWith('built-in') ? '内置兜底几何（CAD 未载入）' : spec.source}
        </span>
      </div>

      <div className="topbar-actions">
        <div className="view-group">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="tbtn view-btn"
              title={v.title}
              onClick={() => applyView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="view-group" title="画质：机器吃力时调到「中」或「低」">
          {QUALITIES.map((q) => (
            <button
              key={q}
              className={`tbtn view-btn ${quality === q ? 'active' : ''}`}
              onClick={() => setQuality(q)}
            >
              {QUALITY_LABEL[q]}
            </button>
          ))}
        </div>

        {selectedGoalId && selectedItemId && (
          <button
            className="tbtn"
            onClick={() => flipItem(selectedGoalId, selectedItemId)}
            title="翻转这个件的上下两半（快捷键 F）"
          >
            翻转选中件
          </button>
        )}
        <button
          className="tbtn"
          title="按官方开局示意图摆好全场：goal 上的得分物、场地散件、红/蓝装填区"
          onClick={() => {
            applySetup({ stacks: INITIAL_GOAL_STACKS, loose: INITIAL_LOOSE })
            applyView('setup')
          }}
        >
          摆场
        </button>
        <button className="tbtn" onClick={resetField} title="清空所有得分物与 Toggle 状态">
          重置
        </button>
      </div>
    </header>
  )
}
