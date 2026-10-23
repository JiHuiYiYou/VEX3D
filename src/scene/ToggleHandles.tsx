import { useApp } from '@/state/store'
import { getFieldSpec, toThree } from '@/data/fieldSpec'
import { pickMaterial } from './materials'

/**
 * 围栏上 4 个 toggle 的**点击代理**（隐形）+ 选中高亮。
 *
 * 场上那 4 根条在 CAD 里是静态零件（`276-9250-023_GREY`），身上没有事件处理，
 * R3F 就不会把它们放进射线列表 → 看不见也点不着。这里补 4 个隐形盒子来接点击。
 *
 * 代理盒比真身大一圈（细长条在远处很难点中），但不能大到挡住围栏或者
 * 抢走 goal 的点击 —— toggle 都在围栏外侧（±1817 vs 围栏 ±1828），不重叠 ✓。
 */
export function ToggleHandles() {
  const selectToggle = useApp((s) => s.selectToggle)
  const selectedToggleId = useApp((s) => s.selectedToggleId)
  const spec = getFieldSpec()

  return (
    <group>
      {spec.toggles.map((t) => {
        const [x, y, z] = toThree(t.position[0], t.position[1], t.position[2])
        const len = t.length ?? 656.2
        const w = t.width ?? 52.2
        const h = t.height ?? 55.65
        const selected = selectedToggleId === t.id
        return (
          <group key={t.id} position={[x, y, z]} rotation={[0, t.rotationZ, 0]}>
            {/* 点击代理：`visible={false}` —— 不进渲染（省 4 个 draw call），
                但**照样点得中**：three.js 的 Raycaster 不看 visible，
                R3F 也不筛（R3F 只把「带事件处理的对象」放进射线列表）✓ */}
            <mesh
              onPointerDown={(e) => {
                e.stopPropagation()
                selectToggle(t.id)
              }}
              userData={{ kind: 'toggle', toggleId: t.id }}
              material={pickMaterial()}
              visible={false}
            >
              <boxGeometry args={[len + 60, h + 70, w + 110]} />
            </mesh>
            {/* 选中高亮：把真身的位置画一圈亮边 */}
            {selected && (
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[len + 14, h + 10, w + 14]} />
                <meshBasicMaterial
                  color="#22d3ee"
                  transparent
                  opacity={0.28}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}
