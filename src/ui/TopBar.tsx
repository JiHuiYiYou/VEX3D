import { useApp, QUALITY_LABEL } from '@/state/store'
import { INITIAL_GOAL_STACKS, INITIAL_LOOSE } from '@/data/presets'
import { applyView, type ViewPreset } from '@/scene/bridge'
import type { Quality } from '@/state/store'

const VIEWS: { id: ViewPreset; label: string; title: string }[] = [
  { id: 'iso', label: '45°', title: '默认斜视角（朝东看，相机在西侧 = 红方近场那头）' },
  { id: 'top', label: '俯视', title: '正上方俯视（北在上）' },
]

const QUALITIES: Quality[] = ['high', 'medium', 'low']

/** 锁：锁定时是闭的（相机动不了），解锁时是开的 */
function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {locked ? (
        <path
          d="M7.5 10V7.2a4.5 4.5 0 0 1 9 0V10"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M7.5 10V7.2a4.5 4.5 0 0 1 8.6-1.8"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      )}
      <rect
        x="4.6"
        y="10"
        width="14.8"
        height="10.4"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.9"
      />
    </svg>
  )
}

/** 区域染色：四个小方块 = 四个区域 */
function TintIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="8.5" height="8.5" rx="1.6" fill="#e4002b" opacity="0.75" />
      <rect x="12.5" y="3" width="8.5" height="8.5" rx="1.6" fill="#00aeef" opacity="0.75" />
      <rect x="3" y="12.5" width="8.5" height="8.5" rx="1.6" fill="#ffd400" opacity="0.75" />
      <rect x="12.5" y="12.5" width="8.5" height="8.5" rx="1.6" fill="#3ad0e6" opacity="0.75" />
    </svg>
  )
}

export function TopBar() {
  const resetField = useApp((s) => s.resetField)
  const applySetup = useApp((s) => s.applySetup)
  const quality = useApp((s) => s.quality)
  const setQuality = useApp((s) => s.setQuality)
  const viewLocked = useApp((s) => s.viewLocked)
  const setViewLocked = useApp((s) => s.setViewLocked)
  const showTint = useApp((s) => s.showQuadrantTint)
  const toggleQuadrantTint = useApp((s) => s.toggleQuadrantTint)

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3 19.5 12 12 21 4.5 12z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          </svg>
        </span>
        <span className="brand-main">VEX Override 3D 战术分析</span>
      </div>

      <div className="topbar-actions">
        {/* 视角锁定：锁住当前视角，相机就动不了了（视角卡片也失效） */}
        <button
          className={`tbtn view-btn lock-btn ${viewLocked ? 'active' : ''}`}
          title={viewLocked ? '已锁定视角 —— 点一下解锁' : '锁定当前视角（相机动不了，视角卡片也失效）'}
          aria-pressed={viewLocked}
          onClick={() => setViewLocked(!viewLocked)}
        >
          <LockIcon locked={viewLocked} />
        </button>

        <div className="view-group">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="tbtn view-btn"
              title={v.title}
              disabled={viewLocked}
              onClick={() => applyView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <button
          className={`tbtn view-btn icon-btn ${showTint ? 'active' : ''}`}
          title="按 Toggle 状态给四个区域染色"
          aria-pressed={showTint}
          onClick={toggleQuadrantTint}
        >
          <TintIcon />
        </button>

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
