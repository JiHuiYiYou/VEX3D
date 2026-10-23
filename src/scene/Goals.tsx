import { useMemo, useCallback, useRef, useEffect, memo } from 'react'
import * as THREE from 'three'
import { useApp } from '@/state/store'
import { loadHalfGeometry, useGoalAsset, useOptionalGeometry } from './assets'
import { accentMaterial, halfMaterial, materialFor, okRingMaterial, pickMaterial } from './materials'
import { COLORS, toThree } from '@/data/fieldSpec'
import type { GoalSpec } from '@/data/fieldSpec'
import type { StackItem } from '@/state/scoring'
import { checkPlacement } from '@/state/scoring'
import { sceneBridge } from './bridge'
import { halfTransform, layoutStack, stackTopY } from './stackLayout'

/**
 * 半体在 3D 里的摆放（Pin = 翻边对翻边、Cup = 杯口对杯口）见 `stackLayout.ts`。
 */

/**
 * 半体几何 —— **只有 CAD 导出的那一份**（`assets/half_<color>.glb`）。
 * 红/蓝/黄是 pin 的半体（线轴），透明/灰是 cup 的半体（沙漏）。
 */
function useHalfGeometry(color: string) {
  return useOptionalGeometry(() => loadHalfGeometry(color), [color])
}

