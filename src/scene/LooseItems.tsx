import { memo, useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { useApp } from '@/state/store'
import type { LooseItem } from '@/state/store'
import { toThree } from '@/data/fieldSpec'
import type { StackItem } from '@/state/scoring'
import { NEST_ON_CUP, SEAT_EPS, restingBaseY } from './stackLayout'
import { HalfMesh } from './Goals'

/** 轴向明显偏离竖直 = 侧躺（官方摆法里有 16 根这样的 pin） */
function isLying(it: LooseItem): boolean {
  return !!it.axis && Math.abs(it.axis[2]) < 0.9
}

/**
 * 散件的落点高度（局部原点离地多高）：
 *  · 插在 cup 里的 pin → 针尖探到 cup 的腰（cup 底 + 82）
 *  · 侧躺的 → 侧躺后落在垫子上（由轴向算出来）
 *  · 其余 → 站在垫子上
 */
export function looseBaseY(it: LooseItem): number {
  if (it.z !== undefined) return it.z
  if (it.nested) return NEST_ON_CUP + SEAT_EPS
  if (isLying(it)) return restingBaseY(it.kind, it.axis!)
  return 0
}

/**
 * 让局部 +Y（件的轴向）转到目标方向上的欧拉角（R3F 的 XYZ 序 = Rx·Ry·Rz）。
 *
 * 目标方向 v = (vx, vy, vz)：先绕 Z 转 α 把 +Y 带到 XZ 平面，再绕 X 转 β 压下去。
 *   R_z(α)·(0,1,0) = (−sinα, cosα, 0)
 *   R_x(β)·上面   = (−sinα, cosα·cosβ, cosα·sinβ)
 */
function axisEuler(v: [number, number, number]): [number, number, number] {
  const alpha = Math.atan2(-v[0], Math.hypot(v[1], v[2]))
  const beta = Math.atan2(v[2], v[1])
  return [beta, 0, alpha]
}

// ═══════════════════════════════════════════════════════════════
// ★ 订阅粒度：把 114 个散件的重复渲染干掉
//
// 摆场之后场上有 **114 个散件**（228 个半体 mesh）。
// 以前 `LooseItems` 订阅整个 `loose` 数组 → **任何一次 store 变化**
// （挪一个件、选一下、开始拖一下…）都会让 114 个散件**整批重渲染**：
// 每次要新建 ~800 个 React 元素（group + mesh + material + geometry），
// dev 模式下 `jsxDEV` 还会 `Object.freeze` 每个元素 ——
// 实测「挪一个散件」的纯 JS 开销 ≈ **115 ms**（每次变化 456 次半体渲染）。
//
// 现在拆成三层：
//   ① `LooseItems` 只订阅 **id 列表**，内容没变就返回**同一个数组引用**
//      → 挪一个件时列表本身**根本不重渲染**；
//   ② 每个散件是**独立的 memo 组件**，自己按 id 去 store 里取**那一个**件
//      → 只有真的变了的那一个散件会重渲染，其余 113 个一动不动；
//   ③ 半体渲染再包一层 `memo` → 连半体都不用重渲染。
//
// ⚠️ 代价：每个散件多一个 store 订阅（114 个）。
//   一次 store 变化 = 114 次查表（O(1)），换来重渲染从「整批 114 个」
//   降到「通常 0~1 个」—— 划算。
// ═══════════════════════════════════════════════════════════════

/**
 * `loose` 数组 → id 索引表（**缓存**）。
 *
 * 每个散件都要按 id 取自己那一个件 → 114 个订阅者 × 一次查询。
 * 用 `find` 扫数组的话是 O(n²)（≈1.3 万次比较）；缓存一张 Map 就是 O(1)。
 * 数组换了才重建（一次 store 变化只重建一次，后面的订阅者都复用）。
 */
let byIdCache: Map<string, LooseItem> | null = null
let byIdSrc: LooseItem[] | null = null
function looseById(loose: LooseItem[]): Map<string, LooseItem> {
  if (loose !== byIdSrc || !byIdCache) {
    const m = new Map<string, LooseItem>()
    for (const it of loose) m.set(it.id, it)
    byIdCache = m
    byIdSrc = loose
  }
  return byIdCache
}

/** 散件 id 列表的**稳定引用**（内容一样就还是同一个数组 → 订阅者不重渲染） */
let idsCache: string[] = []
let idsSrc: LooseItem[] | null = null
function selectLooseIds(loose: LooseItem[]): string[] {
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

/**
 * 一个散件（**独立的 memo 组件**：只订阅它自己那一个件）。
 *
 * ★ props 只有 `id`（永远不变）→ 父组件重渲染时 React 直接跳过它。
 *   它自己只在「这个件的引用变了」时才重渲染。
 */
const LooseItemView = memo(function LooseItemView({ id }: { id: string }) {
  // ★ 只取**这一个**件：别的散件变了，这里拿到的还是同一个对象引用
  //   → `useSyncExternalStore` 判定「快照没变」→ 整个组件跳过重渲染 ✓
  const item = useApp((s) => looseById(s.loose).get(id))

  // 伪装的 StackItem —— 半体摆放只看 kind 和 baseY。
  // ★ 依赖的是 `halves` 这个**数组引用**：挪位置时 halves 不变 → pseudo 不变
  //   → 两个 HalfMesh 连一次都不用重渲染 ✓
  const kind = item?.kind
  const halves = item?.halves
  const pseudo = useMemo<StackItem | null>(() => {
    if (!kind || !halves) return null
    return { id, kind, halves } as StackItem
  }, [id, kind, halves])

  const onPointerDown = useCallback(
    (e: any) => {
      e.stopPropagation()
      if (!pseudo) return
      const st = useApp.getState()
      // ★ 点场上的件 = 把它**端起来**（跟面板上的件一样）：
      //   接着点一个 goal 就放上去；再点一次这个件 = 放下。
      if (st.pending?.looseId === id) {
        st.setPending(null)
      } else {
        st.setPending({ item: pseudo, looseId: id })
      }
      st.selectItem(id)
      st.setDragging({ kind: 'loose', item: pseudo, looseId: id })
    },
    [id, pseudo],
  )

  if (!item || !pseudo) return null

  const [x, , z] = toThree(item.x, item.y, 0)
  const lying = isLying(item)
  const baseY = looseBaseY(item)
  // 场地系 (X 东, Y 北, Z 上) → three.js (X, Y=上, Z=-Y)
  const rot: [number, number, number] = lying
    ? axisEuler([item.axis![0], item.axis![2], -item.axis![1]])
    : ZERO_ROT
  return (
    <group
      position={[x, lying ? baseY : 0, z]}
      rotation={rot}
      onPointerDown={onPointerDown}
    >
      <MemoHalfMesh item={pseudo} halfIndex={0} baseY={lying ? 0 : baseY} castShadow={false} />
      <MemoHalfMesh item={pseudo} halfIndex={1} baseY={lying ? 0 : baseY} castShadow={false} />
    </group>
  )
})

/**
 * 场上**不在 goal 里**的得分物（散件）。
 *
 * 三种形态：
 *  · 立着的 pin / cup（cup 是沙漏、pin 是线轴，和摞里用的是同一套几何）
 *  · **插在 cup 里的 pin**：尖端落进 cup 的细腰，翻边架在 cup 的上沿
 *  · **侧躺着的 pin**：绕自己的轴倒下来，落在垫子上（官方摆法里 16 根）
 *
 * 散件不参与计分（手册只算 goal 里的 pin 和中场的机器人）。
 */
export const LooseItems = memo(function LooseItems() {
  // ★ 只订阅 id 列表（引用稳定）→ 挪一个件时这个组件**不重渲染**
  const ids = useApp((s) => selectLooseIds(s.loose))
  return (
    <group>
      {ids.map((id) => (
        <LooseItemView key={id} id={id} />
      ))}

      {/* 选中环：单独一个组件（见下面的说明） */}
      <LooseSelectionRing />
    </group>
  )
})

/**
 * 选中散件脚下的一圈青环。
 *
 * ★ **必须单独一个组件**：它自己订阅 `selectedItemId`。
 *   要是把「选中没有」塞进上面那个 map 里当条件子节点，
 *   一来 children 数组里会留一个 `false` 空洞 → React 只能走慢路径 →
 *   匹配不上没 key 的兄弟 → **每次换选中态都把 114 个散件整个重挂一遍**
 *   （几百个新 mesh + 材质，卡十几秒 ✗）；
 *   二来选中态一变，114 个散件都要跟着重渲染。
 *   拆成独立组件后，只有这个小环会重渲染 ✓
 */
function LooseSelectionRing() {
  // ★ 只订阅「被选中的那一个件」：别的散件挪位置，这里也不重渲染
  //   （选中态一变，这个 selector 的返回值就换了一个对象 → 照常重渲染 ✓）
  const item = useApp((s) =>
    s.selectedItemId ? looseById(s.loose).get(s.selectedItemId) : undefined,
  )
  if (!item) return null
  const [x, , z] = toThree(item.x, item.y, 0)
  // 侧躺的件：环画在它躺下的那个高度上
  const y = (isLying(item) ? looseBaseY(item) : 0) + 3
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
