// Load the exported GLBs with three.js (the same loader the web app uses)
// and check what the app would actually see.
//
// This catches the class of bug that shipped once: a glTF whose index
// bufferView points at the wrong bytes.  three.js then loads an index
// array full of out-of-range values, the mesh draws nothing, and a
// Raycaster returns NaN -- with no error anywhere.
//
//   node tools/load_test.mjs
import fs from 'node:fs'
import path from 'node:path'
globalThis.self = globalThis
const THREE = await import('three')
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')

const dir = path.resolve('public/assets')
const loader = new GLTFLoader()
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.glb'))
let bad = 0

for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  await new Promise((res) => {
    loader.parse(ab, '', (gltf) => {
      let tris = 0
      let meshes = 0
      let idxBad = 0
      let nanN = 0
      let offN = 0
      const names = []
      const meshesList = []
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return
        meshes++
        meshesList.push(o)
        names.push(o.name)
        const idx = o.geometry.getIndex()
        const pos = o.geometry.getAttribute('position')
        if (!idx) { idxBad++; return }
        tris += idx.count / 3
        if (idx.count % 3 !== 0) idxBad++
        // NOTE: three.js leaves geometry.drawRange.count at its default
        // Infinity for glTF (the GLTFLoader never calls setDrawRange; the
        // renderer uses the index count instead).  That is normal, not a
        // corrupt buffer -- so it is deliberately NOT checked here.
        const a = idx.array
        for (let i = 0; i < a.length; i++) {
          const v = a[i]
          if (!Number.isFinite(v) || v < 0 || v >= pos.count) { idxBad++; break }
        }
        const nrm = o.geometry.getAttribute('normal')
        if (!nrm) { nanN++ } else {
          // use getX/getY/getZ: for an interleaved attribute .array is the
          // whole interleaved buffer, not this attribute's own data
          const n = Math.min(nrm.count, 400)
          for (let i = 0; i < n; i++) {
            const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i)
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nanN++
            else if (Math.abs(Math.hypot(x, y, z) - 1) > 0.02) offN++
          }
        }
      })

      // At least one mesh of the file must be hit by a raycast with a
      // finite distance -- that is the symptom of a corrupt index buffer
      // (three.js loads the mesh, draws nothing, and the raycaster
      // returns NaN).  Individual meshes may legitimately be missed (a
      // hollow shell, a flat decal), so this is a per-file check.
      let rayOk = false
      for (const m of meshesList) {
        m.updateWorldMatrix(true, false)
        const bb = new THREE.Box3().setFromObject(m)
        if (bb.isEmpty()) continue
        const c = bb.getCenter(new THREE.Vector3())
        // an oblique ray: a purely vertical one can pass straight through a
        // hollow shell (the goals are funnels with an open throat)
        const from = new THREE.Vector3(c.x + 1000, bb.max.y + 1000, c.z + 1000)
        const dir = c.clone().sub(from).normalize()
        const ray = new THREE.Raycaster(from, dir)
        const hits = ray.intersectObject(m, false)
        if (hits.length && Number.isFinite(hits[0].distance)) { rayOk = true; break }
      }
      const rayBad = rayOk ? 0 : 1

      const ok = idxBad === 0 && nanN === 0 && offN === 0 && rayBad === 0
      console.log(
        `  ${f.padEnd(28)} meshes=${meshes} tris=${tris} idxBad=${idxBad} ` +
        `nanN=${nanN} offN=${offN} rayMiss=${rayBad}` +
        `  ${ok ? 'OK' : 'FAIL'}`,
      )
      if (!ok) bad++
      res()
    }, (e) => {
      console.log(`  ${f}: LOAD FAILED`, e)
      bad++
      res()
    })
  })
}

console.log(bad === 0 ? '\nthree.js load test: ALL OK' : `\nthree.js load test: ${bad} PROBLEMS`)
process.exit(bad === 0 ? 0 : 1)
