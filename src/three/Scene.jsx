import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Float, Sparkles } from '@react-three/drei'
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing'
import { makeCoinTexture, makeGlowTexture } from './coinTextures.js'
import { zoneBus, ZONE_RIG } from '../zoneBus.js'

/* Lemniscate of Bernoulli with a gentle z-twist so the two strands
   weave over/under at the center crossing instead of intersecting. */
class Lemniscate extends THREE.Curve {
  constructor(scale = 1, twist = 0.15) {
    super()
    this.scale = scale
    this.twist = twist
  }
  getPoint(t, target = new THREE.Vector3()) {
    const T = t * Math.PI * 2
    const d = 1 + Math.sin(T) ** 2
    return target.set(
      (this.scale * Math.cos(T)) / d,
      (this.scale * Math.sin(T) * Math.cos(T)) / d,
      Math.sin(T) * this.scale * this.twist
    )
  }
}

const RIBBON_SCALE = 3.1

const CHROME = {
  metalness: 1,
  roughness: 0.05,
  iridescence: 0.85,
  iridescenceIOR: 1.35,
  iridescenceThicknessRange: [100, 420],
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  envMapIntensity: 2.2,
}

function Ribbon() {
  const geometry = useMemo(
    () => new THREE.TubeGeometry(new Lemniscate(RIBBON_SCALE, 0.19), 700, 0.5, 64, true),
    []
  )
  return (
    <mesh geometry={geometry}>
      <meshPhysicalMaterial color="#e9e7f8" {...CHROME} />
    </mesh>
  )
}

/* Thin luminous filaments spiraling around the ribbon */
function OrbitLines() {
  const lines = useMemo(
    () =>
      [
        { s: 1.1, rz: 0.06, rx: 0.1, color: '#7B2BFF', o: 0.26 },
        { s: 1.17, rz: -0.05, rx: -0.08, color: '#00F0FF', o: 0.2 },
        { s: 1.24, rz: 0.1, rx: 0.05, color: '#b9a8ff', o: 0.15 },
        { s: 1.32, rz: -0.09, rx: -0.12, color: '#7B2BFF', o: 0.11 },
        { s: 1.4, rz: 0.03, rx: 0.14, color: '#00F0FF', o: 0.07 },
      ].map((l) => ({
        ...l,
        geometry: new THREE.TubeGeometry(new Lemniscate(RIBBON_SCALE * l.s, 0.16), 400, 0.01, 10, true),
      })),
    []
  )
  return lines.map((l, i) => (
    <mesh key={i} geometry={l.geometry} rotation={[l.rx, 0, l.rz]}>
      <meshBasicMaterial
        color={l.color}
        transparent
        opacity={l.o}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  ))
}

/* Token coins traveling around ONE lobe only — the one-sided liquidity metaphor.
   Billboard sprites with baked token glyphs + additive halos, like the mockup. */
const TOKENS = [
  { color: '#14F195', glyph: '≡', scale: 1.1, speed: 0.045, t0: 0.0 },   // SOL
  { color: '#2775CA', glyph: '$', scale: 1.17, speed: 0.038, t0: 0.09 }, // USDC
  { color: '#F7931A', glyph: '₿', scale: 1.24, speed: 0.05, t0: 0.2 },   // BTC
  { color: '#aab2d0', glyph: 'Ξ', scale: 1.1, speed: 0.042, t0: 0.31 },  // ETH
  { color: '#C7F284', glyph: '✦', scale: 1.17, speed: 0.047, t0: 0.4 },  // JUP
  { color: '#7B2BFF', glyph: '∞', scale: 1.32, speed: 0.036, t0: 0.12 }, // INF
  { color: '#14F195', glyph: '≡', scale: 1.32, speed: 0.052, t0: 0.44 }, // SOL
  { color: '#2775CA', glyph: '$', scale: 1.24, speed: 0.04, t0: 0.27 },  // USDC
]

