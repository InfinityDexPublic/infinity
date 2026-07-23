import { useEffect, useRef, useState } from 'react'
import Scene from './three/Scene.jsx'
import Header from './components/Header.jsx'
import CurvedTicker from './components/CurvedTicker.jsx'
import MobileNav from './components/MobileNav.jsx'
import InAppBrowserBanner from './components/InAppBrowserBanner.jsx'
import Home from './zones/Home.jsx'
import Launch from './zones/Launch.jsx'
import Pools from './zones/Pools.jsx'
import Swap from './zones/Swap.jsx'
import Claim from './zones/Claim.jsx'
import Docs from './zones/Docs.jsx'
import Token from './zones/Token.jsx'
import { zoneBus } from './zoneBus.js'

const OUT_MS = 420
const IN_MS = 800
const VALID_ZONES = ['home', 'launch', 'pools', 'swap', 'claim', 'docs', 'token']
const parseHash = () => {
  const h = (window.location.hash || '').replace(/^#\/?/, '')
  const tk = h.match(/^token\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)
  if (tk) return { zone: 'token', param: tk[1] }
  return { zone: VALID_ZONES.includes(h) ? h : 'home', param: null }
}
const hashFor = (zone, payload) =>
  zone === 'token' && payload?.mint ? `token/${payload.mint}` : zone

export default function App() {
  // deep-linkable: /#swap, /#launch, /#pools, /#token/<mint> …
  const [zone, setZone] = useState(() => { const z = parseHash().zone; zoneBus.zone = z; return z })
  const [phase, setPhase] = useState('idle') // idle | out | in
  const [swapPool, setSwapPool] = useState(null)
  const [tokenMint, setTokenMint] = useState(() => parseHash().param)
  const pending = useRef(null)

  const go = (next, payload = null) => {
    if (phase !== 'idle' || (next === zone && next !== 'token')) return
    pending.current = { next, payload }
    zoneBus.zone = next // 3D starts gliding immediately
    zoneBus.warpTarget = 1
    zoneBus.spinTarget += Math.PI * 2 // one smooth full turn, ends facing forward
    const h = hashFor(next, payload)
    if ((window.location.hash || '').replace(/^#\/?/, '') !== h) window.location.hash = h
    setPhase('out')
  }

  // sync with the URL hash (back/forward, shared deep-links)
  useEffect(() => {
    const onHash = () => {
      const { zone: z, param } = parseHash()
      if (z !== zone || (z === 'token' && param !== tokenMint)) go(z, param ? { mint: param } : null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [zone, phase, tokenMint])

  useEffect(() => {
    if (phase === 'out') {
      const t = setTimeout(() => {
        const { next, payload } = pending.current
        if (next === 'swap') setSwapPool(payload)
        if (next === 'token') setTokenMint(payload?.mint || null)
        setZone(next)
        setPhase('in')
      }, OUT_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'in') {
      const t = setTimeout(() => {
        setPhase('idle')
        zoneBus.warpTarget = 0
      }, IN_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  // UI parallax: panels drift subtly with the cursor, in sync with the 3D rig
  useEffect(() => {
    const onMove = (e) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1
      const y = (e.clientY / window.innerHeight) * 2 - 1
      document.documentElement.style.setProperty('--mx', x.toFixed(3))
      document.documentElement.style.setProperty('--my', y.toFixed(3))
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div className="app">
      <div className="scene-layer">
        <Scene />
      </div>
      <div className={`ui-layer phase-${phase}`}>
        <InAppBrowserBanner />
        <Header zone={zone} go={go} />
        <main className={`zone zone-${zone}`}>
          {zone === 'home' && <Home go={go} />}
          {zone === 'launch' && <Launch go={go} />}
          {zone === 'pools' && <Pools go={go} />}
          {zone === 'swap' && <Swap pool={swapPool} go={go} />}
          {zone === 'claim' && <Claim go={go} />}
          {zone === 'docs' && <Docs />}
          {zone === 'token' && <Token mint={tokenMint} go={go} />}
        </main>
        <div className={`ticker-slot ${zone === 'launch' || zone === 'token' || zone === 'docs' ? 'hidden' : ''}`}>
          <CurvedTicker />
        </div>
        <MobileNav zone={zone} go={go} />
      </div>
      <div className="grain" aria-hidden="true" />
    </div>
  )
}
