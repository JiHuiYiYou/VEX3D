import { useMemo, useCallback, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { useApp } from '@/state/store'
import { loadHalfGeometry, useGoalAsset, useOptionalGeometry } from './assets'
import { materialFor } from './materials'
import { COLORS, toThree } from '@/data/fieldSpec'
import type { GoalSpec } from '@/data/fieldSpec'
import type { StackItem } from '@/state/scoring'
import { sceneBridge } from './bridge'
import { halfTransform, layoutStack, stackTopY } from './stackLayout'

/**
 * 半体在 3D 里的摆放（Pin = 翻边对翻边、Cup = 杯口对杯口）见 `stackLayout.ts`。
 */

const HALF_COLORS: Record<string, string> = {
  red: COLORS.red,
  blue: COLORS.blue,
  yellow: COLORS.yellow,
  gray: COLORS.gray,
  clear: COLORS.clear,
}

/**
 * 半体几何 —— **只有 CAD 导出的那一份**（`assets/half_<color>.glb`）。
 * 红/蓝/黄是 pin 的半体（线轴），透明/灰是 cup 的半体（沙漏）。
 */
function useHalfGeometry(color: string) {
  return useOptionalGeometry(() => loadHalfGeometry(color), [color])
}

export function HalfMesh({
  item,
  halfIndex,
  baseY,
  castShadow = true,
}: {
  item: StackItem
  halfIndex: 0 | 1
  baseY: number
  /** 散件很多，关掉阴影省一大笔 shadow pass */
  castShadow?: boolean
}) {
  const t = halfTransform(item, halfIndex, baseY)
  const color = item.halves[halfIndex]
  const geo = useHalfGeometry(color)
  const isClear = color === 'clear'
  // CAD 半体还没加载出来（或加载失败）→ 这个半体先不画
  if (!geo) return null
  return (
    <mesh
      geometry={geo}
      position={t.pos}
      rotation={[t.rotX, 0, 0]}
      castShadow={castShadow}
      receiveShadow
    >
      {isClear ? (
        <meshPhysicalMaterial
          color={HALF_COLORS[color]}
          transparent
          opacity={0.32}
          roughness={0.08}
          metalness={0}
          transmission={0.7}
          thickness={6}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      ) : (
        <meshStandardMaterial color={HALF_COLORS[color]} roughness={0.55} metalness={0.05} />
      )}
    </mesh>
  )
}

/** 一个得分物（Pin 或 Cup）＝ 两个半体 */
export function StackPiece({
  item,
  baseY,
  onPointerDown,
  selected,
}: {
  item: StackItem
  baseY: number
  onPointerDown?: (e: any) => void
  selected?: boolean
}) {
  return (
    <group>
      <HalfMesh item={item} halfIndex={0} baseY={baseY} />
      <HalfMesh item={item} halfIndex={1} baseY={baseY} />
      {selected && (
        <mesh position={[0, baseY + 80, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[46, 3.5, 8, 32]} />
          <meshBasicMaterial color="#22d3ee" />
        </mesh>
      )}
      {/* 拾取用的不可见碰撞体（比几何体略大，方便点中） */}
      <mesh
        position={[0, baseY + 82, 0]}
        onPointerDown={onPointerDown}
        userData={{ kind: 'stackpick', itemId: item.id }}
      >
        <cylinderGeometry args={[42, 42, 170, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * CAD 导出的 Goal 几何（有多个子节点时按节点名上色）。
 *
 * 注意：同一个 glb 的 root 是**共享**的，而一个 Object3D 只能有一个父节点 ——
 * 所以每个 Goal 实例都要 clone 一份（clone 共享几何体，只是换了个父节点）。
 */
function CadGoalTree({ root, color }: { root: THREE.Object3D; color: string }) {
  const clone = useMemo(() => root.clone(true), [root])
  useEffect(() => {
    clone.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        // Goal 底下那块 300×300 的安装板是嵌在垫子里的，真场地上看不到
        if (/276-4847-011/i.test(o.name || '')) {
          m.visible = false
          return
        }
        m.castShadow = true
        m.receiveShadow = true
        m.material = materialFor(o.name || '', color)
      }
    })
  }, [clone, color])
  return <primitive object={clone} />
}

export function Goal({
  spec,
  stack,
  selected,
  hovered,
  selectedItemId,
  dropOk,
}: {
  spec: GoalSpec
  stack: StackItem[]
  selected: boolean
  hovered: boolean
  selectedItemId: string | null
  /** 当前是合法落点（拖拽时才会为 true） */
  dropOk: boolean
}) {
  const selectGoal = useApp((s) => s.selectGoal)
  const selectItem = useApp((s) => s.selectItem)
  const setDragging = useApp((s) => s.setDragging)
  const setHoverGoal = useApp((s) => s.setHoverGoal)

  // Goal 几何 —— **只有 CAD 导出的那一份**（`assets/goal_<variant>.glb`）
  const asset = useGoalAsset(spec.variant, spec.height)
  const cad = asset?.single ?? null
  const cadTree = asset?.root ?? null

  // 放置目标：罩住整个 goal，登记到 sceneBridge 供拾取；也承担点击选中
  const dropRef = useRef<THREE.Mesh | null>(null)
  const registerDrop = useCallback((mesh: THREE.Mesh | null) => {
    if (dropRef.current) {
      const i = sceneBridge.dropTargets.indexOf(dropRef.current)
      if (i >= 0) sceneBridge.dropTargets.splice(i, 1)
      dropRef.current = null
    }
    if (mesh) {
      dropRef.current = mesh
      sceneBridge.dropTargets.push(mesh)
    }
  }, [])

  // 叠放：底部塞进 socket 孔里（腰架在孔沿、尖端落到喉口），之后按嵌套关系往上套
  const pieces = layoutStack(spec, stack)
  const stackTop = stackTopY(spec, stack)

  const [gx, gy, gz] = toThree(spec.position[0], spec.position[1], spec.position[2])
  const variantColor =
    spec.variant === 'alliance-red'
      ? COLORS.red
      : spec.variant === 'alliance-blue'
        ? COLORS.blue
        : COLORS.neutralGoal

  const pickRadius = Math.max(spec.baseRadius, 82)
  const pickHeight = Math.max(spec.height, stackTop + 130)

  return (
    <group position={[gx, gy, gz]} rotation={[0, spec.rotationY, 0]}>
      {cadTree ? (
        <CadGoalTree root={cadTree} color={variantColor} />
      ) : cad ? (
        <mesh geometry={cad} castShadow receiveShadow>
          <meshStandardMaterial color={variantColor} roughness={0.6} metalness={0.05} />
        </mesh>
      ) : null}

      {/* 选中 / 悬停高亮。选中的要**一眼看出来**（CAD 的 goal 材质是不变的，
          只能靠这些叠加的环和光柱） */}
      {selected && (
        <>
          {/* 地面上的环：要画到 goal 轮廓外面，否则被 goal 本身挡住 */}
          <mesh position={[0, 3, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
            <ringGeometry args={[spec.baseRadius + 16, spec.baseRadius + 30, 64]} />
            <meshBasicMaterial
              color="#22d3ee"
              transparent
              opacity={0.75}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, 2, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
            <ringGeometry args={[spec.baseRadius + 34, spec.baseRadius + 54, 64]} />
            <meshBasicMaterial
              color="#22d3ee"
              transparent
              opacity={0.28}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          {/* 一柱光：从地面罩到摞顶 */}
          <mesh position={[0, (stackTop + 20) / 2, 0]} renderOrder={1}>
            <cylinderGeometry
              args={[
                spec.baseRadius * 1.02,
                spec.baseRadius * 1.02,
                stackTop + 20,
                28,
                1,
                true,
              ]}
            />
            <meshBasicMaterial
              color="#22d3ee"
              transparent
              opacity={0.16}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          {/* 摞顶的「落点环」：下一件放这儿 */}
          <mesh position={[0, stackTop + 6, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
            <ringGeometry args={[44, 58, 48]} />
            <meshBasicMaterial
              color="#22d3ee"
              transparent
              opacity={0.9}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
      {!selected && hovered && (
        <mesh position={[0, 4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[spec.baseRadius + 4, spec.baseRadius + 16, 48]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 合法落点提示环：贴在摞顶。非法叠放时这个环完全不出现。 */}
      {dropOk && (
        <mesh position={[0, stackTop + 4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[46, 60, 48]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 点击热区：贴着 goal 本体形状的锥台（不高于 goal 顶，免得抢掉叠在上面的得分物的点击） */}
      <mesh
        position={[0, spec.height / 2, 0]}
        userData={{ goalId: spec.id }}
        onPointerDown={(e) => {
          e.stopPropagation()
          selectGoal(spec.id)
          selectItem(null)
        }}
        onPointerOver={() => {
          // 拖拽时由拖拽控制器统一管理悬停，避免两边打架
          if (!useApp.getState().dragging) setHoverGoal(spec.id)
        }}
        onPointerOut={() => {
          if (!useApp.getState().dragging) setHoverGoal(null)
        }}
      >
        <cylinderGeometry args={[spec.topRadius, spec.baseRadius, spec.height, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* 拖拽放置目标：罩住整个 goal 的一根隐形圆柱。**不带事件处理**，
          否则它会抢在叠在上面的得分物之前被射线命中，导致点不中得分物。 */}
      <mesh ref={registerDrop} position={[0, pickHeight / 2, 0]} userData={{ goalId: spec.id }}>
        <cylinderGeometry args={[pickRadius, pickRadius, pickHeight, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {pieces.map(({ item, baseY }) => (
        <StackPiece
          key={item.id}
          item={item}
          baseY={baseY}
          selected={selectedItemId === item.id}
          onPointerDown={(e) => {
            // 阻止 goal 自身的 onPointerDown 抢走事件（否则会清掉刚选中的件）
            e.stopPropagation()
            selectGoal(spec.id)
            selectItem(item.id)
            setDragging({ kind: 'stack', item, goalId: spec.id })
          }}
        />
      ))}
    </group>
  )
}

/** 把 9 个 Goal 渲染出来 */
export function Goals({ goals }: { goals: GoalSpec[] }) {
  const stacks = useApp((s) => s.stacks)
  const selectedGoalId = useApp((s) => s.selectedGoalId)
  const selectedItemId = useApp((s) => s.selectedItemId)
  const hoverGoalId = useApp((s) => s.hoverGoalId)
  const dropTarget = useApp((s) => s.dropTarget)
  const dragging = useApp((s) => s.dragging)

  return (
    <>
      {goals.map((g) => {
        // 拖拽时：只有合法落点才高亮（非法时连悬停环都不给）
        const isDropTarget = dropTarget?.goalId === g.id
        const dropOk = !!dragging && isDropTarget && dropTarget!.legal
        const hovered = hoverGoalId === g.id && (!dragging || dropOk)
        return (
          <Goal
            key={g.id}
            spec={g}
            stack={stacks[g.id] ?? []}
            selected={selectedGoalId === g.id}
            hovered={hovered}
            selectedItemId={selectedItemId}
            dropOk={dropOk}
          />
        )
      })}
    </>
  )
}
