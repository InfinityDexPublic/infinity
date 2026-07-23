import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePools } from '../chain/useInfinity.js'
import { useTokenMeta } from '../chain/useTokenMeta.js'
import { deriveMeta, solOf } from '../chain/display.js'

// The ticker rides the CENTRELINE of the band, i.e. the average of its top
// edge (M -20 104 Q 720 30 1460 104) and bottom edge (M -20 176 Q 720 102 1460 176):
//   centre: M -20 140 Q 720 66 1460 140   (viewBox 1440×196)
// Control point is the horizontal midpoint, so x is linear in t and the curve
// solves in closed form: t = (x+20)/1480, y = 140 − 148t + 148t².
const VB_W = 1440
const VB_H = 196
const curveY = (x) => { const t = (x + 20) / 1480; return 140 - 148 * t + 148 * t * t }
const curveSlope = (x) => { const t = (x + 20) / 1480; return (-148 + 296 * t) / 1480 }

const SPEED = 42 // px/s leftward

// shown before any pool exists — brand facts, not fake activity
const TAGLINES = ['ZERO PROTOCOL FEES', '100% TO HOLDERS', 'ONE-SIDED LIQUIDITY', 'UNRUGGABLE', 'LAUNCH FOR 0 SOL']

function PoolItem({ pool }) {
  const mintStr = pool.mint.toBase58()
  const meta = useTokenMeta(mintStr)
  const fb = deriveMeta(mintStr)
  const symbol = meta?.symbol || fb.symbol
  return (
    <>
      {meta?.image
        ? <img className="ct-av" src={meta.image} alt="" />
        : <span className="ct-av ph" style={{ background: meta?.color || fb.color }}>{symbol[0]}</span>}
      <span className="ct-sym">{symbol}<em>-SOL</em></span>
      <span className="ct-sol">{solOf(pool.realSol).toFixed(2)} SOL</span>
      {pool.sniperGuard === 1 && <span className="ct-guard">GUARDED</span>}
    </>
  )
}

export default function CurvedTicker() {
  const { pools } = usePools()
  const wrapRef = useRef(null)
  const laneRef = useRef(null)
  const [repeats, setRepeats] = useState(2)

  const entries = pools.length > 0
    ? pools.map((p) => ({ key: p.mint.toBase58(), pool: p }))
    : TAGLINES.map((t) => ({ key: t, tagline: t }))

  // measure one run, decide how many copies cover the viewport seamlessly
  useLayoutEffect(() => {
    const lane = laneRef.current, wrap = wrapRef.current
    if (!lane || !wrap) return
    const items = [...lane.children]
    const perRun = items.length / repeats
    if (!perRun) return
    let runW = 0
    for (let i = 0; i < perRun; i++) runW += items[i].offsetWidth + 56
    if (runW > 0) {
      const need = Math.max(2, Math.ceil((wrap.offsetWidth * 1.35) / runW) + 1)
      if (need !== repeats) setRepeats(need)
    }
  })

  useEffect(() => {
    let raf
    const tick = (ts) => {
      const lane = laneRef.current, wrap = wrapRef.current
      if (lane && wrap) {
        const items = [...lane.children]
        const perRun = items.length / repeats
        const s = wrap.offsetWidth / VB_W // uniform svg→px scale
        const h = items[0]?.offsetHeight || 20
        let runW = 0
        const widths = items.slice(0, perRun).map((el) => { const w = el.offsetWidth + 56; runW += w; return w })
        if (runW > 0) {
          const offset = (ts / 1000 * SPEED) % runW
          let x = -offset
          for (let i = 0; i < items.length; i++) {
            const w = widths[i % perRun]
            const ew = w - 56 // actual element width (w includes the spacer gap)
            // wrap each item independently so the loop never shows a seam
            let vx = x
            while (vx < -w) vx += runW * repeats
            // pin the item's CENTRE onto the band centreline and rotate about
            // that centre so it rides the arc without drifting off it
            const svgX = (vx + ew / 2) / s
            const cy = curveY(svgX) * s
            const ang = Math.atan(curveSlope(svgX))
            items[i].style.transform = `translate(${vx}px, ${cy - h / 2}px) rotate(${ang}rad)`
            x += w
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pools, repeats])

  const copies = []
  for (let r = 0; r < repeats; r++) {
    for (const e of entries) {
      copies.push(
        <div className="ct-item" key={`${r}-${e.key}`}>
          <span className="ct-inf-glyph">∞</span>
          {e.pool ? <PoolItem pool={e.pool} /> : <span className="ct-sym">{e.tagline}</span>}
        </div>
      )
    }
  }

  return (
    <div className="curved-ticker" aria-hidden="true" ref={wrapRef}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" preserveAspectRatio="xMidYMax meet">
        <defs>
          <linearGradient id="ct-edge" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7B2BFF" stopOpacity="0" />
            <stop offset="0.25" stopColor="#7B2BFF" stopOpacity="0.8" />
            <stop offset="0.5" stopColor="#E9E4FF" stopOpacity="0.9" />
            <stop offset="0.75" stopColor="#00F0FF" stopOpacity="0.8" />
            <stop offset="1" stopColor="#00F0FF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ct-fade" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.06" stopColor="#fff" />
            <stop offset="0.94" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="ct-mask">
            <rect x="0" y="0" width="1440" height="196" fill="url(#ct-fade)" />
          </mask>
        </defs>
        <g mask="url(#ct-mask)">
          <path d="M -20 104 Q 720 30 1460 104 L 1460 176 Q 720 102 -20 176 Z" fill="rgba(4,4,9,0.86)" />
          <path d="M -20 176 Q 720 102 1460 176 L 1460 190 Q 720 118 -20 190 Z" fill="rgba(10,10,20,0.95)" />
          <path d="M -20 104 Q 720 30 1460 104" fill="none" stroke="url(#ct-edge)" strokeWidth="1.2" opacity="0.65" />
          <path d="M -20 176 Q 720 102 1460 176" fill="none" stroke="url(#ct-edge)" strokeWidth="1" opacity="0.35" />
          <path d="M -20 190 Q 720 118 1460 190" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        </g>
      </svg>
      <div className="ct-lane" ref={laneRef}>{copies}</div>
    </div>
  )
}
