import { useMemo } from 'react'
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
export function LooseItems() {
  const loose = useApp((s) => s.loose)
  const setDragging = useApp((s) => s.setDragging)
  const selectItem = useApp((s) => s.selectItem)

  // 伪装的 StackItem —— 半体摆放只看 kind 和 baseY
  const items = useMemo(
    () =>
      loose.map((it) => ({
        it,
        pseudo: { id: it.id, kind: it.kind, halves: it.halves } as StackItem,
      })),
    [loose],
  )

  return (
    <group>
      {items.map(({ it, pseudo }) => {
        const [x, , z] = toThree(it.x, it.y, 0)
        const lying = isLying(it)
        const baseY = looseBaseY(it)
        // 场地系 (X 东, Y 北, Z 上) → three.js (X, Y=上, Z=-Y)
        const rot: [number, number, number] | undefined = lying
          ? axisEuler([it.axis![0], it.axis![2], -it.axis![1]])
          : undefined
        return (
          <group
            key={it.id}
            position={[x, lying ? baseY : 0, z]}
            rotation={rot ?? [0, 0, 0]}
            onPointerDown={(e) => {
              e.stopPropagation()
              selectItem(it.id)
              // ★ 只是**选中**：不「端着」它 —— 场上的件点 goal 的优先级是「选中那个 goal」，
              //   要把场上的件放进 goal 请直接拖。
              setDragging({ kind: 'loose', item: pseudo, looseId: it.id })
            }}
          >
            <HalfMesh
              item={pseudo}
              halfIndex={0}
              baseY={lying ? 0 : baseY}
              castShadow={false}
            />
            <HalfMesh
              item={pseudo}
              halfIndex={1}
              baseY={lying ? 0 : baseY}
              castShadow={false}
            />
          </group>
        )
      })}
    </group>
  )
}
