import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useApp } from '@/state/store'
import { dragPointer } from '@/state/drag'
import { HALVES, GOAL_BY_ID, toThree } from '@/data/fieldSpec'
import { cupHalfGeometry, pinHalfGeometry } from './geometry'
import { pickOnPlane } from './bridge'

const PIN_GEO = pinHalfGeometry(HALVES.pin)
const CUP_GEO = cupHalfGeometry(HALVES.cup)

const HALF_COLORS: Record<string, string> = {
  red: '#e4002b',
  blue: '#00aeef',
  yellow: '#ffd400',
  gray: '#4a4a4a',
  clear: '#9fd3f5',
}

/**
 * 拖拽中的「幽灵」件。
 *  · 从左侧面板拖出来 → 吸附到目标桩的堆栈顶端（合法落点会高亮）
 *  · 拖动已放置的件 → 跟随光标在水平面上移动
 */
export function DragGhost() {
  const dragging = useApp((s) => s.dragging)
  const hoverGoalId = useApp((s) => s.hoverGoalId)
  const overTrash = useApp((s) => s.overTrash)
  const group = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)

  const pinGeo = useMemo(() => PIN_GEO, [])
  const cupGeo = useMemo(() => CUP_GEO, [])

  useFrame(() => {
    const g = group.current
    if (!g || !dragging) return
    g.visible = true
    invalidate() // 拖拽时保持连续刷新

    let x = 0
    let y = 200
    let z = 0

    if (hoverGoalId && GOAL_BY_ID[hoverGoalId]) {
      // 吸附到桩顶
      const goal = GOAL_BY_ID[hoverGoalId]
      const [gx, gy] = toThree(goal.position[0], goal.position[1], 0)
      x = gx
      z = gy
      y = goal.socket.z - goal.socket.depth + 14
    } else {
      // 跟随光标（投到 y=200 的水平面）
      const p = pickOnPlane(dragPointer.clientX, dragPointer.clientY, 200)
      if (p) {
        x = p.x
        y = 200
        z = p.z
      }
    }
    g.position.set(x, y, z)
    g.rotation.y += 0.02
    const s = overTrash ? 0.75 : 1
    g.scale.setScalar(s)
  })

  if (!dragging) {
    return (
      <group ref={group} visible={false}>
        <mesh geometry={pinGeo} />
      </group>
    )
  }

  const item = dragging.item
  const geo = item.kind === 'pin' ? pinGeo : cupGeo
  const h = item.kind === 'pin' ? HALVES.pin.height : HALVES.cup.height
  const overlap = h * 2 - (item.kind === 'pin' ? 165 : 164.5)

  return (
    <group ref={group}>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          geometry={geo}
          position={[0, i === 0 ? h : h - overlap, 0]}
          rotation={[i === 0 ? 0 : Math.PI, 0, 0]}
        >
          <meshStandardMaterial
            color={HALF_COLORS[item.halves[i]]}
            transparent
            opacity={0.55}
            roughness={0.4}
            emissive={HALF_COLORS[item.halves[i]]}
            emissiveIntensity={0.35}
          />
        </mesh>
      ))}
    </group>
  )
}
