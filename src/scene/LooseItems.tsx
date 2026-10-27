import { memo, useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useApp } from '@/state/store'
import type { LooseGroup, LoosePiece } from '@/state/store'
import { toThree } from '@/data/fieldSpec'
import type { StackItem } from '@/state/scoring'
import { axisEuler, layoutLooseGroup } from './stackLayout'
import { HalfMesh } from './Goals'
import { pickMaterial } from './materials'
import { sceneBridge } from './bridge'

// ═══════════════════════════════════════════════════════════════
// ★ 订阅粒度：把几十个散件组的重复渲染干掉
//
// 摆场之后场上有 **98 个组**（其中 16 组是「cup 里插着 pin」的组合）。
// 以前 `LooseItems` 订阅整个 `loose` 数组 → **任何一次 store 变化**
// （挪一个件、选一下、开始拖一下…）都会让所有散件**整批重渲染**：
// 每次要新建几百个 React 元素（group + mesh + material + geometry），
// dev 模式下 `jsxDEV` 还会 `Object.freeze` 每个元素 —— 实测很卡。
//
// 现在拆成三层：
//   ① `LooseItems` 只订阅 **id 列表**，内容没变就返回**同一个数组引用**
//      → 挪一个件时列表本身**根本不重渲染**；
//   ② 每个组是**独立的 memo 组件**，自己按 id 去 store 里取**那一个**组
//      → 只有真的变了的那一个组会重渲染；
//   ③ 半体渲染再包一层 `memo` → 连半体都不用重渲染。
// ═══════════════════════════════════════════════════════════════

/**
 * `loose` 数组 → id 索引表（**缓存**）。
 *
 * 每个组都要按 id 取自己那一个 → 几十个订阅者 × 一次查询。
 * 用 `find` 扫数组的话是 O(n²)；缓存一张 Map 就是 O(1)。
 */
let byIdCache: Map<string, LooseGroup> | null = null
let byIdSrc: LooseGroup[] | null = null
export function looseById(loose: LooseGroup[]): Map<string, LooseGroup> {
  if (loose !== byIdSrc || !byIdCache) {
    const m = new Map<string, LooseGroup>()
    for (const it of loose) m.set(it.id, it)
    byIdCache = m
    byIdSrc = loose
  }
  return byIdCache
}

/** 散件 id 列表的**稳定引用**（内容一样就还是同一个数组 → 订阅者不重渲染） */
let idsCache: string[] = []
let idsSrc: LooseGroup[] | null = null
function selectLooseIds(loose: LooseGroup[]): string[] {
  if (loose === idsSrc) return idsCache
  const n = loose.length
  if (idsCache.length === n) {
    let same = true
    for (let i = 0; i < n; i++) {
      if (idsCache[i] !== loose[i].id) {
        same = false
        break
      }
    }
    if (same) {
      idsSrc = loose
      return idsCache
    }
  }
  idsCache = loose.map((it) => it.id)
  idsSrc = loose
  return idsCache
}

/** 半体渲染包一层 memo —— props 稳了就完全不重渲染 */
const MemoHalfMesh = memo(HalfMesh)

/** 站着的件不转 → 用一个常量数组，props 引用稳定 */
const ZERO_ROT: [number, number, number] = [0, 0, 0]

/** 拾取圆柱的尺寸（不可见，只用来判断「指针在不在这个散件上」） */
const PICK_RADIUS = 62
const PICK_HEIGHT = 320

/**
 * 拾取圆柱的**几何全局一份**（摆场后有 98 个散件组）。
 *
 * 作为 prop 传下去 → R3F 不会 dispose 它 ✓（只有 JSX 子节点才会被回收）。
 * 每个组自己 `<cylinderGeometry>` 的话就是 98 份一模一样的 buffer。
 */
let pickGeo: THREE.CylinderGeometry | null = null
function pickGeometry(): THREE.CylinderGeometry {
  if (!pickGeo) {
    pickGeo = new THREE.CylinderGeometry(PICK_RADIUS, PICK_RADIUS, PICK_HEIGHT, 8)
  }
  return pickGeo
}

/**
 * 一个散件**组**（**独立的 memo 组件**：只订阅它自己那一个组）。
 *
 * 一组 = 一个整体：可能是一根 pin、一个 cup，或者「cup 里插着 pin」。
 * 拖它动全部、删它删全部、端起来也一起端。
 */
