/**
 * 拖拽过程中每帧都会变化的指针状态。
 *
 * 刻意**不放进 zustand**：pointermove 每秒能触发几十次，
 * 放进 store 会让 React 每帧重渲染，直接毁掉「不能有明显卡顿」的要求。
 * 3D 场景在 useFrame 里直接读这个普通对象，不触发任何 React 更新。
 */
export const dragPointer = {
  /** 最近的 pointer 位置（client 坐标） */
  clientX: 0,
  clientY: 0,
  /** 指针是否在 3D 画布上 */
  overCanvas: false,
  /** 本次拖拽是否由画布内的得分物发起（区别于从左侧面板发起） */
  fromCanvas: false,
}

/** 离 3D 画布边缘多少像素内算「靠近垃圾桶」 */
export const TRASH_EDGE = 90

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom'

/**
 * 指针到画布四条边的距离，以及最近的是哪条边。
 *
 * 注意用的是**画布**（3D 区域）的矩形，不是整个窗口 ——
 * 窗口左右各有一块面板，拿窗口当基准的话「左边缘」整块都在面板底下，
 * 垃圾桶根本露不出来。
 */
export function edgeDistances(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): {
  left: number
  right: number
  top: number
  bottom: number
  nearest: number
  side: EdgeSide
} {
  const left = clientX - rect.left
  const right = rect.right - clientX
  const top = clientY - rect.top
  const bottom = rect.bottom - clientY
  const nearest = Math.min(left, right, top, bottom)
  const side: EdgeSide =
    nearest === left ? 'left' : nearest === right ? 'right' : nearest === top ? 'top' : 'bottom'
  return { left, right, top, bottom, nearest, side }
}

export function resetDragPointer() {
  dragPointer.clientX = 0
  dragPointer.clientY = 0
  dragPointer.overCanvas = false
  dragPointer.fromCanvas = false
}
