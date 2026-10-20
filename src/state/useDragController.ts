import { useEffect } from 'react'
import { useApp } from './store'
import { dragPointer, resetDragPointer, edgeDistances, TRASH_EDGE } from './drag'
import { pickDropTarget, sceneBridge, stageRect } from '@/scene/bridge'

/**
 * 全局拖拽控制器。
 *
 * 用 window 上的 pointer 事件（而不是只在 canvas 上），
 * 这样从左侧面板拖到画布、从画布拖到屏幕边缘是同一套逻辑。
 * 指针的实时坐标放在普通对象里（不触发 React 重渲染）；
 * 只有「悬停到哪个桩」「是否在垃圾桶上」这种离散状态才进 store。
 */
export function useDragController() {
  const dragging = useApp((s) => s.dragging)

  useEffect(() => {
    if (!dragging) {
      resetDragPointer()
      return
    }

    const onMove = (e: PointerEvent) => {
      const st = useApp.getState()
      dragPointer.clientX = e.clientX
      dragPointer.clientY = e.clientY

      const rect = sceneBridge.domElement?.getBoundingClientRect()
      const overCanvas =
        !!rect &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      dragPointer.overCanvas = overCanvas

      // 靠近 3D 画布的边缘 → 垃圾桶（基准是画布，不是整个窗口）
      const stage = stageRect()
      const insideCanvas =
        e.clientX >= stage.left &&
        e.clientX <= stage.right &&
        e.clientY >= stage.top &&
        e.clientY <= stage.bottom
      const { nearest } = edgeDistances(e.clientX, e.clientY, stage)
      // 只有拖「已放好的件」才是删除手势；面板里拖新件靠边不算数（照常放件）
      st.setOverTrash(st.dragging?.kind === 'stack' && insideCanvas && nearest < TRASH_EDGE)

      // 拾取放置目标
      if (overCanvas) {
        const hit = pickDropTarget(e.clientX, e.clientY)
        st.setHoverGoal(hit ? (hit.userData.goalId as string) : null)
      } else {
        st.setHoverGoal(null)
      }

      // frameloop="demand"：指针移动时主动要一帧，幽灵件才会跟手
      sceneBridge.invalidate?.()
    }

    const onUp = () => {
      const st = useApp.getState()
      const d = st.dragging
      if (!d) return
      if (st.overTrash) {
        // 拖到垃圾桶 → 删除已放置的件；面板里拖出来的东西直接丢弃
        if (d.kind === 'stack') st.removeItem(d.goalId, d.item.id)
      } else if (d.kind === 'palette' && st.hoverGoalId) {
        st.placeItem(st.hoverGoalId, d.item)
      }
      st.setDragging(null)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp, { capture: true })
    window.addEventListener('pointercancel', onUp, { capture: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, { capture: true })
      window.removeEventListener('pointercancel', onUp, { capture: true })
    }
  }, [dragging])
}