const LooseGroupView = memo(function LooseGroupView({ id }: { id: string }) {
  // ★ 只取**这一个**组：别的组变了，这里拿到的还是同一个对象引用
  //   → `useSyncExternalStore` 判定「快照没变」→ 整个组件跳过重渲染 ✓
  const group = useApp((s) => looseById(s.loose).get(id))

  // 伪装的 StackItem —— 半体摆放只看 kind 和 baseY。
  // ★ 依赖的是 `halves` 这个**数组引用**：挪位置时 halves 不变 → pseudo 不变
  //   → 两个 HalfMesh 连一次都不用重渲染 ✓
  const pseudos = useMemo<StackItem[]>(() => {
    if (!group) return []
    return group.pieces.map((p) => ({ id: p.id, kind: p.kind, halves: p.halves }) as StackItem)
  }, [group])

  const onPieceDown = useCallback(
    (e: any, piece: LoosePiece) => {
      e.stopPropagation()
      if (!group) return
      const st = useApp.getState()
      const pseudo = { id: piece.id, kind: piece.kind, halves: piece.halves } as StackItem
      // ★ 点场上的件 = 把它（**整组**）**端起来**：
      //   接着点一个 goal 就放上去；再点一次这个件 = 放下。
      if (st.pending?.looseId === group.id) {
        st.setPending(null)
      } else {
        st.setPending({ item: pseudo, looseId: group.id })
      }
      st.selectLoose(group.id)
      st.selectItem(piece.id)
      st.setDragging({ kind: 'loose', item: pseudo, groupId: group.id })
    },
    [group],
  )

  // 放置目标（不可见的圆柱）：登记给拖拽控制器，用来判断「拖到另一个散件上」
  const pickRef = useRef<THREE.Mesh | null>(null)
  const registerPick = useCallback((mesh: THREE.Mesh | null) => {
    const prev = pickRef.current
    if (prev) {
      const i = sceneBridge.looseTargets.indexOf(prev)
      if (i >= 0) sceneBridge.looseTargets.splice(i, 1)
    }
    pickRef.current = mesh
    if (mesh) {
      mesh.userData.groupId = id
      sceneBridge.looseTargets.push(mesh)
    }
  }, [id])

  if (!group || !pseudos.length) return null

  const [x, , z] = toThree(group.x, group.y, 0)
  const laid = layoutLooseGroup(group.pieces)
  // 底下一段侧躺 → 整组就是躺着的（侧躺的组不会再有别的段摞上去）
  const bottom = group.pieces[0]
  const lying = !!bottom?.axis
  const groupY = lying ? laid[0].baseY : 0
  const rot: [number, number, number] = lying
    ? axisEuler([bottom.axis![0], bottom.axis![2], -bottom.axis![1]])
    : ZERO_ROT

  return (
    <>
      <group position={[x, groupY, z]} rotation={rot}>
        {laid.map((s, i) => {
          const piece = s.piece
          const pseudo = pseudos[i]
          const baseY = lying ? 0 : s.baseY
          return (
            <group key={piece.id} onPointerDown={(e) => onPieceDown(e, piece)}>
              <MemoHalfMesh item={pseudo} halfIndex={0} baseY={baseY} castShadow={false} />
              <MemoHalfMesh item={pseudo} halfIndex={1} baseY={baseY} castShadow={false} />
            </group>
          )
        })}
      </group>

      {/* 拾取圆柱：`visible={false}` —— 不进渲染，但**照样能被射线命中**
          （three.js 的 Raycaster 不看 visible）✓ */}
      <mesh
        ref={registerPick}
        position={[x, PICK_HEIGHT / 2, z]}
        geometry={pickGeometry()}
        material={pickMaterial()}
        visible={false}
      />
    </>
  )
})

/**
 * 场上**不在 goal 里**的得分物（散件组）。
 *
 * 一组 = 一个整体：
 *  · 立着的 pin / cup（cup 是沙漏、pin 是线轴，和摞里用的是同一套几何）
 *  · **插在 cup 里的 pin**（官方摆法里的 16 个落位）
 *  · **侧躺着的 pin**（官方摆法里 16 根，四个斜角落位各 4 根）
 *
 * 散件不参与计分（手册只算 goal 里的 pin 和中场的机器人）。
 */
export const LooseItems = memo(function LooseItems() {
  // ★ 只订阅 id 列表（引用稳定）→ 挪一个件时这个组件**不重渲染**
  const ids = useApp((s) => selectLooseIds(s.loose))
  return (
    <group>
      {ids.map((id) => (
        <LooseGroupView key={id} id={id} />
      ))}

      {/* 选中环：单独一个组件（见下面的说明） */}
      <LooseSelectionRing />
    </group>
  )
})

/**
 * 选中散件脚下的一圈青环。
 *
 * ★ **必须单独一个组件**：它自己订阅 `selectedLooseId`。
 *   要是把「选中没有」塞进上面那个 map 里当条件子节点，
 *   children 数组里会留一个 `false` 空洞 → React 只能走慢路径 →
 *   匹配不上没 key 的兄弟 → **每次换选中态都把整份列表重挂一遍** ✗
 */
function LooseSelectionRing() {
  const group = useApp((s) =>
    s.selectedLooseId ? looseById(s.loose).get(s.selectedLooseId) : undefined,
  )
  if (!group) return null
  const [x, , z] = toThree(group.x, group.y, 0)
  // 侧躺的组：环画在它躺下的那个高度上
  const bottom = group.pieces[0]
  const lying = !!bottom?.axis
  const y = (lying ? layoutLooseGroup(group.pieces)[0].baseY : 0) + 3
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <ringGeometry args={[46, 58, 40]} />
      <meshBasicMaterial
        color="#22d3ee"
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}
