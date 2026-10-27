import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import * as THREE from 'three'

function VoiceWaveLine({
  color,
  freq,
  speed,
  amplitude,
  yOffset,
  zOffset,
  opacity = 0.28,
}: {
  color: string
  freq: number
  speed: number
  amplitude: number
  yOffset: number
  zOffset: number
  opacity?: number
}) {
  const lineRef = useRef<THREE.Line>(null)
  const count = 90

  const { geometry } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (i / (count - 1) - 0.5) * 17
      pos[i * 3 + 1] = yOffset
      pos[i * 3 + 2] = zOffset
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geometry: geo }
  }, [count, yOffset, zOffset])

  useFrame((state) => {
    if (!lineRef.current) return
    const attr = lineRef.current.geometry.attributes.position as THREE.BufferAttribute
    const posArr = attr.array as Float32Array
    const t = state.clock.getElapsedTime() * speed

    for (let i = 0; i < count; i++) {
      const x = posArr[i * 3]
      const envelope = Math.exp(-Math.pow(x / 4.8, 2))
      const y =
        yOffset +
        (Math.sin(x * freq + t) * 0.6 +
          Math.sin(x * freq * 1.9 - t * 1.25) * 0.28 +
          Math.cos(x * freq * 3.1 + t * 0.7) * 0.12) *
          amplitude *
          envelope

      posArr[i * 3 + 1] = y
    }
    attr.needsUpdate = true
  })

  const lineObject = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    return new THREE.Line(geometry, mat)
  }, [geometry, color, opacity])

  return <primitive object={lineObject} ref={lineRef} />
}

interface AgentNodeDef {
  id: string
  position: [number, number, number]
  color: string
  ringRadius: number
  speed: number
}

const AGENT_NODES: AgentNodeDef[] = [
  { id: 'orchestrator', position: [0.3, 1.45, -0.6], color: '#8b5cf6', ringRadius: 0.24, speed: 0.6 },
  { id: 'loan_bot', position: [-2.9, 0.45, -0.4], color: '#4568dc', ringRadius: 0.2, speed: 0.5 },
  { id: 'insurance_bot', position: [3.1, 0.35, -0.5], color: '#0f9d8a', ringRadius: 0.2, speed: 0.55 },
  { id: 'guardrail', position: [-0.6, -1.25, -0.3], color: '#6366f1', ringRadius: 0.18, speed: 0.7 },
  { id: 'speech_stt', position: [-4.2, -0.95, -1.0], color: '#38bdf8', ringRadius: 0.16, speed: 0.45 },
  { id: 'tools_agent', position: [2.5, -1.35, -0.7], color: '#14b8a6', ringRadius: 0.17, speed: 0.65 },
  { id: 'evaluator', position: [4.4, 1.25, -1.1], color: '#a855f7', ringRadius: 0.17, speed: 0.5 },
]

const AGENT_LINKS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [1, 4],
  [2, 5],
  [0, 5],
  [2, 6],
  [0, 6],
]

function AgentNode({ node }: { node: AgentNodeDef }) {
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ringRef.current) return
    const t = state.clock.getElapsedTime() * node.speed
    ringRef.current.rotation.x = t * 0.8
    ringRef.current.rotation.y = t * 1.1
  })

  return (
    <group position={node.position}>
      <mesh>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial
          color={node.color}
          emissive={node.color}
          emissiveIntensity={0.65}
          roughness={0.2}
          metalness={0.3}
        />
      </mesh>

      <mesh ref={ringRef}>
        <torusGeometry args={[node.ringRadius, 0.007, 16, 36]} />
        <meshBasicMaterial color={node.color} transparent opacity={0.38} depthWrite={false} />
      </mesh>

      <mesh>
        <sphereGeometry args={[node.ringRadius * 1.2, 12, 12]} />
        <meshBasicMaterial color={node.color} transparent opacity={0.04} depthWrite={false} />
      </mesh>
    </group>
  )
}

