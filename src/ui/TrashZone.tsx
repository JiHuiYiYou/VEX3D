import { useEffect, useRef } from 'react'
import { useApp } from '@/state/store'
import { trashSlot } from '@/state/drag'

/**
 * 删除手势的提示层（覆盖在 3D 画布上）：
 *
 *  · 拖动**已经放好的**得分物 / 散件时，画布**右上角**出现一个小红方块；
 *  · 方块里有个小垃圾桶图标，**松手在里面 = 删掉这个件**；
 *  · 指针压上去时方块会亮一下。
 *
 * ★ 为什么不用「拖到画布边缘」：边缘太容易误触（尤其是斜视角下，
 *   只想把件挪个位置却蹭到了边缘）。固定一个角、明确一个落点，
 *   比「越靠边越红」安全得多。
 *
 * 方块的 DOM 元素登记在 `state/drag.ts` 的 `trashSlot` 里 ——
 * 拖拽控制器靠它判断松手时删不删（不走 React state，避免每帧重渲染）。
 */
export function TrashZone() {
  const dragging = useApp((s) => s.dragging)
  const overTrash = useApp((s) => s.overTrash)
  const ref = useRef<HTMLDivElement>(null)

  // 只有「拖动已放置的得分物 / 散件」才是删除手势；从面板拖新件是放置手势，不该出现
  const deleting = dragging?.kind === 'stack' || dragging?.kind === 'loose'

  useEffect(() => {
    trashSlot.el = deleting ? ref.current : null
    return () => {
      trashSlot.el = null
    }
  }, [deleting])

  if (!deleting) return null

  return (
    <div className={`trash-slot ${overTrash ? 'over' : ''}`} ref={ref}>
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path
          d="M4.5 7h15M10 7V4.8h4V7M6.6 7l.9 12.2h9l.9-12.2M10 10.5v5.5M14 10.5v5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
