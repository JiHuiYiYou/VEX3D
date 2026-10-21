import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { bakeRoot, loadGlb } from './assets'
import { materialFor } from './materials'
import { useApp } from '@/state/store'
import { COLORS } from '@/data/fieldSpec'
import type { QuadrantId, ToggleState } from '@/data/fieldSpec'

/** 围栏上那 4 根 toggle 条的材质（按状态换色） */
const TOGGLE_MATERIALS: Record<ToggleState, THREE.Material> = {
  red: new THREE.MeshStandardMaterial({
    color: COLORS.red,
    roughness: 0.5,
    emissive: COLORS.red,
    emissiveIntensity: 0.2,
  }),
  blue: new THREE.MeshStandardMaterial({
    color: COLORS.blue,
    roughness: 0.5,
    emissive: COLORS.blue,
    emissiveIntensity: 0.2,
  }),
  yellow: new THREE.MeshStandardMaterial({
    color: COLORS.yellow,
    roughness: 0.5,
    emissive: COLORS.yellow,
    emissiveIntensity: 0.12,
  }),
}

/**
 * 官方 CAD 导出的静态场地（field.glb）。
 *
 * CAD 里**所有零件的颜色都是同一个 SolidWorks 默认值**，没有可用信息，
 * 所以颜色由我们按零件名指派（见 materials.ts 的 materialFor）。
 *
 * CAD 几何是「Z 向上」的，three.js 是「Y 向上」→ 统一用 bakeRoot 转过来，
 * 否则整块场地会躺着（看起来是空的）。
 *
 * 只有当导出里**同时有地面垫和围栏**时才算完整，否则回退到程序化场地
 * （当前 CAD 导出还缺这两样，见 CLAUDE.md）。
 */
export function CadField({ onLoaded }: { onLoaded?: (ok: boolean) => void }) {
  const [root, setRoot] = useState<THREE.Object3D | null>(null)
  const { invalidate } = useThree()
  const toggles = useApp((s) => s.toggles)

  useEffect(() => {
    let alive = true
    loadGlb('assets/field.glb').then((r) => {
      if (!alive) return
      if (!r) {
        onLoaded?.(false)
        return
      }
      // 完整性检查：既要有围栏，也要有**真正铺满场地的地面垫**
      // （CAD 导出里如果漏了地面垫，光看零件名会误判成"完整"）
      const names: string[] = []
      r.traverse((o) => {
        if (o.name) names.push(o.name)
      })
      const hasWall = names.some((n) => n.includes('276-9250-120'))
      bakeRoot(r)
      let coversField = false
      const tmp = new THREE.Box3()
      r.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.computeBoundingBox()
        if (!m.geometry.boundingBox) return
        tmp.copy(m.geometry.boundingBox)
        const sx = tmp.max.x - tmp.min.x
        const sz = tmp.max.z - tmp.min.z
        if (sx >= 3000 && sz >= 3000) coversField = true
      })
      if (!hasWall || !coversField) {
        console.warn(
          `[assets] field.glb 不完整（围栏:${hasWall} 地面垫:${coversField}），使用程序化场地`,
        )
        onLoaded?.(false)
        return
      }
      r.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          // 场地是平的，不需要投影（省一大笔 shadow pass）
          m.castShadow = false
          m.receiveShadow = true
          m.material = materialFor(o.name || '')
        }
      })
      setRoot(r)
      invalidate()
      onLoaded?.(true)
    })
    return () => {
      alive = false
    }
  }, [invalidate, onLoaded])

  const clone = useMemo(() => (root ? root.clone(true) : null), [root])

  /**
   * 给围栏上那 4 根 toggle 条按状态上色。
   *
   * CAD 里 4 个 toggle 零件**同名**（`276-9250-023_GREY`），只能靠**位置**区分是哪个区域：
   * `bakeRoot` 把变换烘进几何了，所以包围盒中心就在 three 系里 ——
   * `|x| > |z|` → 东/西（按 x 正负），否则 → 南/北（z < 0 是北）。
   *
   * 注意要改 **clone** 上的 mesh：`clone(true)` 复制的是材质引用，
   * 在 root 上换 material 不会影响已经建好的 clone。
   */
  useEffect(() => {
    if (!clone) return
    let found = 0
    clone.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !/9250-023/i.test(o.name || '')) return
      m.geometry.computeBoundingBox()
      const c = m.geometry.boundingBox?.getCenter(new THREE.Vector3())
      if (!c) return
      const q: QuadrantId =
        Math.abs(c.x) > Math.abs(c.z)
          ? c.x > 0
            ? 'right'
            : 'left'
          : c.z < 0
            ? 'top'
            : 'bottom'
      m.material = TOGGLE_MATERIALS[toggles[q] ?? 'yellow']
      found++
    })
    if (found !== 4) {
      console.warn(
        `[assets] field.glb 里只找到 ${found} 个 toggle 零件（应为 4），CAD 侧可能改了零件名`,
      )
    }
    invalidate()
  }, [clone, toggles, invalidate])

  if (!clone) return null
  return <primitive object={clone} />
}
