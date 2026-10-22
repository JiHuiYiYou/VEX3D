import { useEffect } from 'react'
import { useApp } from './store'
import {
  dragPointer,
  resetDragPointer,
  edgeDistances,
  TRASH_EDGE,
  DRAG_THRESHOLD,
} from './drag'
import { pickDropTarget, pickOnPlane, sceneBridge, stageRect } from '@/scene/bridge'

/**
 * 全局拖拽控制器。
 *
 * 用 window 上的 pointer 事件（而不是只在 canvas 上），
 * 这样从左侧面板拖到画布、从画布拖到屏幕边缘是同一套逻辑。
 * 指针的实时坐标放在普通对象里（不触发 React 重渲染）；
 * 只有「悬停到哪个桩」「是否在垃圾桶上」这种离散状态才进 store。
 *
 * ★ **点击 ≠ 拖动**：指针没移动过（`dragPointer.moved === false`）时，
 *   松手只当作「选中」，不挪位置、不放上 goal、不删东西。
 *   否则单击场上的散件会被当成「丢到地面」，而落点是用射线打水平面算的
 *   （斜视角下偏差能到好几米）→ 件会飞到天边，看起来像凭空消失 ✗
 */
export function useDragController() {
  const dragging = useApp((s) => s.dragging)

  // ① 指针位置一直跟踪（要靠它区分点击和拖动，所以不能只在拖拽时才记）
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      dragPointer.clientX = e.clientX
      dragPointer.clientY = e.clientY

      const st = useApp.getState()
      if (!st.dragging) return

      // 本次按下之后指针有没有挪过
      if (
        Math.hypot(e.clientX - dragPointer.startX, e.clientY - dragPointer.startY) >
        DRAG_THRESHOLD
      ) {
        dragPointer.moved = true
      }

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
      // 只有拖「已放好的件 / 散件」才是删除手势；面板里拖新件靠边不算数（照常放件）
      const kind = st.dragging?.kind
      const deleting = kind === 'stack' || kind === 'loose'
      st.setOverTrash(deleting && insideCanvas && nearest < TRASH_EDGE)

      // 拾取放置目标
      if (overCanvas) {
        const hit = pickDropTarget(e.clientX, e.clientY)
        const goalId = hit ? (hit.userData.goalId as string) : null
        st.setHoverGoal(goalId)
        st.setDropTarget(goalId)
      } else {
        st.setHoverGoal(null)
        st.setDropTarget(null)
      }

      // frameloop="demand"：指针移动时主动要一帧，幽灵件才会跟手
      sceneBridge.invalidate?.()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // ② 一次拖拽的开始 / 结束
  useEffect(() => {
    if (!dragging) {
      resetDragPointer()
      return
    }

    // 本次的起点 = 按下时的指针位置；还没动过 → 这次算「点击」
    dragPointer.startX = dragPointer.clientX
    dragPointer.startY = dragPointer.clientY
    dragPointer.moved = false
    // 上一次拖拽可能停在垃圾桶边上 → 状态要清掉，别连累下一次点击
    useApp.getState().setOverTrash(false)

    const onUp = () => {
      const st = useApp.getState()
      const d = st.dragging
      if (!d) return
      const moved = dragPointer.moved

      if (moved && st.overTrash) {
        // 拖到垃圾桶 → 删除（已放好的件 / 散件）；面板里拖出来的东西直接丢弃
        if (d.kind === 'stack') st.removeItem(d.goalId, d.item.id)
        else if (d.kind === 'loose') st.removeLoose(d.looseId)
      } else if (moved && d.kind === 'palette' && st.hoverGoalId) {
        st.placeItem(st.hoverGoalId, d.item)
      } else if (moved && d.kind === 'loose') {
        // 散件：落在 goal 上 → 进那个 goal 的摞（非法组合 placeItem 会拒绝）；
        // 否则 → 挪到落地的位置
        if (st.hoverGoalId) {
          if (st.placeItem(st.hoverGoalId, d.item)) st.removeLoose(d.looseId)
        } else {
          const p = pickOnPlane(dragPointer.clientX, dragPointer.clientY, 0)
          // three 的 z = −场地 Y
          if (p) st.moveLoose(d.looseId, p.x, -p.z)
        }
      }
      // 没移动过 = 点击 → 什么都不做（选中已经在 pointerDown 时做过了）
      // 移动过 → 「端着的件」作废（它是拖走的，不是点 goal 放上去的）
      if (moved) st.setPending(null)
      st.setDragging(null)
    }

    window.addEventListener('pointerup', onUp, { capture: true })
    window.addEventListener('pointercancel', onUp, { capture: true })
    return () => {
      window.removeEventListener('pointerup', onUp, { capture: true })
      window.removeEventListener('pointercancel', onUp, { capture: true })
    }
  }, [dragging])
}
