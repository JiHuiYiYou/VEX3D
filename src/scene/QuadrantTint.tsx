import { useMemo } from 'react'
import * as THREE from 'three'
import { useApp } from '@/state/store'
import { TOGGLE_STATE_COLOR, type QuadrantId, type ToggleState } from '@/data/fieldSpec'

/**
 * 区域染色：把每个区域（四分之一场地）按它那个 **Toggle 的当前状态**染色，
 * 一眼就能看出「这个区域的黄色 Pin 现在归谁」。
 *
 * 区域的边界用的是场地里真实的几何：
 *  · 外角 = 垫子角 (±1804)
 *  · 胶带臂的内端 = 中场菱形那条边的中点 (±299)
 *  · 中场菱形的顶点 (±598)
 * 这样染色块正好落在两条对角胶带臂之间，不会盖住胶带。
 */
const MAT_HALF = 1804
const DIAMOND_VERTEX = 598
const ARM_INNER = 299

/** 每个区域的多边形（场地坐标 X/Y，左上→右下绕一圈） */
const POLY: Record<QuadrantId, [number, number][]> = {
  left: [
    [-MAT_HALF, MAT_HALF],
    [-ARM_INNER, ARM_INNER],
    [-DIAMOND_VERTEX, 0],
    [-ARM_INNER, -ARM_INNER],
    [-MAT_HALF, -MAT_HALF],
  ],
  bottom: [
    [-MAT_HALF, -MAT_HALF],
    [-ARM_INNER, -ARM_INNER],
    [0, -DIAMOND_VERTEX],
    [ARM_INNER, -ARM_INNER],
    [MAT_HALF, -MAT_HALF],
  ],
  right: [
    [MAT_HALF, -MAT_HALF],
    [ARM_INNER, -ARM_INNER],
    [DIAMOND_VERTEX, 0],
    [ARM_INNER, ARM_INNER],
    [MAT_HALF, MAT_HALF],
  ],
  top: [
    [MAT_HALF, MAT_HALF],
    [ARM_INNER, ARM_INNER],
    [0, DIAMOND_VERTEX],
    [-ARM_INNER, ARM_INNER],
    [-MAT_HALF, MAT_HALF],
  ],
}

const STATE_COLOR = TOGGLE_STATE_COLOR

/** 黄色是「常态」（谁都不拥有），染得淡一点；红/蓝才是要看的，一眼就要跳出来 */
const STATE_ALPHA: Record<ToggleState, number> = {
  red: 0.19,
  blue: 0.19,
  yellow: 0.16,
}

/** 中场区域 = 中心的菱形（4 个区域之外剩下的那块） */
const MIDFIELD_POLY: [number, number][] = [
  [DIAMOND_VERTEX, 0],
  [0, DIAMOND_VERTEX],
  [-DIAMOND_VERTEX, 0],
  [0, -DIAMOND_VERTEX],
]

function polygonGeometry(pts: [number, number][]): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1])
  shape.closePath()
  const geo = new THREE.ShapeGeometry(shape)
  // 场地 X/Y → three x/z（Y 轴向上）
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0.35, 0)
  return geo
}

export function QuadrantTint() {
  const toggles = useApp((s) => s.toggles)
  const show = useApp((s) => s.showQuadrantTint)
  const hoverQuadrant = useApp((s) => s.hoverQuadrant)
  const counts = useApp((s) => s.midfieldCounts)

  const geos = useMemo(
    () => ({
      left: polygonGeometry(POLY.left),
      bottom: polygonGeometry(POLY.bottom),
      right: polygonGeometry(POLY.right),
      top: polygonGeometry(POLY.top),
      midfield: polygonGeometry(MIDFIELD_POLY),
    }),
    [],
  )

  // 中场没有 toggle：黄色 pin 归「赛局结束时中场机器人数多的一方」（<SC5>b），
  // 数量相同则谁都不拥有 → 用黄色（跟 toggle 的「没人拥有」同一个约定）
  const midfieldState: ToggleState =
    counts.red > counts.blue ? 'red' : counts.blue > counts.red ? 'blue' : 'yellow'

  if (!show) return null

  return (
    <group>
      {(Object.keys(geos) as QuadrantId[]).map((q) => {
        const state = toggles[q] ?? 'yellow'
        const hot = hoverQuadrant === q
        return (
          <mesh
            key={q}
            geometry={geos[q]}
            renderOrder={2}
            onPointerOver={() => useApp.getState().setHoverQuadrant(q)}
            onPointerOut={() => useApp.getState().setHoverQuadrant(null)}
          >
            <meshBasicMaterial
              color={STATE_COLOR[state]}
              transparent
              opacity={hot ? STATE_ALPHA[state] * 2.2 : STATE_ALPHA[state]}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        )
      })}

      {/* 中场：按「谁拥有中场」染色 */}
      <mesh geometry={geos.midfield} renderOrder={2}>
        <meshBasicMaterial
          color={STATE_COLOR[midfieldState]}
          transparent
          opacity={STATE_ALPHA[midfieldState]}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}
