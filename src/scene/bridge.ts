import * as THREE from 'three'
import { DEBUG } from '@/devTools'
import { useApp } from '@/state/store'

/**
 * 3D 场景 ↔ DOM 拖拽控制器之间的桥。
 *
 * 放在模块级（而不是 React state）有两个原因：
 *  1. pointermove 每秒几十次，走 React state 会把整棵树重渲染；
 *  2. pointerup 需要**同步**做一次拾取，不能等下一帧 useFrame —— 否则
 *     「松手那一刻指针在哪」和「悬停高亮的是哪个桩」可能对不上。
 */
export const sceneBridge = {
  camera: null as THREE.Camera | null,
  domElement: null as HTMLElement | null,
  /** 每个 Goal 的放置目标（不可见的圆柱） */
  dropTargets: [] as THREE.Object3D[],
  /** 每个散件组的拾取体（不可见的圆柱）—— 判断「拖到另一个散件上」 */
  looseTargets: [] as THREE.Object3D[],
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  /** frameloop="demand" 时需要主动请求下一帧 */
  invalidate: null as null | (() => void),
  /** 渲染器（调试用：看 draw call / 三角形数） */
  renderer: null as null | THREE.WebGLRenderer,
  /** three.js 场景根节点（便于调试/测试） */
  scene: null as null | THREE.Scene,
  /** OrbitControls 实例（用于切换预设视角） */
  controls: null as null | { target: THREE.Vector3; update: () => void },
}

export type ViewPreset = 'iso' | 'top'

/**
 * 切到预设视角。
 *
 * 命名约定：**按钮名 = 镜头朝着的方向**（不是镜头站在哪一边）。
 *
 * ★ 默认视角朝**东**看 —— 相机站在**西侧**（红方近场那一头），红近就在画面前景，
 *   画面左 = 北、右 = 南。也就是「以自己（红方）的近场为默认」。
 *   俯视图保持**北在上**（标准地图朝向，不跟着 3D 转）。
 *   场地方向 ↔ 区域：东=蓝近、北=蓝远、南=红远、西=红近。
 */
export function applyView(preset: ViewPreset) {
  const { camera, controls, invalidate } = sceneBridge
  if (!camera) return
  // ★ 视角锁定时，视角卡片（和「摆场」里的切视角）全部失效 —— 锁定就是不动。
  if (useApp.getState().viewLocked) return
  // ★ 先把 OrbitControls 的**残余阻尼**甩掉：用户刚转过相机的话，
  //   update() 会把相机从预设视角上继续往外推 → 按「45°」不落在 45° 上 ✗
  if (controls) for (let i = 0; i < 30; i++) controls.update()
  switch (preset) {
    case 'top':
      camera.position.set(0, 5200, 0)
      camera.up.set(0, 0, -1) // 画面上方 = 场地北
      break
    default:
      // 45°：相机在西侧（红近）朝东看
      camera.position.set(-4100, 3400, 0)
      camera.up.set(0, 1, 0)
      break
  }
  camera.lookAt(0, 0, 0)
  if (controls) {
    controls.target.set(0, 0, 0)
    controls.update()
  }
  invalidate?.()
}

export function resetBridge() {
  sceneBridge.dropTargets = []
  sceneBridge.looseTargets = []
}

/**
 * 3D 画布（= 舞台）的屏幕矩形。画布还没建好时退回整个窗口。
 *
 * 「靠近边缘」的判定和垃圾桶的位置都以这个矩形为基准，
 * 而不是整个窗口 —— 窗口右边有一块面板，用窗口当基准的话右边缘整块被面板盖住。
 */
export function stageRect(): DOMRect {
  const el = sceneBridge.domElement
  if (el) return el.getBoundingClientRect()
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

// 暴露出来，方便端到端脚本检查拾取目标（生产构建要 ?debug=1，见 devTools.ts）
if (DEBUG) {
  ;(window as unknown as { __bridge?: typeof sceneBridge }).__bridge = sceneBridge
}

/**
 * 屏幕坐标 → 命中哪个 Goal。
 *
 * 同时对 **Goal 实体网格**和**放置目标柱**做射线：取最近的一个命中。
 * 只用柱子的话，用户的指针落在 goal 本体较高处就会脱靶；加上实体网格后「指哪打哪」。
 */
export function pickDropTarget(clientX: number, clientY: number): THREE.Object3D | null {
  const { camera, domElement, raycaster, pointer } = sceneBridge
  if (!camera || !domElement) return null
  const rect = domElement.getBoundingClientRect()
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null
  }
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  // 直接传数组（`intersectObjects` 不会改它）→ 每次 pointermove 少造一个数组
  const hits = raycaster.intersectObjects(sceneBridge.dropTargets, false)
  return hits.length ? hits[0].object : null
}

/** 屏幕坐标 → 与某个水平面 (y = planeY) 的交点（用于拖拽幽灵件跟随光标） */
export function pickOnPlane(
  clientX: number,
  clientY: number,
  planeY: number,
): THREE.Vector3 | null {
  const { camera, domElement, raycaster, pointer } = sceneBridge
  if (!camera || !domElement) return null
  const rect = domElement.getBoundingClientRect()
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
  const out = new THREE.Vector3()
  return raycaster.ray.intersectPlane(plane, out) ? out : null
}

/**
 * 屏幕坐标 → 命中哪个散件组（拖到一个散件上 = 跟它**组合**）。
 *
 * 跟 `pickDropTarget` 一样是手动射线（拾取体都是 `visible={false}` 的，
 * R3F 自己的事件系统只认「带 handler 的对象」）。
 */
export function pickLooseTarget(
  clientX: number,
  clientY: number,
  excludeGroupId?: string,
): string | null {
  const { camera, domElement, raycaster, pointer } = sceneBridge
  if (!camera || !domElement) return null
  const rect = domElement.getBoundingClientRect()
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null
  }
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(sceneBridge.looseTargets, false)
  for (const h of hits) {
    const gid = h.object.userData.groupId as string | undefined
    if (gid && gid !== excludeGroupId) return gid
  }
  return null
}
