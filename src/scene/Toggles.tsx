import { useMemo } from 'react'
import * as THREE from 'three'
import { useApp } from '@/state/store'
import { COLORS, getFieldSpec, toThree } from '@/data/fieldSpec'
import type { ToggleState } from '@/data/fieldSpec'

const STATE_COLOR: Record<ToggleState, string> = {
  red: COLORS.red,
  blue: COLORS.blue,
  yellow: COLORS.yellow,
}

export const STATE_LABEL: Record<ToggleState, string> = {
  red: '红',
  blue: '蓝',
  yellow: '黄',
}

/**
 * 4 个 Toggle：贴在围栏每条边的中点。
 *
 * CAD 实测（`public/assets/field.json`）：零件是 `276-9250-023_GREY`，
 * 长 **656.2 mm**、宽 51.59 mm、高 55.65 mm，中心离地 331.6 mm，
 * 位于 (0, ±1817.04) 与 (±1817.04, 0)。与手册的 25.8 in 吻合 ✓
 */
export function Toggles() {
  const toggles = useApp((s) => s.toggles)
  const cycleToggle = useApp((s) => s.cycleToggle)
  const setHoverGoal = useApp((s) => s.setHoverGoal)
  const spec = getFieldSpec()

  const geo = useMemo(() => {
    // three.js 里 Y 是竖直轴：[长 X, 高 Y, 厚 Z]
    const t = spec.toggles[0]
    const len = t.length ?? 656.2
    const h = t.height ?? 55.65
    const w = t.width ?? 51.59
    return new THREE.BoxGeometry(len, h, w)
  }, [spec.toggles])

  return (
    <group>
      {spec.toggles.map((t) => {
        const state = toggles[t.id] ?? 'yellow'
        const [x, y, z] = toThree(t.position[0], t.position[1], t.position[2])
        return (
          <group
            key={t.id}
            position={[x, y, z]}
            rotation={[0, t.rotationZ, 0]}
            onPointerDown={(e) => {
              e.stopPropagation()
              cycleToggle(t.id)
            }}
            onPointerOver={() => setHoverGoal(null)}
          >
            {/* 底座 */}
            <mesh position={[0, 0, -50]} castShadow>
              <boxGeometry args={[700, 90, 40]} />
              <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
            </mesh>
            {/* 朝向指示面：整条的颜色 = 当前状态 */}
            <mesh geometry={geo} castShadow>
              <meshStandardMaterial
                color={STATE_COLOR[state]}
                roughness={0.5}
                emissive={STATE_COLOR[state]}
                emissiveIntensity={state === 'yellow' ? 0.12 : 0.35}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export { STATE_COLOR }