function SynapseLinks() {
  const lineGeometry = useMemo(() => {
    const points: THREE.Vector3[] = []
    for (const [fromIdx, toIdx] of AGENT_LINKS) {
      const from = AGENT_NODES[fromIdx].position
      const to = AGENT_NODES[toIdx].position
      points.push(new THREE.Vector3(...from))
      points.push(new THREE.Vector3(...to))
    }
    return new THREE.BufferGeometry().setFromPoints(points)
  }, [])

  return (
    <lineSegments geometry={lineGeometry}>
      <lineBasicMaterial color="#6366f1" transparent opacity={0.16} depthWrite={false} />
    </lineSegments>
  )
}

function DecisionPulse({ linkIdx, speed, offset }: { linkIdx: number; speed: number; offset: number }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [fromIdx, toIdx] = AGENT_LINKS[linkIdx]
  const pA = useMemo(() => new THREE.Vector3(...AGENT_NODES[fromIdx].position), [fromIdx])
  const pB = useMemo(() => new THREE.Vector3(...AGENT_NODES[toIdx].position), [toIdx])
  const color = AGENT_NODES[toIdx].color

  useFrame((state) => {
    if (!meshRef.current) return
    const t = (state.clock.getElapsedTime() * speed + offset) % 1
    meshRef.current.position.lerpVectors(pA, pB, t)
    const scale = 0.8 + 0.4 * Math.sin(t * Math.PI)
    meshRef.current.scale.set(scale, scale, scale)
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.038, 12, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
    </mesh>
  )
}

function VoiceParticles() {
  const count = 48
  const { geometry } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6
      pos[i * 3 + 2] = (Math.random() - 0.5) * 3 - 0.5
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geometry: geo }
  }, [count])

  useFrame((state) => {
    const attr = geometry.attributes.position as THREE.BufferAttribute
    const posArr = attr.array as Float32Array
    const t = state.clock.getElapsedTime()

    for (let i = 0; i < count; i++) {
      posArr[i * 3 + 1] += Math.sin(t * 0.4 + i) * 0.0018
      if (posArr[i * 3 + 1] > 3.2) posArr[i * 3 + 1] = -3.2
      if (posArr[i * 3 + 1] < -3.2) posArr[i * 3 + 1] = 3.2
    }
    attr.needsUpdate = true
  })

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={0.045}
        color="#818cf8"
        transparent
        opacity={0.35}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}

function AmbientSceneInner() {
  const groupRef = useRef<THREE.Group>(null)
  const mouse = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [])

  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      mouse.current.x * 0.05,
      0.03
    )
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      -mouse.current.y * 0.035,
      0.03
    )
  })

  return (
    <group ref={groupRef}>
      <VoiceWaveLine
        color="#4568dc"
        freq={0.75}
        speed={0.9}
        amplitude={0.48}
        yOffset={0.2}
        zOffset={-0.3}
        opacity={0.32}
      />

      <VoiceWaveLine
        color="#8b5cf6"
        freq={1.15}
        speed={1.1}
        amplitude={0.38}
        yOffset={-0.45}
        zOffset={-0.6}
        opacity={0.26}
      />

      <VoiceWaveLine
        color="#0f9d8a"
        freq={1.5}
        speed={0.8}
        amplitude={0.32}
        yOffset={0.7}
        zOffset={-0.8}
        opacity={0.24}
      />

      <VoiceWaveLine
        color="#38bdf8"
        freq={0.5}
        speed={0.65}
        amplitude={0.4}
        yOffset={-1.1}
        zOffset={-1.0}
        opacity={0.2}
      />

      {AGENT_NODES.map((node) => (
        <AgentNode key={node.id} node={node} />
      ))}

      <SynapseLinks />

      <DecisionPulse linkIdx={0} speed={0.45} offset={0.1} />
      <DecisionPulse linkIdx={1} speed={0.5} offset={0.6} />
      <DecisionPulse linkIdx={2} speed={0.4} offset={0.3} />
      <DecisionPulse linkIdx={3} speed={0.55} offset={0.8} />
      <DecisionPulse linkIdx={4} speed={0.48} offset={0.2} />
      <DecisionPulse linkIdx={5} speed={0.52} offset={0.5} />
      <DecisionPulse linkIdx={6} speed={0.42} offset={0.9} />
      <DecisionPulse linkIdx={7} speed={0.46} offset={0.4} />

      <VoiceParticles />

      <ambientLight intensity={0.65} />
      <directionalLight position={[5, 6, 4]} intensity={0.55} />
      <directionalLight position={[-6, -3, 3]} intensity={0.3} />
    </group>
  )
}