function Coins() {
  const refs = useRef([])
  const curves = useMemo(
    () => TOKENS.map((tk) => new Lemniscate(RIBBON_SCALE * tk.scale, 0.16)),
    []
  )
  const textures = useMemo(() => TOKENS.map((tk) => makeCoinTexture(tk.color, tk.glyph)), [])
  const glowTexture = useMemo(() => makeGlowTexture(), [])
  const vec = useMemo(() => new THREE.Vector3(), [])

  useFrame((state) => {
    const time = state.clock.elapsedTime
    TOKENS.forEach((tk, i) => {
      const group = refs.current[i]
      if (!group) return
      // confine to the right lobe: wrap into [-0.25, 0.25], curve is periodic
      const t = ((tk.t0 + time * tk.speed) % 0.5) - 0.25
      curves[i].getPoint(t, vec)
      group.position.copy(vec)
    })
  })

  return TOKENS.map((tk, i) => (
    <group key={i} ref={(el) => (refs.current[i] = el)}>
      <sprite scale={[0.38, 0.38, 1]}>
        <spriteMaterial map={textures[i]} transparent depthWrite={false} />
      </sprite>
      <sprite scale={[1.05, 1.05, 1]}>
        <spriteMaterial
          map={glowTexture}
          color={tk.color}
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
    </group>
  ))
}

/* Vertical hall-of-mirrors: ghost chrome ∞ shapes stacked above and below,
   receding into the dark — mockup A's background column. */
function MirrorColumn() {
  const group = useRef()
  const ghostGeometry = useMemo(
    () => new THREE.TubeGeometry(new Lemniscate(1.5, 0.14), 300, 0.17, 24, true),
    []
  )
  const GHOSTS = [
    { position: [0, 3.7, -6], scale: 1, opacity: 0.15 },
    { position: [0, -3.5, -5.5], scale: 0.92, opacity: 0.13 },
    { position: [0, 5.4, -12], scale: 1.7, opacity: 0.08 },
    { position: [0, -6.4, -11], scale: 1.5, opacity: 0.08 },
    { position: [0, 8.6, -19], scale: 2.4, opacity: 0.04 },
    { position: [0, -9.6, -18], scale: 2.2, opacity: 0.04 },
  ]
  useFrame((state, dt) => {
    if (!group.current) return
    group.current.position.x = THREE.MathUtils.damp(group.current.position.x, -state.pointer.x * 0.9, 2.5, dt)
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, -state.pointer.y * 0.55, 2.5, dt)
  })
  return (
    <group ref={group}>
      {GHOSTS.map((gh, i) => (
        <mesh key={i} geometry={ghostGeometry} position={gh.position} scale={gh.scale}>
          <meshPhysicalMaterial
            color="#8b8fa8"
            {...CHROME}
            iridescence={0.4}
            envMapIntensity={0.65}
            transparent
            opacity={gh.opacity}
            depthWrite={false}
          />
        </mesh>
      ))}
      <Monolith />
    </group>
  )
}

/* Tall glass-slab outlines behind the column */
function roundedRectPoints(w, h, r, segments = 72) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2 + r, -h / 2)
  s.lineTo(w / 2 - r, -h / 2)
  s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0)
  s.lineTo(w / 2, h / 2 - r)
  s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2)
  s.lineTo(-w / 2 + r, h / 2)
  s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI)
  s.lineTo(-w / 2, -h / 2 + r)
  s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5)
  return s.getPoints(segments).map((p) => new THREE.Vector3(p.x, p.y, 0))
}

function Monolith() {
  const vertical = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(roundedRectPoints(4.6, 11.5, 0.9)),
    []
  )
  const wide = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(roundedRectPoints(11, 6.4, 1.8)),
    []
  )
  return (
    <>
      {[[-7.5, 0.26], [-13, 0.16], [-19, 0.09]].map(([z, o], i) => (
        <lineLoop key={`v${i}`} geometry={vertical} position={[0, 0, z]} scale={1 + i * 0.12}>
          <lineBasicMaterial color="#2c2c4a" transparent opacity={o} />
        </lineLoop>
      ))}
      {[[-9, 0.16], [-15, 0.1], [-22, 0.06]].map(([z, o], i) => (
        <lineLoop key={`w${i}`} geometry={wide} position={[0, 0, z]} scale={1 + i * 0.2}>
          <lineBasicMaterial color="#26263f" transparent opacity={o} />
        </lineLoop>
      ))}
    </>
  )
}

