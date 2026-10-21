import { useMemo } from 'react'
import { useApp } from '@/state/store'
import { toThree } from '@/data/fieldSpec'
import type { StackItem } from '@/state/scoring'
import { HalfMesh } from './Goals'

/**
 * 场上**不在 goal 里**的得分物（散件）。
 *
 * 两种形态：
 *  · 立着的 pin / cup（cup 是沙漏、pin 是线轴，和摞里用的是同一套几何）
 *  · **插在 cup 里的 pin**：尖端落进 cup 的细腰，翻边架在 cup 的上沿
 *    → pin 的底端在 cup 底 + 164.5（跟 pin 插在 goal 孔里是同一套关系）
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
        const baseY = it.z ?? 0
        return (
          <group
            key={it.id}
            position={[x, 0, z]}
            onPointerDown={(e) => {
              e.stopPropagation()
              selectItem(it.id)
              setDragging({ kind: 'loose', item: pseudo, looseId: it.id })
            }}
          >
            <HalfMesh item={pseudo} halfIndex={0} baseY={baseY} castShadow={false} />
            <HalfMesh item={pseudo} halfIndex={1} baseY={baseY} castShadow={false} />
          </group>
        )
      })}
    </group>
  )
}
