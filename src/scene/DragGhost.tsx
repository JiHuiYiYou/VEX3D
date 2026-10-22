import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useApp } from '@/state/store'
import { dragPointer } from '@/state/drag'
import { GOAL_BY_ID, toThree } from '@/data/fieldSpec'
import { loadHalfGeometry, useOptionalGeometry } from './assets'
import { pickOnPlane } from './bridge'
import { halfTransform, nextBaseY } from './stackLayout'

const HALF_COLORS: Record<string, string> = {
  red: '#e4002b',
  blue: '#00aeef',
  yellow: '#ffd400',
  gray: '#4a4a4a',
  clear: '#9fd3f5',
}

/** 没在拖东西时占位的两个颜色（红/蓝 pin） */
const IDLE_HALVES: [string, string] = ['red', 'blue']

/**
 * 拖拽中的「幽灵」件。
 *  · 从左侧面板拖出来 → 吸附到目标桩摞顶的落点（合法才吸附，非法时染红并悬空）
 *  · 拖动已放置的件 → 跟随光标在水平面上移动
 */
export function DragGhost() {
  const dragging = useApp((s) => s.dragging)
  const hoverGoalId = useApp((s) => s.hoverGoalId)
  const overTrash = useApp((s) => s.overTrash)
  const group = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)

  // 半体几何 —— **只有 CAD 导出的那一份**（红/蓝/黄 = pin 半体，透明/灰 = cup 半体）
  const halves = dragging?.item.halves ?? IDLE_HALVES
  const geo0 = useOptionalGeometry(() => loadHalfGeometry(halves[0]), [halves[0]])
  const geo1 = useOptionalGeometry(() => loadHalfGeometry(halves[1]), [halves[1]])

  useFrame(() => {
    const g = group.current
    if (!g || !dragging) return
    // 指针不在画布上时不画幽灵件：
    // ① 从左栏**单击**放置时，幽灵件不会在画布边缘闪一下
    // ② 拖拽从左栏出发，进了画布才出现幽灵件
    g.visible = dragPointer.overCanvas
    if (!g.visible) return
    invalidate() // 拖拽时保持连续刷新

    const st = useApp.getState()
    const drop = st.dropTarget
    const illegal = !!drop && !drop.legal

    let x = 0
    let y = 200
    let z = 0
    let snapped = false

    if (hoverGoalId && GOAL_BY_ID[hoverGoalId]) {
      const goal = GOAL_BY_ID[hoverGoalId]
      // ★ 必须用完整的 toThree(x, y, z) = [x, z, −y]：
      // 之前只取前两个分量，把场地的南北方向搞丢了，幽灵件会镜像到中线另一边。
      const [gx, , gz] = toThree(goal.position[0], goal.position[1], 0)
      x = gx
      z = gz
      if (illegal) {
        // 非法叠放：不吸附，悬在 goal 上方等着被拒绝
        y = goal.socket.z + 90
      } else {
        // ★ 吸附到这个摞的落点（按嵌套关系算，不是 socket 顶）
        y = nextBaseY(goal, st.stacks[goal.id] ?? [], dragging.item.kind)
        snapped = true
      }
    } else {
      // 跟随光标：投到**地面**（y=0）—— 和松手时的落点用同一个平面，
      // 件才会落在幽灵件指着的地方（斜视角下这个投影偏差很大，两个地方必须一致）
      const p = pickOnPlane(dragPointer.clientX, dragPointer.clientY, 0)
      if (p) {
        x = p.x
        // 散件是躺在垫子上的 → 底端 0；从面板拖出来的新件「端着」→ 飘着 200
        y = dragging.kind === 'loose' ? 0 : 200
        z = p.z
      }
    }
    g.position.set(x, y, z)
    // 吸附时不自转，免得和摞里的件错位
    if (!snapped) g.rotation.y += 0.02
    g.scale.setScalar(overTrash ? 0.75 : 1)
  })

  if (!dragging) {
    return (
      <group ref={group} name="drag-ghost" visible={false}>
        {geo0 && <mesh geometry={geo0} />}
      </group>
    )
  }

  const item = dragging.item
  const geos = [geo0, geo1]
  const dropTarget = useApp.getState().dropTarget
  const illegal = !!dropTarget && !dropTarget.legal

  return (
    <group ref={group} name="drag-ghost">
      {([0, 1] as const).map((i) => {
        // ★ 用和实物一样的拼法：Pin = 翻边对翻边，Cup = 杯口对杯口
        const t = halfTransform(item, i, 0)
        const c = HALF_COLORS[item.halves[i]]
        const geo = geos[i]
        if (!geo) return null
        return (
          <mesh
            key={i}
            geometry={geo}
            position={t.pos}
            rotation={[t.rotX, 0, 0]}
          >
            <meshStandardMaterial
              color={c}
              transparent
              opacity={0.55}
              roughness={0.4}
              emissive={illegal ? '#ff3b30' : c}
              emissiveIntensity={illegal ? 0.9 : 0.35}
            />
          </mesh>
        )
      })}
    </group>
  )
}