/* Floating frosted discs + sharp glass shards around the edges */
const DISCS = [
  { position: [-5.4, 2.9, -1.5], scale: 1.15, rotation: [1.25, 0.35, 0.2] },
  { position: [5.5, 2.6, -2], scale: 1.3, rotation: [1.1, -0.45, -0.15] },
  { position: [-5.1, -2.9, -1], scale: 0.9, rotation: [1.35, 0.2, 0.4] },
  { position: [5.3, -2.7, -1.6], scale: 1.05, rotation: [1.2, -0.3, -0.35] },
]

const SHARDS = [
  { position: [-3.7, 3.1, -0.6], scale: 0.9, rotation: [0.4, 0.5, 0.9] },
  { position: [3.6, -3, -1], scale: 0.75, rotation: [-0.3, 0.8, -0.6] },
  { position: [-3.4, -3.1, -0.4], scale: 0.55, rotation: [0.7, -0.4, 0.3] },
]

function GlassDebris() {
  const disc = useMemo(() => new THREE.CylinderGeometry(1, 1, 0.07, 64), [])
  const shard = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, 0)
    s.lineTo(1.6, 0.25)
    s.lineTo(0.5, 1.1)
    s.closePath()
    return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false })
  }, [])
  const material = (
    <meshPhysicalMaterial
      color="#e6ebff"
      metalness={0}
      roughness={0.32}
      transparent
      opacity={0.38}
      clearcoat={1}
      clearcoatRoughness={0.2}
      iridescence={0.7}
      iridescenceIOR={1.3}
      envMapIntensity={2}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  )
  return (
    <>
      {DISCS.map((d, i) => (
        <Float key={`d${i}`} speed={1.1 + i * 0.2} rotationIntensity={0.35} floatIntensity={0.7}>
          <mesh geometry={disc} position={d.position} rotation={d.rotation} scale={d.scale}>
            {material}
          </mesh>
        </Float>
      ))}
      {SHARDS.map((d, i) => (
        <Float key={`s${i}`} speed={1.4 + i * 0.3} rotationIntensity={0.6} floatIntensity={0.9}>
          <mesh geometry={shard} position={d.position} rotation={d.rotation} scale={d.scale}>
            {material}
          </mesh>
        </Float>
      ))}
    </>
  )
}

/* Mouse rig + zone rig. A zone change runs ONE synchronized transition:
   position, scale, a full ∞ spin, and an FOV pulse are all driven by the
   same eased progress and finish together — no separate settle/snap. */
const TRANSITION_DUR = 1.1 // seconds, ~matches the UI zone transition