/** 拾取碰撞体的几何（全局一份 —— 形状永远一样，没必要每个件造一个） */
let pickGeometry: THREE.CylinderGeometry | null = null
function pickCylinder(): THREE.CylinderGeometry {
  if (!pickGeometry) pickGeometry = new THREE.CylinderGeometry(42, 42, 170, 12)
  return pickGeometry
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
  // CAD 半体还没加载出来（或加载失败）→ 这个半体先不画
  if (!geo) return null
  return (
    <mesh
      geometry={geo}
      // ★ 材质**按颜色共享**（`materials.ts` 的 halfMaterial）：
      //   摆场一次就是 200 多个半体，各自 new 一份材质的话材质数会跟 mesh 数一样涨。
      //   作为 prop 传下去 → R3F 不会把它 dispose（只有 JSX 子节点才会被回收）。
      material={halfMaterial(color)}
      position={t.pos}
      rotation={[t.rotX, 0, 0]}
      castShadow={castShadow}
      receiveShadow
    />
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
        geometry={pickCylinder()}
        material={pickMaterial()}
        position={[0, baseY + 82, 0]}
        onPointerDown={onPointerDown}
        userData={{ kind: 'stackpick', itemId: item.id }}
        visible={false}
      />
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

/**
 * 一个 goal。
 *
 * ★ `memo` 过的：`Goals` 订阅了 7 个 store 切片，其中任何一个变，9 个 goal
 *   的 props 都会重算一遍 —— 有了 memo，**只有真的变了的那几个 goal 会重渲染**。
 *   （前提：props 的引用要稳 → 空栈要用下面那个 `EMPTY_STACK`，
 *   每次 `?? []` 都会造一个新数组，memo 就白做了 ✗）
 */
export const Goal = memo(function Goal({
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
          <mesh
            position={[0, 3, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={3}
            material={accentMaterial(0.75)}
          >
            <ringGeometry args={[spec.baseRadius + 16, spec.baseRadius + 30, 64]} />
          </mesh>
          <mesh
            position={[0, 2, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={2}
            material={accentMaterial(0.28)}
          >
            <ringGeometry args={[spec.baseRadius + 34, spec.baseRadius + 54, 64]} />
          </mesh>
          {/* 一柱光：从地面罩到摞顶 */}
          <mesh
            position={[0, (stackTop + 20) / 2, 0]}
            renderOrder={1}
            material={accentMaterial(0.16)}
          >
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
          </mesh>
          {/* 摞顶的「落点环」：下一件放这儿 */}
          <mesh
            position={[0, stackTop + 6, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={4}
            material={accentMaterial(0.9)}
          >
            <ringGeometry args={[44, 58, 48]} />
          </mesh>
        </>
      )}
      {!selected && hovered && (
        <mesh
          position={[0, 4, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={accentMaterial(0.7, true)}
        >
          <ringGeometry args={[spec.baseRadius + 4, spec.baseRadius + 16, 48]} />
        </mesh>
      )}

      {/* 合法落点提示环：贴在摞顶。非法叠放时这个环完全不出现。 */}
      {dropOk && (
        <mesh
          position={[0, stackTop + 4, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={okRingMaterial(0.9)}
        >
          <ringGeometry args={[46, 60, 48]} />
        </mesh>
      )}

      {/* 点击热区：贴着 goal 本体形状的锥台（不高于 goal 顶，免得抢掉叠在上面的得分物的点击） */}
      <mesh
        position={[0, spec.height / 2, 0]}
        userData={{ goalId: spec.id }}
        material={pickMaterial()}
        // ★ 看不见的拾取体**不渲染**（`visible={false}`）—— 它们是纯透明的，
        //   画出来只是白占 draw call（摆场后有 27 个）。
        //   three.js 的 Raycaster **不看 visible**，所以照样能点中、能当拖放目标 ✓
        visible={false}
        onPointerDown={(e) => {
          e.stopPropagation()
          const st = useApp.getState()
          const pending = st.pending
          if (pending) {
            // 手里「端着」着一个件 → 点 goal 就把它放上去（叠在摞顶）。
            // 非法叠放会被拒绝并弹提示，件还端着 → 换个 goal 再点就行。
            if (st.placePending(spec.id)) {
              st.selectGoal(spec.id)
              st.selectItem(pending.item.id) // 刚放上去的那个件 → 选中（画一圈）
            }
            return
          }
          // 没有端着的件 → 只是选中这个 goal
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
      </mesh>

      {/* 拖拽放置目标：罩住整个 goal 的一根隐形圆柱。**不带事件处理**，
          否则它会抢在叠在上面的得分物之前被射线命中，导致点不中得分物。 */}
      <mesh
        ref={registerDrop}
        position={[0, pickHeight / 2, 0]}
        userData={{ goalId: spec.id }}
        material={pickMaterial()}
        visible={false}
      >
        <cylinderGeometry args={[pickRadius, pickRadius, pickHeight, 16]} />
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
            const st = useApp.getState()
            const pending = st.pending
            if (pending) {
              // ★ 手里端着一个件 → 点摞上的件 = 把它放在**这个 goal** 的摞顶，
              //   不是「选中这个件」。goal 上已经有东西时才不会白点一场 ✓
              if (st.placePending(spec.id)) {
                st.selectGoal(spec.id)
                st.selectItem(pending.item.id)
              }
              return
            }
            selectGoal(spec.id)
            selectItem(item.id)
            setDragging({ kind: 'stack', item, goalId: spec.id })
          }}
        />
      ))}
    </group>
  )
})

/** 空栈的**稳定引用**（`stacks[id] ?? []` 每次都会造新数组 → memo 会失效） */
const EMPTY_STACK: StackItem[] = []

/** 把 9 个 Goal 渲染出来 */
export function Goals({ goals }: { goals: GoalSpec[] }) {
  const stacks = useApp((s) => s.stacks)
  const selectedGoalId = useApp((s) => s.selectedGoalId)
  const selectedItemId = useApp((s) => s.selectedItemId)
  const hoverGoalId = useApp((s) => s.hoverGoalId)
  const dropTarget = useApp((s) => s.dropTarget)
  const dragging = useApp((s) => s.dragging)
  const pending = useApp((s) => s.pending)

  return (
    <>
      {goals.map((g) => {
        const stack = stacks[g.id] ?? EMPTY_STACK
        // 拖拽时：只有合法落点才高亮（非法时连悬停环都不给）
        const isDropTarget = dropTarget?.goalId === g.id
        const dropOk = !!dragging && isDropTarget && dropTarget!.legal
        // 「端着」着一个件时：能放上去的 goal 都亮绿环（不用拖也知道能放哪）
        const pendingOk = !!pending && checkPlacement(pending.item.kind, stack).ok
        const hovered = hoverGoalId === g.id && (!dragging || dropOk)
        return (
          <Goal
            key={g.id}
            spec={g}
            stack={stack}
            selected={selectedGoalId === g.id}
            hovered={hovered}
            selectedItemId={selectedItemId}
            dropOk={dropOk || pendingOk}
          />
        )
      })}
    </>
  )
}