export function AmbientScene() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  if (!ready) return <div style={{ display: 'contents' }} aria-hidden="true" />

  return (
    <Canvas
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
      camera={{ position: [0, 0, 6.2], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 1.4]}
    >
      <Suspense fallback={null}>
        <AmbientSceneInner />
      </Suspense>
    </Canvas>
  )
}

function PlaybackVoiceOrb({ accent }: { accent: string }) {
  const coreRef = useRef<THREE.Mesh>(null)
  const ring1 = useRef<THREE.Mesh>(null)
  const ring2 = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (coreRef.current) {
      const s = 1.0 + Math.sin(t * 2.2) * 0.08 + Math.sin(t * 4.5) * 0.03
      coreRef.current.scale.set(s, s, s)
    }
    if (ring1.current) {
      ring1.current.rotation.x = t * 0.4
      ring1.current.rotation.y = t * 0.55
    }
    if (ring2.current) {
      ring2.current.rotation.x = -t * 0.5
      ring2.current.rotation.z = t * 0.35
    }
  })

  return (
    <Float speed={0.6} rotationIntensity={0.2} floatIntensity={0.35}>
      <group scale={1.1}>
        <mesh ref={coreRef}>
          <sphereGeometry args={[0.5, 28, 28]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={0.4}
            roughness={0.25}
            metalness={0.4}
            transparent
            opacity={0.35}
          />
        </mesh>

        <mesh ref={ring1}>
          <torusGeometry args={[1.1, 0.025, 24, 64]} />
          <meshBasicMaterial color={accent} transparent opacity={0.35} depthWrite={false} />
        </mesh>

        <mesh ref={ring2}>
          <torusGeometry args={[1.35, 0.02, 24, 64]} />
          <meshBasicMaterial color="#8b5cf6" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      </group>
    </Float>
  )
}

const SAFE_SHOW = typeof window !== 'undefined'

function showVisual() {
  if (!SAFE_SHOW) return 'never'
  try {
    const path = window.location.pathname
    return path.startsWith('/bots/') && path.includes('/playground') ? 'always' : 'hide'
  } catch {
    return 'hide'
  }
}

export function PlaygroundScene() {
  const [visible, setVisible] = useState<'always' | 'hide' | 'never'>(showVisual)

  useEffect(() => {
    if (visible !== 'always' && visible !== 'hide') return
    const listener = () => setVisible(showVisual())
    window.addEventListener('popstate', listener, { passive: true })
    return () => window.removeEventListener('popstate', listener)
  }, [visible])

  const shouldRender = visible === 'always'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        opacity: shouldRender ? 0.8 : 0,
        transition: 'opacity 420ms ease',
      }}
      aria-hidden="true"
    >
      <Canvas
        style={{ width: '100%', height: '100%', visibility: shouldRender ? 'visible' : 'hidden' }}
        camera={{ position: [0, 0, 5.2], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.3]}
      >
        <Suspense fallback={null}>
          <PlaybackVoiceOrb accent="#0f9d8a" />
          <ambientLight intensity={0.65} />
          <directionalLight position={[4, 5, 4]} intensity={0.6} />
        </Suspense>
      </Canvas>
    </div>
  )
}
