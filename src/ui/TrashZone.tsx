import { useEffect, useRef } from 'react'
import { useApp } from '@/state/store'
import { edgeDistances, TRASH_EDGE } from '@/state/drag'
import { stageRect } from '@/scene/bridge'

/**
 * 删除手势的提示层（覆盖在 3D 画布上）：
 *
 *  · 拖动**已经放好的**得分物时，画布四周浮起一层红光；
 *  · 指针越靠近某条边，这条边的红光越亮，其余边保持微弱的底噪；
 *  · 靠近边缘时，最近的那条边中央弹出红色垃圾桶；
 *  · 松手在垃圾桶上 = 删掉这个件。
 *
 * 红光的强度直接写进 DOM 的 CSS 变量（不触发 React 重渲染）：
 * 拖拽时指针每帧都在动，走 state 会白白重渲染整棵组件树。
 */
export function TrashZone() {
  const dragging = useApp((s) => s.dragging)
  const glowRef = useRef<HTMLDivElement>(null)
  const binRef = useRef<HTMLDivElement>(null)

  // 只有「拖动已放置的得分物」才是删除手势；从面板拖新件是放置手势，不该有红光
  const deleting = dragging?.kind === 'stack'

  useEffect(() => {
    if (!deleting) return
    const glow = glowRef.current
    const bin = binRef.current
    if (!glow) return

    let px = 0
    let py = 0

    const update = () => {
      const rect = stageRect()
      const d = edgeDistances(px, py, rect)
      // 0（离得远）→ 1（贴到边缘）
      const prox = Math.max(0, Math.min(1, 1 - Math.max(0, d.nearest) / TRASH_EDGE))

      // 四周统一的暗红晕 + 最近那条边的方向性高光
      glow.style.setProperty('--glow', (0.1 + prox * 0.5).toFixed(3))
      glow.style.setProperty('--hot', (prox * 0.75).toFixed(3))
      glow.style.setProperty(
        '--dir',
        d.side === 'left'
          ? 'to right'
          : d.side === 'right'
            ? 'to left'
            : d.side === 'top'
              ? 'to bottom'
              : 'to top',
      )
      glow.style.opacity = '1'

      if (bin) {
        bin.style.opacity = prox > 0 ? '1' : '0'
        bin.style.transform = `scale(${(0.82 + prox * 0.18).toFixed(3)})`
        // 垃圾桶落在离指针最近的那条边（坐标换算到舞台本地）
        const lx = px - rect.left
        const ly = py - rect.top
        const binW = 92
        const binH = 96
        if (d.side === 'left' || d.side === 'right') {
          bin.style.top = `${Math.max(8, Math.min(rect.height - binH, ly - binH / 2)).toFixed(0)}px`
          bin.style.bottom = 'auto'
          if (d.side === 'left') {
            bin.style.left = '12px'
            bin.style.right = 'auto'
          } else {
            bin.style.right = '12px'
            bin.style.left = 'auto'
          }
        } else {
          bin.style.left = `${Math.max(8, Math.min(rect.width - binW, lx - binW / 2)).toFixed(0)}px`
          bin.style.right = 'auto'
          if (d.side === 'top') {
            bin.style.top = '12px'
            bin.style.bottom = 'auto'
          } else {
            bin.style.bottom = '12px'
            bin.style.top = 'auto'
          }
        }
      }
    }

    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      update()
    }

    // 按下的瞬间也记一下坐标 —— 抓起一个本来就靠着画布边缘的件时，
    // 不该等到第一次移动才知道自己在边缘
    const onDown = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      update()
    }

    const rect = stageRect()
    px = rect.left + rect.width / 2
    py = rect.top + rect.height / 2
    update()

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [deleting])

  if (!deleting) return null

  return (
    <>
      {/* 画布四周的红光 */}
      <div className="trash-glow" ref={glowRef} style={{ opacity: 0 }} />

      {/* 垃圾桶 */}
      <div className="trash-zone" ref={binRef}>
        <svg viewBox="0 0 64 64" width="56" height="56">
          <path
            d="M14 18h36M26 18V10h12v8M18 18l3 38h22l3-38M27 26v22M37 26v22"
            fill="none"
            stroke="#ff4d4f"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="trash-label">松手删除</div>
      </div>
    </>
  )
}
