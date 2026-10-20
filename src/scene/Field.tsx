import { useMemo } from 'react'
import * as THREE from 'three'
import { FIELD, COLORS, toThree } from '@/data/fieldSpec'
import { tapeStrip, mergeGeometries } from './geometry'

/** 中场菱形的 4 个顶点（场地坐标 mm） */
const DIA = FIELD.diamondRadius
const DIAMOND = [
  [0, DIA],
  [DIA, 0],
  [0, -DIA],
  [-DIA, 0],
] as const

/** 围栏边中点坐标 */
const H = FIELD.half

/**
 * 白色胶带（按真实场地照片还原）：
 *  · 中场是一个旋转 45° 的正方形（菱形），顶点 (0,±R)、(±R,0)
 *  · 4 条「臂」分别从 4 个场角连到菱形对应边的中点，
 *    每条臂是**一对**平行胶带（中心线间距 55 mm），与菱形边垂直
 *  · 红/蓝角区的 L 形 Load Zone 胶带（西侧红、东侧蓝）
 */
function buildTape(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const w = FIELD.tapeWidth
  const R = FIELD.diamondRadius
  const half = FIELD.midlineGap / 2

  // 菱形 4 条边
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = DIAMOND[i]
    const [x2, y2] = DIAMOND[(i + 1) % 4]
    parts.push(tapeStrip(x1, y1, x2, y2, w))
  }

  // 4 条臂：场角 → 菱形边中点，每条由一对平行胶带组成
  const corners: [number, number][] = [
    [-H, H],
    [H, H],
    [-H, -H],
    [H, -H],
  ]
  const mids: [number, number][] = [
    [-R / 2, R / 2],
    [R / 2, R / 2],
    [-R / 2, -R / 2],
    [R / 2, -R / 2],
  ]
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i]
    const [mx, my] = mids[i]
    const dx = mx - cx
    const dy = my - cy
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    // 垂直于臂的方向 = 沿菱形边的方向
    const px = -uy
    const py = ux
    for (const s of [-1, 1]) {
      const o = s * half
      parts.push(tapeStrip(cx + px * o, cy + py * o, mx + px * o, my + py * o, w))
    }
  }

  return mergeGeometries(parts)
}

/** 红 / 蓝角区的 L 形胶带（定义 Load Zone）：西侧两个角是红，东侧两个角是蓝 */
function buildCornerTape(side: 'red' | 'blue'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const w = FIELD.tapeWidth
  const inset = 82 // 距围边的距离
  const leg = 700 // L 形边长
  const sx = side === 'red' ? -1 : 1
  for (const sy of [1, -1]) {
    const cx = sx * (H - inset)
    const cy = sy * (H - inset)
    parts.push(tapeStrip(cx, cy, cx, cy + sy * leg, w))
    parts.push(tapeStrip(cx, cy, cx + sx * leg, cy, w))
  }
  return mergeGeometries(parts)
}

/** 围栏顶部的黑白格纹（VEX 场地的标志） */
function useCheckerTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 32
    const g = c.getContext('2d')!
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#141414' : '#f0f0f0'
        g.fillRect(x * 16, y * 16, 16, 16)
      }
    }
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(FIELD.size / 64, 1)
    t.anisotropy = 4
    return t
  }, [])
}

export function Field() {
  const tape = useMemo(() => buildTape(), [])
  const redCornerTape = useMemo(() => buildCornerTape('red'), [])
  const blueCornerTape = useMemo(() => buildCornerTape('blue'), [])
  const checker = useCheckerTexture()

  // 6×6 垫子的接缝
  const seams = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const step = FIELD.size / 6
    for (let i = 1; i < 6; i++) {
      const p = -H + i * step
      parts.push(tapeStrip(p, -H, p, H, 4, 1))
      parts.push(tapeStrip(-H, p, H, p, 4, 1))
    }
    return mergeGeometries(parts)
  }, [])

  const wallH = 260
  const wallT = 70

  return (
    <group>
      {/* 场地垫 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[FIELD.size, FIELD.size]} />
        <meshStandardMaterial
          color={COLORS.field}
          roughness={0.95}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={2}
          polygonOffsetUnits={2}
        />
      </mesh>
      <mesh geometry={seams} receiveShadow>
        <meshStandardMaterial color="#6d6d6d" roughness={1} />
      </mesh>

      {/* 白色胶带 */}
      <mesh geometry={tape}>
        <meshStandardMaterial color={COLORS.tape} roughness={0.7} />
      </mesh>
      {/* 红 / 蓝角区 Load Zone 胶带 */}
      <mesh geometry={redCornerTape}>
        <meshStandardMaterial color={COLORS.red} roughness={0.7} />
      </mesh>
      <mesh geometry={blueCornerTape}>
        <meshStandardMaterial color={COLORS.blue} roughness={0.7} />
      </mesh>

      {/* 围栏：4 面（three.js 里 Y 是竖直轴；场地北 → three 的 −Z） */}
      {[
        { pos: [0, wallH / 2, -(H + wallT / 2)] as [number, number, number], rot: 0 }, // 北
        { pos: [0, wallH / 2, H + wallT / 2] as [number, number, number], rot: 0 }, // 南
        { pos: [H + wallT / 2, wallH / 2, 0] as [number, number, number], rot: Math.PI / 2 }, // 东
        { pos: [-(H + wallT / 2), wallH / 2, 0] as [number, number, number], rot: Math.PI / 2 }, // 西
      ].map((w2, i) => (
        <mesh
          key={i}
          position={w2.pos}
          rotation={[0, w2.rot, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[FIELD.size + wallT * 2, wallH, wallT]} />
          <meshStandardMaterial color="#dcdcdc" roughness={0.85} />
        </mesh>
      ))}

      {/* 围栏顶部的黑白格纹条 */}
      {[
        { pos: [0, wallH + 7, -(H + wallT / 2)] as [number, number, number], rot: 0 },
        { pos: [0, wallH + 7, H + wallT / 2] as [number, number, number], rot: 0 },
        { pos: [H + wallT / 2, wallH + 7, 0] as [number, number, number], rot: Math.PI / 2 },
        { pos: [-(H + wallT / 2), wallH + 7, 0] as [number, number, number], rot: Math.PI / 2 },
      ].map((s, i) => (
        <mesh key={i} position={s.pos} rotation={[0, s.rot, 0]}>
          <boxGeometry args={[FIELD.size, 14, wallT * 0.9]} />
          <meshStandardMaterial map={checker} roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

/** 4 个 Loader（红方在西边，蓝方在东边，贴围栏） */
export function Loaders() {
  const items = [
    { pos: [-FIELD.half - 40, 1600] as [number, number], color: COLORS.red },
    { pos: [-FIELD.half - 40, -1600] as [number, number], color: COLORS.red },
    { pos: [FIELD.half + 40, 1600] as [number, number], color: COLORS.blue },
    { pos: [FIELD.half + 40, -1600] as [number, number], color: COLORS.blue },
  ]
  return (
    <group>
      {items.map((it, i) => {
        const [x, y, z] = toThree(it.pos[0], it.pos[1], 60)
        return (
          <group key={i} position={[x, y, z]} rotation={[0, it.pos[0] > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
            <mesh castShadow>
              <boxGeometry args={[300, 150, 60]} />
              <meshStandardMaterial color={it.color} roughness={0.5} />
            </mesh>
            <mesh position={[0, 95, 0]} castShadow>
              <boxGeometry args={[220, 60, 40]} />
              <meshStandardMaterial color="#d8d8d8" roughness={0.4} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
