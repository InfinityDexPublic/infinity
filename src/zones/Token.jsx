import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import Sol from '../components/SolLogo.jsx'
import { poolPda, decodePool } from '../chain/infinity.js'
import { resolveToken } from '../chain/tokens.js'
import { useInfinityActions } from '../chain/useInfinity.js'
import { useSolPrice } from '../chain/useSolPrice.js'
import { deriveMeta, solOf } from '../chain/display.js'
import { fmtUsd } from '../data.js'
import { INDEXER_API, EXPLORER, EXPLORER_ADDR } from '../chain/config.js'

const ago = (ts) => {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
const short = (s) => `${s.slice(0, 4)}…${s.slice(-4)}`

// Plain-decimal price with ~3 significant figures, never scientific notation.
// Micro-cap tokens have prices like 0.0000000180 SOL — show them readably.
const fmtPrice = (v) => {
  if (!isFinite(v) || v <= 0) return '0'
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const exp = Math.floor(Math.log10(v))          // e.g. -8
  const decimals = Math.min(14, -exp + 2)        // keep 3 sig figs
  return v.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')
}
const priceUsd = (solPx, solUsd) => (solUsd ? `$${fmtPrice(solPx * solUsd)}` : '—')

// candle colours by what drove the move
const C_BUY = '#14F195', C_SELL = '#ff5c7a', C_BURN = '#ffab2e', C_DEV = '#9b5cff'
const candleColor = (c) => (c.type === 'dev' ? C_DEV : c.type === 'burn' ? C_BURN : c.up ? C_BUY : C_SELL)
const fmtAmt = (v) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(2)

/* ---------- interactive candlestick chart ---------- */
const TIMEFRAMES = [
  { label: '15s', s: 15 }, { label: '1m', s: 60 }, { label: '5m', s: 300 },
  { label: '15m', s: 900 }, { label: '1h', s: 3600 },
]

// bucket price ticks into OHLC candles aligned to real time boundaries
function buildCandles(ticks, firstOpen, tfSec) {
  if (ticks.length === 0) return []
  const groups = new Map()
  for (const tk of ticks) {
    const b = Math.floor(tk.t / tfSec)
    if (!groups.has(b)) groups.set(b, [])
    groups.get(b).push(tk)
  }
  const out = []
  let prevClose = firstOpen
  for (const b of [...groups.keys()].sort((a, z) => a - z)) {
    const g = groups.get(b)
    const o = prevClose, c = g[g.length - 1].p
    let h = Math.max(o, c), l = Math.min(o, c)
    for (const tk of g) { if (tk.p > h) h = tk.p; if (tk.p < l) l = tk.p }
    // classify: the dev buy wins; a candle made purely of buybacks is a burn
    let type = 'trade'
    if (g.some((tk) => tk.kind === 'dev')) type = 'dev'
    else if (g.every((tk) => tk.kind === 'burn')) type = 'burn'
    out.push({ t: b * tfSec, o, h, l, c, up: c >= o, type })
    prevClose = c
  }
  return out
}

function PriceChart({ ticks, firstOpen, solUsd, floorPrice = 0 }) {
  const wrapRef = useRef(null)
  const W = 720, H = 230, PAD_T = 12, PAD_B = 26, PAD_L = 6, PAD_R = 60
  const plotR = W - PAD_R // right edge of the plotting area (price gutter beyond)
  const [tfIdx, setTfIdx] = useState(0) // default 15s
  const candles = useMemo(() => buildCandles(ticks, firstOpen, TIMEFRAMES[tfIdx].s), [ticks, firstOpen, tfIdx])

  const [candleW, setCandleW] = useState(16) // horizontal zoom (viewbox units per candle)
  const [yScale, setYScale] = useState(1) // vertical zoom: >1 widens the price range (dezoom)
  const [leftIdx, setLeftIdx] = useState(null) // pan; null = auto (left-anchored / follow latest)
  const [hov, setHov] = useState(null)
  const drag = useRef(null)
  const view = useRef({})
  const zoom = (f) => setCandleW((w) => Math.max(4, Math.min(90, w * f)))
  const zoomY = (f) => setYScale((s) => Math.max(0.15, Math.min(12, s * f)))

  const visibleCount = Math.max(1, Math.floor((plotR - PAD_L) / candleW))
  const defaultLeft = candles.length <= visibleCount ? 0 : candles.length - visibleCount
  const left = leftIdx == null ? defaultLeft : Math.max(0, Math.min(leftIdx, Math.max(0, candles.length - 1)))
  view.current = { candleW, left, len: candles.length, yScale }

  // wheel zoom needs a non-passive listener to preventDefault page scroll
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e) => {
      const { candleW: cw, left: lf, len, yScale: ys } = view.current
      if (!len) return
      e.preventDefault()
      // shift+scroll (or horizontal scroll) zooms the PRICE axis
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = e.shiftKey ? e.deltaY : e.deltaX
        setYScale(Math.max(0.15, Math.min(12, ys * (d < 0 ? 1 / 1.15 : 1.15))))
        return
      }
      const r = el.getBoundingClientRect()
      const fx = ((e.clientX - r.left) / r.width) * W
      const idxAtCursor = lf + fx / cw
      const nw = Math.max(4, Math.min(90, cw * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      setCandleW(nw)
      setLeftIdx(Math.max(0, idxAtCursor - fx / nw))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (candles.length === 0) {
    return (
      <>
        <ChartToolbar tfIdx={tfIdx} setTf={(i) => { setTfIdx(i); setLeftIdx(null) }} onReset={() => { setLeftIdx(null); setCandleW(16); setYScale(1) }} onZoom={zoom} onZoomY={zoomY} />
        <div className="tk-chart empty">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1="0" x2={W} y1={PAD_T + f * (H - PAD_T - PAD_B)} y2={PAD_T + f * (H - PAD_T - PAD_B)}
                stroke="rgba(255,255,255,0.05)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2={W} y1={H - PAD_B - 34} y2={H - PAD_B - 34}
              stroke="rgba(0,240,255,0.45)" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="tk-empty-note">
            <span className="tk-empty-price">{floorPrice ? priceUsd(floorPrice, solUsd) : '—'}</span>
            <span>opening floor · no trades yet</span>
            <em>be the first to buy</em>
          </div>
        </div>
      </>
    )
  }

  // auto-fit Y to the visible candles
  let lo = Infinity, hi = -Infinity
  const vFrom = Math.max(0, Math.floor(left) - 1)
  const vTo = Math.min(candles.length, Math.ceil(left + visibleCount) + 1)
  for (let i = vFrom; i < vTo; i++) { if (candles[i].l < lo) lo = candles[i].l; if (candles[i].h > hi) hi = candles[i].h }
  if (!isFinite(lo)) { lo = 0; hi = 1 }
  const midv = (lo + hi) / 2 || hi || 1e-12
  let ylo, yhi
  if (hi - lo < midv * 1e-4) { ylo = midv * 0.9; yhi = midv * 1.1 }
  else { const pad = (hi - lo) * 0.14; ylo = lo - pad; yhi = hi + pad }
  // manual vertical zoom: widen/narrow the range around the visible centre.
  // Because the centre comes from the visible candles each render, the view
  // keeps tracking the price as it rises — yScale is just a multiplier on top.
  const yc = (ylo + yhi) / 2
  const yh = ((yhi - ylo) / 2) * yScale
  ylo = yc - yh; yhi = yc + yh
  const Y = (p) => PAD_T + (1 - (p - ylo) / (yhi - ylo)) * (H - PAD_T - PAD_B)
  const cx = (i) => PAD_L + (i - left) * candleW + candleW / 2
  const bodyW = Math.max(1.5, candleW * 0.62) // widens with zoom, keeps a gap
  const lastY = Y(candles[candles.length - 1].c)
  const hc = hov != null ? candles[hov] : null

  // ----- axes -----
  const tfSec = TIMEFRAMES[tfIdx].s
  const fmtAxisTime = (t) => {
    const d = new Date(t * 1000)
    return tfSec < 60
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const priceTicks = [0.04, 0.28, 0.52, 0.76, 0.97].map((f) => ({
    y: PAD_T + f * (H - PAD_T - PAD_B),
    p: yhi - f * (yhi - ylo),
  }))
  const tickStep = Math.max(1, Math.round(88 / candleW))
  const timeTicks = []
  for (let i = vFrom; i < vTo; i++) {
    if (cx(i) < PAD_L + 14 || cx(i) > plotR - 8) continue
    if ((candles.length - 1 - i) % tickStep === 0) timeTicks.push(i)
  }

  const onDown = (e) => {
    const el = wrapRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    const fx = ((e.clientX - r.left) / r.width) * W
    // dragging in the right price gutter scales the PRICE axis; elsewhere pans
    drag.current = fx > plotR ? { mode: 'y', y: e.clientY, base: yScale } : { mode: 'x', x: e.clientX, left }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    const el = wrapRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    if (drag.current?.mode === 'y') {
      const dy = e.clientY - drag.current.y // drag down = zoom out (wider range)
      setYScale(Math.max(0.15, Math.min(12, drag.current.base * Math.exp(dy / 170))))
      setHov(null)
      return
    }
    if (drag.current?.mode === 'x') {
      const dx = ((e.clientX - drag.current.x) / r.width) * W
      setLeftIdx(Math.max(0, Math.min(drag.current.left - dx / candleW, Math.max(0, candles.length - 1))))
      setHov(null)
      return
    }
    const fx = ((e.clientX - r.left) / r.width) * W
    if (fx > plotR) { setHov(null); return }
    let best = null, bd = Infinity
    for (let i = vFrom; i < vTo; i++) { const d = Math.abs(cx(i) - fx); if (d < bd) { bd = d; best = i } }
    setHov(bd <= candleW ? best : null)
  }
  const onUp = () => { drag.current = null }
  const resetView = () => { setLeftIdx(null); setCandleW(16); setYScale(1) }
  const cursor = drag.current ? (drag.current.mode === 'y' ? 'ns-resize' : 'grabbing') : 'crosshair'

  return (
    <>
      <ChartToolbar tfIdx={tfIdx} setTf={(i) => { setTfIdx(i); resetView() }} onReset={resetView} onZoom={zoom} onZoomY={zoomY} />
      <div className="tk-chart" ref={wrapRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onPointerLeave={() => { onUp(); setHov(null) }} onDoubleClick={resetView}
        style={{ cursor, touchAction: 'none' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* horizontal grid aligned to the price ticks */}
          {priceTicks.map((t, k) => (
            <line key={`h${k}`} x1={PAD_L} x2={plotR} y1={t.y} y2={t.y}
              stroke="rgba(255,255,255,0.05)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {/* vertical grid at the time ticks */}
          {timeTicks.map((i) => (
            <line key={`v${i}`} x1={cx(i)} x2={cx(i)} y1={PAD_T} y2={H - PAD_B}
              stroke="rgba(255,255,255,0.04)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={PAD_L} x2={plotR} y1={lastY} y2={lastY} stroke="rgba(0,240,255,0.32)" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          {hc && (
            <line x1={cx(hov)} x2={cx(hov)} y1={PAD_T} y2={H - PAD_B}
              stroke="rgba(255,255,255,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          {(() => {
            const els = []
            for (let i = vFrom; i < vTo; i++) {
              const x = cx(i)
              if (x < PAD_L - bodyW || x > plotR + bodyW) continue
              const c = candles[i]
              const col = candleColor(c)
              const yO = Y(c.o), yC = Y(c.c)
              const top = Math.min(yO, yC)
              const bh = Math.max(2, Math.abs(yO - yC))
              els.push(
                <g key={i}>
                  <line x1={x} x2={x} y1={Y(c.h)} y2={Y(c.l)} stroke={col} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                  <rect x={x - bodyW / 2} y={top} width={bodyW} height={bh} fill={col} opacity="0.95" rx="1" />
                </g>
              )
            }
            return els
          })()}
          <line x1={plotR} x2={plotR} y1={PAD_T} y2={H - PAD_B} stroke="rgba(255,255,255,0.08)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* price axis (right) */}
        {priceTicks.map((t, k) => (
          <span key={k} className="tk-yaxis" style={{ top: `${(t.y / H) * 100}%` }}>{priceUsd(t.p, solUsd)}</span>
        ))}
        <span className="tk-yaxis cur" style={{ top: `${(lastY / H) * 100}%` }}>{priceUsd(candles[candles.length - 1].c, solUsd)}</span>
        {/* time axis (bottom) */}
        {timeTicks.map((i) => (
          <span key={i} className="tk-xaxis" style={{ left: `${(cx(i) / W) * 100}%` }}>{fmtAxisTime(candles[i].t)}</span>
        ))}
        {hc && (
          <div className="tk-ch-tip candle" style={(() => {
            const px = (cx(hov) / W) * 100
            // anchor to whichever side keeps the tooltip inside the plot
            const tx = px < 24 ? '8px' : px > 76 ? 'calc(-100% - 8px)' : '-50%'
            return { left: `${Math.max(0, Math.min(px, 100))}%`, transform: `translateX(${tx})` }
          })()}>
            <strong style={{ color: candleColor(hc) }}>{priceUsd(hc.c, solUsd)}</strong>
            <span style={{ color: candleColor(hc) }}>
              {hc.type === 'dev' ? '◆ DEV BUY'
                : hc.type === 'burn' ? '🔥 BUYBACK BURN'
                : hc.o > 0 ? `${hc.c >= hc.o ? '▲ +' : '▼ '}${((hc.c - hc.o) / hc.o * 100).toFixed(2)}%` : ''}
            </span>
            <span>{fmtPrice(hc.c)} SOL</span>
            <em>{new Date(hc.t * 1000).toLocaleTimeString()}</em>
          </div>
        )}
      </div>
    </>
  )
}

function ChartToolbar({ tfIdx, setTf, onReset, onZoom, onZoomY }) {
  return (
    <div className="tk-tf">
      {TIMEFRAMES.map((t, i) => (
        <button key={t.label} className={i === tfIdx ? 'on' : ''} onClick={() => setTf(i)}>{t.label}</button>
      ))}
      <button className="tk-reset" onClick={onReset} title="Reset view">⟲</button>
      <span className="tk-tf-hint">scroll = time · shift+scroll = price · drag = pan</span>
      <span className="tk-zoom">
        <em>↔</em>
        <button onClick={() => onZoom(1 / 1.3)} title="Zoom out (time)">−</button>
        <button onClick={() => onZoom(1.3)} title="Zoom in (time)">+</button>
        <em>↕</em>
        <button onClick={() => onZoomY(1.3)} title="Zoom out (price)">−</button>
        <button onClick={() => onZoomY(1 / 1.3)} title="Zoom in (price)">+</button>
      </span>
    </div>
  )
}

// DEV / YOU tags for an address
function AddrTags({ owner, dev, me }) {
  return (
    <>
      {owner === dev && <em className="tk-badge dev">DEV</em>}
      {owner === me && <em className="tk-badge you">YOU</em>}
    </>
  )
}

/* ---------- holders ---------- */
function Holders({ mint, vault, supplyRaw, decimals, dev, me }) {
  const { connection } = useConnection()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const { value } = await connection.getTokenLargestAccounts(new PublicKey(mint))
        const infos = await connection.getMultipleParsedAccounts(value.map((v) => v.address))
        const out = value.map((v, i) => {
          const parsed = infos.value[i]?.data?.parsed?.info
          return {
            tokenAccount: v.address.toBase58(),
            owner: parsed?.owner || v.address.toBase58(),
            amount: Number(v.amount) / 10 ** decimals,
            isVault: vault && v.address.toBase58() === vault,
          }
        }).filter((r) => r.amount > 0)
        if (alive) setRows(out)
      } catch { if (alive) setRows([]) }
    }
    load()
    const t = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [connection, mint, vault, decimals])

  const supply = supplyRaw / 10 ** decimals
  return (
    <div className="tk-holders">
      {!rows && <div className="tk-dim">loading holders…</div>}
      {rows && rows.length === 0 && <div className="tk-dim">no holders found</div>}
      {rows?.map((r, i) => {
        const pct = supply > 0 ? (r.amount / supply) * 100 : 0
        return (
          <a key={r.tokenAccount} className="tk-holder" href={EXPLORER_ADDR(r.owner)} target="_blank" rel="noreferrer">
            <span className="tk-h-rank">{i + 1}</span>
            <span className="tk-h-addr">
              {r.isVault ? <em>∞ INFINITY POOL · LOCKED</em> : short(r.owner)}
              {!r.isVault && <AddrTags owner={r.owner} dev={dev} me={me} />}
            </span>
            <span className="tk-h-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
            <span className="tk-h-pct">{pct < 0.01 ? '<0.01' : pct.toFixed(2)}%</span>
          </a>
        )
      })}
    </div>
  )
}

/* ---------- live trades ---------- */
function Trades({ rows, decimals, solUsd, dev, me }) {
  if (!rows) return <div className="tk-dim">loading trades…</div>
  if (rows.length === 0) return <div className="tk-dim">no trades yet</div>
  return (
    <div className="tk-trades">
      {rows.map((r) => {
        const d = r.data
        if (r.kind === 'AirdropPayout') {
          const sol = solOf(d.total)
          return (
            <a key={r.id} className="tk-trade drop" href={EXPLORER(r.sig)} target="_blank" rel="noreferrer">
              <span className="tk-side drop">🎁 DROP</span>
              <span className="tk-t-sol">{sol.toFixed(4)} <Sol size={9} /></span>
              <span className="tk-t-usd">{solUsd ? fmtUsd(sol * solUsd) : ''}</span>
              <span className="tk-t-amt">{d.recipients} holders</span>
              <span className="tk-t-ago">{ago(r.ts)}</span>
            </a>
          )
        }
        const isCrank = r.kind === 'FlywheelCrank'
        const side = isCrank ? 'burn' : d.isBuy ? 'buy' : 'sell'
        const sol = solOf(isCrank ? d.solIn : d.solAmount)
        const amt = Number(isCrank ? d.tokensBurned : d.tokenAmount) / 10 ** decimals
        return (
          <a key={r.id} className={`tk-trade ${side}`} href={EXPLORER(r.sig)} target="_blank" rel="noreferrer">
            <span className={`tk-side ${side}`}>
              {side === 'burn' ? '🔥 BURN' : side.toUpperCase()}
              {!isCrank && <AddrTags owner={d.trader} dev={dev} me={me} />}
            </span>
            <span className="tk-t-sol">{sol.toFixed(4)} <Sol size={9} /></span>
            <span className="tk-t-usd">{solUsd ? fmtUsd(sol * solUsd) : ''}</span>
            <span className="tk-t-amt">{fmtAmt(amt)}</span>
            <span className="tk-t-ago">{ago(r.ts)}</span>
          </a>
        )
      })}
    </div>
  )
}

/* ---------- buy / sell ---------- */
function TradeSheet({ side, pool, mint, meta, solUsd, onClose }) {
  const { publicKey, wallets, select, wallet, connect } = useWallet()
  const { connection } = useConnection()
  const { buy, sell } = useInfinityActions()
  const pendingConnect = useRef(false)
  const isBuy = side === 'buy'
  const dec = meta?.decimals ?? 6
  const tp = meta?.tokenProgram || TOKEN_PROGRAM_ID
  const sym = meta?.symbol || 'TOKEN'
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [bal, setBal] = useState(null)

  useEffect(() => {
    let alive = true
    setBal(null)
    if (!publicKey) return
    ;(async () => {
      try {
        if (isBuy) {
          const l = await connection.getBalance(publicKey)
          if (alive) setBal(l / 1e9)
        } else {
          const ata = getAssociatedTokenAddressSync(new PublicKey(mint), publicKey, false, tp)
          const acc = await getAccount(connection, ata, undefined, tp)
          if (alive) setBal(Number(acc.amount) / 10 ** dec)
        }
      } catch { if (alive) setBal(0) }
    })()
    return () => { alive = false }
  }, [publicKey, isBuy, mint, connection, tp, dec, status])

  const a = parseFloat(amount) || 0
  const feePct = pool ? pool.feeBps / 10000 : 0
  const y = pool ? Number(pool.virtualSol + pool.realSol) : 0
  const x = pool ? Number(pool.tokenReserve) : 0
  const pxSol = x > 0 ? (y / 1e9) / (x / 10 ** dec) : 0
  let out = 0, floorOk = true
  if (pool && a > 0) {
    if (isBuy) {
      const net = a * 1e9 * (1 - feePct)
      out = (x * net) / (y + net) / 10 ** dec
    } else {
      const tokIn = a * 10 ** dec
      const gross = (y * tokIn) / (x + tokIn)
      floorOk = gross <= Number(pool.realSol)
      out = (gross * (1 - feePct)) / 1e9
    }
  }
  const recvUsd = solUsd ? (isBuy ? out * pxSol : out) * solUsd : 0

  const setPct = (f) => {
    if (bal == null) return
    let v = bal * f
    if (isBuy && f === 1) v = Math.max(0, bal - 0.02)
    const d = isBuy ? 9 : Math.min(dec, 9)
    setAmount(v > 0 ? (v.toFixed(d).replace(/\.?0+$/, '') || '0') : '0')
  }

  const submit = async () => {
    if (!publicKey) { setStatus({ err: 'connect a wallet' }); return }
    if (a <= 0) return
    if (!isBuy && !floorOk) { setStatus({ err: 'exceeds the pool floor, reduce the amount' }); return }
    setBusy(true); setStatus(null)
    try {
      const m = new PublicKey(mint)
      let sig
      if (isBuy) {
        const minOut = BigInt(Math.floor(out * 10 ** dec * 0.97))
        sig = await buy({ mint: m, solIn: a, minTokensOut: minOut, tokenProgram: tp })
      } else {
        const minSol = Math.floor(out * 1e9 * 0.97)
        sig = await sell({ mint: m, tokensIn: BigInt(Math.floor(a * 10 ** dec)), minSolOut: minSol, tokenProgram: tp })
      }
      setStatus({ sig }); setAmount('')
    } catch (e) { setStatus({ err: String(e.message || e).slice(0, 140) }) }
    finally { setBusy(false) }
  }

  // connect from the sheet: reuse a selected wallet, else pick the first detected
  const connectWallet = () => {
    if (wallet) { connect().catch(() => {}); return }
    const w = wallets.find((x) => x.readyState === 'Installed') || wallets.find((x) => x.readyState === 'Loadable') || wallets[0]
    if (w) { pendingConnect.current = true; select(w.adapter.name) }
  }
  useEffect(() => {
    if (pendingConnect.current && wallet && !publicKey) { pendingConnect.current = false; connect().catch(() => {}) }
  }, [wallet, publicKey, connect])

  const outStr = out > 0 ? out.toLocaleString(undefined, { maximumFractionDigits: isBuy ? 2 : 6 }) : '0'
  return (
    <div className="trade-sheet-overlay" onClick={onClose}>
      <div className={`trade-sheet ${isBuy ? 'buy' : 'sell'}`} onClick={(e) => e.stopPropagation()}>
        <div className="ts-head">
          <span>{isBuy ? 'BUY' : 'SELL'} ${sym}</span>
          <button className="ts-close" onClick={onClose}>×</button>
        </div>
        <div className="ts-amt">
          <input autoFocus inputMode="decimal" placeholder="0.00" value={amount}
            onChange={(e) => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setAmount(v) }} />
          <span className="ts-unit">{isBuy ? <><Sol size={13} /> SOL</> : sym}</span>
        </div>
        <div className="ts-pct">
          {bal != null && <button className="ts-bal" onClick={() => setPct(1)}>bal {isBuy ? bal.toFixed(3) : bal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</button>}
          <button onClick={() => setPct(0.25)}>25%</button>
          <button onClick={() => setPct(0.5)}>50%</button>
          <button onClick={() => setPct(1)}>MAX</button>
        </div>
        <div className="ts-quote">
          <span>you receive</span>
          <strong>≈ {outStr} {isBuy ? sym : 'SOL'}</strong>
          <em>{recvUsd ? `$${recvUsd.toLocaleString(undefined, { maximumFractionDigits: recvUsd < 1 ? 4 : 2 })}` : ''}</em>
        </div>
        {!isBuy && !floorOk && a > 0 && <div className="ts-warn">Exceeds the pool's real SOL floor. Reduce the amount.</div>}
        <button className={`ts-go ${isBuy ? 'buy' : 'sell'}`}
          disabled={busy || (publicKey && (a <= 0 || (!isBuy && !floorOk)))}
          onClick={publicKey ? submit : connectWallet}>
          {busy ? 'CONFIRMING…' : !publicKey ? 'CONNECT WALLET' : isBuy ? `BUY ${sym}` : `SELL ${sym}`}
        </button>
        {status?.sig && <a className="tx-ok" href={EXPLORER(status.sig)} target="_blank" rel="noreferrer">✓ done, view tx</a>}
        {status?.err && <div className="tx-err">{status.err}</div>}
        <div className="ts-note">0% protocol fee · pool fee {(feePct * 100).toFixed(1)}% · 3% max slippage</div>
      </div>
    </div>
  )
}

function TradeBar({ symbol, onBuy, onSell }) {
  return (
    <div className="trade-bar">
      <button className="tb-buy" onClick={onBuy}>+ BUY {symbol}</button>
      <button className="tb-sell" onClick={onSell}>− SELL {symbol}</button>
    </div>
  )
}

/* ---------- page ---------- */
export default function Token({ mint, go }) {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const solUsd = useSolPrice()
  const [pool, setPool] = useState(null)
  const [meta, setMeta] = useState(null)
  const [supplyRaw, setSupplyRaw] = useState(0)
  const [trades, setTrades] = useState(null)
  const [copied, setCopied] = useState(false)
  const [sheet, setSheet] = useState(null) // 'buy' | 'sell' | null

  const mintStr = mint || ''
  const poolAddr = useMemo(() => {
    try { return poolPda(new PublicKey(mintStr)).toBase58() } catch { return null }
  }, [mintStr])

  // pool account + metadata + supply
  useEffect(() => {
    if (!mintStr || !poolAddr) return
    let alive = true
    const load = async () => {
      try {
        const acc = await connection.getAccountInfo(new PublicKey(poolAddr))
        if (acc && alive) setPool(decodePool(acc.data))
      } catch { /* keep last */ }
    }
    load()
    resolveToken(connection, mintStr).then((t) => alive && setMeta(t)).catch(() => {})
    connection.getTokenSupply(new PublicKey(mintStr)).then((s) => alive && setSupplyRaw(Number(s.value.amount))).catch(() => {})
    const t = setInterval(load, 12_000)
    return () => { alive = false; clearInterval(t) }
  }, [connection, mintStr, poolAddr])

  // live trades from the indexer
  useEffect(() => {
    if (!poolAddr) return
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`${INDEXER_API}/pool/${poolAddr}/trades`).then((x) => x.json())
        if (alive && Array.isArray(r)) setTrades(r)
      } catch { /* keep last */ }
    }
    load()
    const t = setInterval(load, 5_000)
    return () => { alive = false; clearInterval(t) }
  }, [poolAddr])

  const decimals = meta?.decimals ?? 6
  const fb = deriveMeta(mintStr)
  const symbol = meta?.symbol || fb.symbol
  const name = meta?.name && meta.name !== 'Token' ? meta.name : symbol

  const priceSol = pool ? (Number(pool.virtualSol + pool.realSol) / 1e9) / (Number(pool.tokenReserve) / 10 ** decimals) : 0
  const circulating = supplyRaw > 0 ? supplyRaw / 10 ** decimals : 0
  const mcap = priceSol * circulating * (solUsd || 0)
  const hasAirdrop = (pool?.airdropShareBps || 0) > 0
  const totalAirdropped = useMemo(
    () => (trades || []).filter((r) => r.kind === 'AirdropPayout').reduce((s, r) => s + Number(r.data.total || 0), 0) / 1e9,
    [trades]
  )

  // raw price ticks from on-chain events (the chart buckets them per timeframe).
  // firstOpen = the pool's price just before the first buy, so the very first
  // candle opens at the floor rather than at the post-buy price.
  const { ticks, firstOpen } = useMemo(() => {
    if (!pool || !trades) return { ticks: [], firstOpen: 0 }
    const dec = 10 ** decimals
    const virt = Number(pool.virtualSol)
    const dev = pool.feeReceiver.toBase58()
    const evs = trades.filter((r) => r.kind === 'Swap' || r.kind === 'FlywheelCrank')
    if (evs.length === 0) return { ticks: [], firstOpen: 0 }
    const tk = evs.map((r) => {
      // any buy by the creator (fee receiver) is a dev buy
      const kind = r.kind === 'FlywheelCrank' ? 'burn'
        : (r.data.isBuy && r.data.trader === dev) ? 'dev'
        : r.data.isBuy ? 'buy' : 'sell'
      return { t: r.ts, p: (virt + Number(r.data.realSol)) / 1e9 / (Number(r.data.tokenReserve) / dec), kind }
    })
    tk.sort((a, b) => a.t - b.t)
    let fo = tk[0].p
    const f = evs[0]
    if (f.kind === 'Swap' && f.data.isBuy) {
      const reserveBefore = Number(f.data.tokenReserve) + Number(f.data.tokenAmount)
      const op = virt / 1e9 / (reserveBefore / dec)
      if (isFinite(op) && op > 0) fo = op
    }
    return { ticks: tk, firstOpen: fo }
  }, [trades, pool, decimals])

  const copyCa = async () => {
    try { await navigator.clipboard.writeText(mintStr) } catch { /* noop */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  if (!mintStr) {
    return <div className="token-wrap"><div className="tk-dim" style={{ marginTop: 140 }}>No token selected — pick one from the Pools page.</div></div>
  }

  const tradesDesc = trades ? [...trades].reverse().slice(0, 30) : null

  return (
    <div className="token-wrap">
      {/* identity + actions */}
      <section className="tk-head glass zone-item" style={{ '--i': 0 }}>
        {meta?.image
          ? <img className="tk-avatar" src={meta.image} alt="" />
          : <span className="tk-avatar ph" style={{ background: meta?.color || fb.color }}>{symbol[0]}</span>}
        <div className="tk-id">
          <h1>{name} <em>${symbol}</em>{pool?.sniperGuard === 1 && <span className="live-badge guard">GUARD</span>}</h1>
          <button className="tk-ca" onClick={copyCa} title="Copy contract address">
            <code>{mintStr}</code><span>{copied ? '✓ copied' : 'copy'}</span>
          </button>
          <div className="tk-links">
            {meta?.website && <a href={meta.website} target="_blank" rel="noreferrer">🌐 website</a>}
            {meta?.twitter && <a href={meta.twitter} target="_blank" rel="noreferrer">𝕏 twitter</a>}
            {meta?.telegram && <a href={meta.telegram} target="_blank" rel="noreferrer">✈ telegram</a>}
            <a href={EXPLORER_ADDR(mintStr)} target="_blank" rel="noreferrer">solscan ↗</a>
          </div>
        </div>
        <div className="tk-cta">
          <span className="tk-mc-label">MARKET CAP</span>
          <strong className="tk-mc">{mcap > 0 ? fmtUsd(mcap) : '—'}</strong>
          <span className="tk-px">{solUsd ? priceUsd(priceSol, solUsd) : '…'} <em>·</em> {fmtPrice(priceSol)} SOL</span>
        </div>
      </section>

      {/* stat band */}
      <div className="pools-band tk-band zone-item" style={{ '--i': 1 }}>
        <div className="band-cell"><span className="mini-label">LIQUIDITY</span><span className="mini-val">{pool ? solOf(pool.realSol).toFixed(3) : '—'}&nbsp;<Sol size={11} /></span></div>
        <div className="band-cell"><span className="mini-label">FLOOR</span><span className="mini-val">{pool ? solOf(pool.virtualSol) : '—'}&nbsp;<Sol size={11} /></span></div>
        <div className="band-cell"><span className="mini-label">VOLUME</span><span className="mini-val">{pool ? solOf(pool.totalSolVolume).toFixed(2) : '—'}&nbsp;<Sol size={11} /></span></div>
        <div className="band-cell"><span className="mini-label">BURNED</span><span className="mini-val burn">{pool ? fmtAmt(Number(pool.totalBurned) / 10 ** decimals) : '—'}</span></div>
        {hasAirdrop && <div className="band-cell"><span className="mini-label">AIRDROPPED</span><span className="mini-val good">{totalAirdropped.toFixed(3)}&nbsp;<Sol size={11} /></span></div>}
        <div className="band-cell"><span className="mini-label">SWAP FEE</span><span className="mini-val">{pool ? `${(pool.feeBps / 100).toFixed(1)}%` : '—'}</span></div>
      </div>

      {/* fee split */}
      {pool && (() => {
        const cShare = pool.creatorShareBps / 100
        const aShare = (pool.airdropShareBps || 0) / 100
        const bShare = 100 - cShare - aShare
        return (
          <div className="tk-split zone-item" style={{ '--i': 1.5 }}>
            <div className="tk-split-head">
              <span>FEE SPLIT</span>
              <span className="tk-split-fee">{(pool.feeBps / 100).toFixed(1)}% swap fee · 0% protocol</span>
            </div>
            <div className="split-bar">
              <i className="sb-creator" style={{ width: `${cShare}%` }} />
              <i className="sb-airdrop" style={{ width: `${aShare}%` }} />
              <i className="sb-burn" style={{ width: `${bShare}%` }} />
            </div>
            <div className="split-legend">
              <span><i className="sb-creator" /> creator {cShare}%</span>
              <span><i className="sb-airdrop" /> holders airdrop {aShare}%</span>
              <span><i className="sb-burn" /> buyback &amp; burn {bShare}%</span>
            </div>
          </div>
        )
      })()}

      {/* chart */}
      <section className="tk-panel glass zone-item" style={{ '--i': 2 }}>
        <div className="lps-header tk-h">PRICE <span className="tk-sub">USD · from on-chain trades</span></div>
        <PriceChart ticks={ticks} firstOpen={firstOpen} solUsd={solUsd || 0} floorPrice={pool ? Number(pool.virtualSol) / 1e9 / (Number(pool.tokenReserve) / 10 ** decimals) : 0} />
        <div className="tk-legend">
          <span><i style={{ background: C_BUY }} /> buy</span>
          <span><i style={{ background: C_SELL }} /> sell</span>
          <span><i style={{ background: C_BURN }} /> buyback &amp; burn</span>
          <span><i style={{ background: C_DEV }} /> dev buy</span>
        </div>
      </section>

      <div className="tk-cols">
        {/* live transactions */}
        <section className="tk-panel glass zone-item" style={{ '--i': 3 }}>
          <div className="lps-header tk-h">LIVE TRANSACTIONS</div>
          <Trades rows={tradesDesc} decimals={decimals} solUsd={solUsd} dev={pool?.feeReceiver?.toBase58()} me={publicKey?.toBase58()} />
        </section>

        {/* holders */}
        <section className="tk-panel glass zone-item" style={{ '--i': 4 }}>
          <div className="lps-header tk-h">TOP HOLDERS</div>
          <Holders mint={mintStr} vault={pool?.tokenVault?.toBase58()} supplyRaw={supplyRaw} decimals={decimals} dev={pool?.feeReceiver?.toBase58()} me={publicKey?.toBase58()} />
        </section>
      </div>

      <TradeBar symbol={symbol} onBuy={() => setSheet('buy')} onSell={() => setSheet('sell')} />
      {sheet && <TradeSheet side={sheet} pool={pool} mint={mintStr} meta={meta} solUsd={solUsd} onClose={() => setSheet(null)} />}
    </div>
  )
}