function Rig({ children }) {
  const zoneGroup = useRef()
  const outer = useRef()
  const inner = useRef()
  const spin = useRef(0)
  const lastSpinTarget = useRef(0)
  const trans = useRef(null)

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const zt = ZONE_RIG[zoneBus.zone] ?? ZONE_RIG.home
    const g = zoneGroup.current

    // a zone change bumps spinTarget → capture start state and begin one tween
    if (zoneBus.spinTarget !== lastSpinTarget.current) {
      trans.current = {
        start: t,
        spinFrom: spin.current,
        spinTo: zoneBus.spinTarget,
        posFrom: g ? g.position.clone() : new THREE.Vector3(...zt.pos),
        scaleFrom: g ? g.scale.x : zt.scale,
      }
      lastSpinTarget.current = zoneBus.spinTarget
    }

    const tr = trans.current
    const p = tr ? Math.min(1, (t - tr.start) / TRANSITION_DUR) : 1
    const e = 1 - Math.pow(1 - p, 3) // easeOutCubic — reaches exactly 1

    if (g) {
      if (tr) {
        g.position.set(
          tr.posFrom.x + (zt.pos[0] - tr.posFrom.x) * e,
          tr.posFrom.y + (zt.pos[1] - tr.posFrom.y) * e,
          tr.posFrom.z + (zt.pos[2] - tr.posFrom.z) * e
        )
        g.scale.setScalar(tr.scaleFrom + (zt.scale - tr.scaleFrom) * e)
      } else {
        g.position.set(...zt.pos)
        g.scale.setScalar(zt.scale)
      }
    }
    spin.current = tr ? tr.spinFrom + (tr.spinTo - tr.spinFrom) * e : zoneBus.spinTarget

    // FOV pulse as a bell over the same window: 0 at p=0 and p=1, so it never
    // trails past the transition.
    const cam = state.camera
    const fov = 42 + Math.sin(p * Math.PI) * 9
    if (Math.abs(cam.fov - fov) > 0.0005) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }

    if (outer.current) {
      outer.current.rotation.y = THREE.MathUtils.damp(outer.current.rotation.y, state.pointer.x * 0.55, 3, dt)
      outer.current.rotation.x = THREE.MathUtils.damp(outer.current.rotation.x, -state.pointer.y * 0.38, 3, dt)
    }
    if (inner.current) {
      inner.current.rotation.y = Math.sin(t * 0.16) * 0.16 + spin.current
      inner.current.rotation.z = -0.12 + Math.sin(t * 0.11) * 0.045
      inner.current.position.y = Math.sin(t * 0.4) * 0.08
    }
  })

  return (
    <group ref={zoneGroup}>
      <group ref={outer}>
        <group ref={inner}>{children}</group>
      </group>
    </group>
  )
}

const IS_MOBILE = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches

export default function Scene() {
  return (
    <Canvas
      dpr={IS_MOBILE ? [1, 1.5] : [1, 2]}
      camera={{ position: [0, 0, 8.5], fov: 42 }}
      gl={{ antialias: !IS_MOBILE, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.18
      }}
    >
      <color attach="background" args={['#020204']} />
      <fog attach="fog" args={['#020204', 12, 30]} />
      <ambientLight intensity={0.1} />
      <pointLight position={[-6, 3, 4]} intensity={8} color="#7B2BFF" />
      <pointLight position={[6, -2, 4]} intensity={8} color="#00F0FF" />

      <MirrorColumn />
      <Rig>
        <Ribbon />
        <OrbitLines />
        <Coins />
        {!IS_MOBILE && <Sparkles count={26} scale={[7, 4, 2.5]} size={1.8} speed={0.28} opacity={0.35} color="#cfe9ff" />}
      </Rig>
      <GlassDebris />

      <Environment resolution={512} frames={1}>
        {/* big soft white key strips = the mock's liquid-chrome streaks */}
        <Lightformer intensity={14} color="#ffffff" position={[0, 4, 3]} scale={[12, 3, 1]} />
        <Lightformer intensity={5} color="#ffffff" position={[2, -4, 2]} scale={[8, 1.5, 1]} />
        <Lightformer intensity={4.5} color="#7B2BFF" position={[-5, 0, -2]} scale={[4, 10, 1]} />
        <Lightformer intensity={4.5} color="#00F0FF" position={[5, -1, 2]} scale={[4, 10, 1]} />
        <Lightformer form="ring" intensity={4} color="#d8ccff" position={[0, 0, 6]} scale={3.5} />
      </Environment>

      <EffectComposer>
        <Bloom mipmapBlur radius={0.55} intensity={IS_MOBILE ? 0.35 : 0.42} luminanceThreshold={0.85} luminanceSmoothing={0.15} />
        <Noise opacity={0.03} />
        <Vignette offset={0.1} darkness={0.95} />
      </EffectComposer>
    </Canvas>
  )
}
