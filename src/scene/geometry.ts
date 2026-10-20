import * as THREE from 'three'
import type { GoalSpec, HalfSpec } from '@/data/fieldSpec'

/**
 * 程序化几何（兜底用）。
 * CAD 导出的 field.glb 就绪后，这里生成的 Goal/得分物网格会被替换掉；
 * 场地、胶带、围栏这些静态件无论如何都用 CAD 版本。
 *
 * 单位：毫米。three.js 是 Y-up，调用方负责把场地坐标 (X,Y,Z) 转成 (x,y,z)=(X,Z,Y)。
 */

/** 八边形（径向 8 段，rotate 让它对齐八边形的「面」朝向） */
function octagon(radius: number, height: number, openEnded: boolean) {
  const g = new THREE.CylinderGeometry(radius, radius, height, 8, 1, openEnded)
  g.rotateY(Math.PI / 8)
  return g
}

/**
 * 半体的**统一约定**（CAD 导出与程序化几何都遵守）：
 *   · 局部原点 = 翻边（最宽的那圈，rMax）所在的一端
 *   · 半体沿 **-Y** 延伸，尖端在 y = -height
 *   · 宽度从翻边处的 rMax 收到尖端的 rTop
 *
 * 摆放时：
 *   · 「尖端朝下」= 旋转 0，位置 y = baseY + height（翻边在上）
 *   · 「尖端朝上」= 绕 X 轴转 180°，位置 y = baseY（翻边在下）
 */

/** 圆锥台 + 翻边（Pin 半体：实心） */
export function pinHalfGeometry(spec: HalfSpec) {
  const { height: h, rTop, rBottom, flange } = spec
  const rFlange = spec.rMax ?? rBottom + 10
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(rFlange, 0),
    new THREE.Vector2(rFlange, -flange),
    new THREE.Vector2(rBottom, -flange),
    new THREE.Vector2(rTop, -h),
    new THREE.Vector2(0, -h),
  ]
  const g = new THREE.LatheGeometry(pts, 32)
  g.computeVertexNormals()
  return g
}

/** 圆锥台薄壁套筒（Cup 半体：中空，两端开口） */
export function cupHalfGeometry(spec: HalfSpec) {
  const { height: h, rTop, rBottom, flange } = spec
  const rFlange = spec.rMax ?? rBottom + 4
  const wall = 4
  const pts = [
    new THREE.Vector2(rFlange, 0),
    new THREE.Vector2(rFlange, -flange),
    new THREE.Vector2(rBottom, -flange),
    new THREE.Vector2(rTop, -h),
    new THREE.Vector2(rTop - wall, -h),
    new THREE.Vector2(rBottom - wall, -flange),
    new THREE.Vector2(rFlange - wall, -flange),
    new THREE.Vector2(rFlange - wall, 0),
  ]
  const g = new THREE.LatheGeometry(pts, 32)
  g.computeVertexNormals()
  return g
}

/**
 * Goal：八边形锥台，顶面有一个圆孔（socket），孔内有一段筒壁 + 孔底。
 * 返回一个合并后的几何，原点在底面中心，+Y 朝上。
 */
export function goalGeometry(spec: GoalSpec) {
  const { baseRadius, topRadius, height, socket } = spec
  const parts: THREE.BufferGeometry[] = []

  // 底部外扩裙边
  const skirt = octagon(baseRadius * 1.14, 10, false)
  skirt.translate(0, 5, 0)
  parts.push(skirt)

  // 主体锥台（开顶）
  const body = new THREE.CylinderGeometry(topRadius, baseRadius, height - 10, 8, 1, true)
  body.rotateY(Math.PI / 8)
  body.translate(0, 10 + (height - 10) / 2, 0)
  parts.push(body)

  // 顶面：八边形外圈挖一个圆孔
  const shape = new THREE.Shape()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const x = Math.cos(a) * topRadius
    const y = Math.sin(a) * topRadius
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const hole = new THREE.Path()
  hole.absarc(0, 0, socket.radius, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  const top = new THREE.ShapeGeometry(shape, 24)
  top.rotateX(-Math.PI / 2)
  top.translate(0, height, 0)
  parts.push(top)

  // 孔内筒壁
  const bore = new THREE.CylinderGeometry(
    socket.radius,
    socket.radius,
    socket.depth,
    32,
    1,
    true,
  )
  bore.translate(0, height - socket.depth / 2, 0)
  parts.push(bore)

  // 孔底
  const boreBottom = new THREE.CircleGeometry(socket.radius, 32)
  boreBottom.rotateX(-Math.PI / 2)
  boreBottom.translate(0, height - socket.depth, 0)
  parts.push(boreBottom)

  // 底面
  const bottom = new THREE.CircleGeometry(baseRadius, 8)
  bottom.rotateX(Math.PI / 2)
  bottom.rotateY(Math.PI / 8)
  parts.push(bottom)

  return mergeGeometries(parts)
}

/** 合并多个 BufferGeometry（只处理 position/normal/uv、非索引） */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g))
  let total = 0
  for (const g of nonIndexed) total += g.getAttribute('position').count

  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  let po = 0
  let uo = 0
  for (const g of nonIndexed) {
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const u = g.getAttribute('uv')
    for (let i = 0; i < p.count; i++) {
      pos[(po + i) * 3 + 0] = p.getX(i)
      pos[(po + i) * 3 + 1] = p.getY(i)
      pos[(po + i) * 3 + 2] = p.getZ(i)
      if (n) {
        nor[(po + i) * 3 + 0] = n.getX(i)
        nor[(po + i) * 3 + 1] = n.getY(i)
        nor[(po + i) * 3 + 2] = n.getZ(i)
      }
      if (u) {
        uv[(uo + i) * 2 + 0] = u.getX(i)
        uv[(uo + i) * 2 + 1] = u.getY(i)
      }
    }
    po += p.count
    uo += p.count
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.computeBoundingSphere()
  return out
}

/** 一条白色胶带（输入是**场地坐标** X/Y，贴地并略微抬高避免 z-fighting） */
export function tapeStrip(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  z = 2,
): THREE.BufferGeometry {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const g = new THREE.PlaneGeometry(len, width)
  g.rotateX(-Math.PI / 2)
  g.rotateY(-Math.atan2(dy, dx))
  // 场地 Y(北) → three 的 −Z，见 fieldSpec.toThree
  g.translate((x1 + x2) / 2, z, -(y1 + y2) / 2)
  return g
}
