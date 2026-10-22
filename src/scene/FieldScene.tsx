import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { CadField } from './CadField'
import { Goals } from './Goals'
import { QuadrantTint } from './QuadrantTint'
import { ToggleHandles } from './ToggleHandles'
import { LooseItems } from './LooseItems'
import { DragGhost } from './DragGhost'
import { useApp } from '@/state/store'
import { getFieldSpec } from '@/data/fieldSpec'
import { sceneBridge } from './bridge'

function BridgeSetup() {
  const { camera, gl, invalidate, scene, gl: renderer } = useThree()
  sceneBridge.camera = camera
  sceneBridge.domElement = gl.domElement
  sceneBridge.invalidate = invalidate
  sceneBridge.scene = scene
  sceneBridge.renderer = renderer
  return null
}

function Scene({ onError }: { onError?: (msg: string) => void }) {
  const spec = getFieldSpec()
  const selectGoal = useApp((s) => s.selectGoal)
  const dragging = useApp((s) => s.dragging)
  const quality = useApp((s) => s.quality)
  const downPos = useRef<{ x: number; y: number } | null>(null)
  const shadows = quality !== 'low'

  return (
    <>
      <BridgeSetup />
      <color attach="background" args={['#15181d']} />
      {/* DEBUG */}

      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#40454d', 0.6]} />
      <directionalLight
        position={[2200, 4200, 3200]}
        intensity={1.5}
        castShadow={shadows}
        shadow-mapSize-width={quality === 'high' ? 2048 : 1024}
        shadow-mapSize-height={quality === 'high' ? 2048 : 1024}
        shadow-camera-left={-2600}
        shadow-camera-right={2600}
        shadow-camera-top={2600}
        shadow-camera-bottom={-2600}
        shadow-camera-near={100}
        shadow-camera-far={12000}
        shadow-bias={-0.0008}
      />
      <directionalLight position={[-2500, 2000, 1800]} intensity={0.35} />

      {/* 官方 CAD 的静态场地 —— 场地的**唯一**几何来源。
          资产不完整时由 onError 报给 App（整屏提示），不拿手搓几何顶替。 */}
      <CadField onError={onError} />
      <QuadrantTint />
      <ToggleHandles />
      <LooseItems />
      <Goals goals={spec.goals} />
      <DragGhost />

      {/* 点击空白处取消选中（拖动相机不算「点击」） */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          if (e.button === 0) downPos.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const d = downPos.current
          downPos.current = null
          if (!d) return
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) {
            selectGoal(null)
            useApp.getState().selectItem(null)
          }
        }}
      >
        <planeGeometry args={[20000, 20000]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      <OrbitControls
        ref={(c) => {
          if (c) sceneBridge.controls = c as unknown as typeof sceneBridge.controls
        }}
        enabled={!dragging}
        enableDamping
        dampingFactor={0.08}
        minDistance={300}
        maxDistance={9000}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0, 0]}
        makeDefault
      />
    </>
  )
}

export function FieldScene({ onError }: { onError?: (msg: string) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const quality = useApp((s) => s.quality)
  const initialCamera = useMemo(() => {
    // near 不能太小：near=1 时在 5000 mm 处的深度精度约 1.6 mm，
    // 胶带（离地 2 mm）会和地面垫打架。near=50 → 精度 0.03 mm。
    const p = new THREE.PerspectiveCamera(45, 1, 50, 40000)
    // 默认朝**西**看：相机在东侧（three +X = 场地东），画面左=南、右=北
    p.position.set(4100, 3400, 0)
    p.lookAt(0, 0, 0)
    return p
  }, [])

  const dpr: [number, number] =
    quality === 'high' ? [1, 1.75] : quality === 'medium' ? [0.8, 1] : [0.5, 0.75]

  return (
    <div ref={canvasRef} className="canvas-wrap">
      <Canvas
        shadows={quality !== 'low'}
        dpr={dpr}
        frameloop="demand"
        camera={initialCamera}
        gl={{
          antialias: quality !== 'low',
          powerPreference: 'high-performance',
          // 保留绘制缓冲：截图 / 右键「图片另存为」才能拿到画面
          preserveDrawingBuffer: true,
        }}
      >
        <Suspense fallback={null}>
          <Scene onError={onError} />
        </Suspense>
      </Canvas>
    </div>
  )
}
