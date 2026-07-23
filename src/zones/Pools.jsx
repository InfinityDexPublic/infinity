import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import Sol from '../components/SolLogo.jsx'
import { usePools } from '../chain/useInfinity.js'
import { useSolPrice } from '../chain/useSolPrice.js'
import { resolveToken } from '../chain/tokens.js'
import { deriveMeta, solOf, fmtSol } from '../chain/display.js'
import { fmtUsd } from '../data.js'
import { INDEXER_API } from '../chain/config.js'

const SORTS = [
  { key: 'new', label: 'New' },
  { key: 'mcap', label: 'Highest MC' },
  { key: 'volume', label: 'Trending' },
]

function LiveCard({ pool, go, price, meta, mcap, flashing }) {
  const mintStr = pool.mint.toBase58()
  const fb = deriveMeta(mintStr)
  const symbol = meta?.symbol || fb.symbol
  const name = (meta?.name && meta.name !== 'Token') ? meta.name : `${mintStr.slice(0, 10)}…`
  const color = meta?.color || fb.color
  const image = meta?.image
  const real = solOf(pool.realSol)
  const virt = solOf(pool.virtualSol)
  return (
    <button data-flip={mintStr} className={`pool-card glass ${flashing ? 'bumped' : ''}`} onClick={() => go('token', { mint: mintStr })}>
      <div className="pool-head">
        <span className="pool-avatar" style={{ background: color }}>
          {image ? <img className="pool-avatar-img" src={image} alt="" /> : fb.glyph}
        </span>
        <div className="pool-id">
          <span className="pool-sym">{symbol}<em>-SOL</em></span>
          <span className="pool-name">{name}</span>
        </div>
        <div className="pool-head-right">
          {pool.sniperGuard === 1 && <span className="live-badge guard">GUARD</span>}
          <span className="pool-mcap"><em>MCAP</em>{mcap ? fmtUsd(mcap) : '—'}</span>
        </div>
      </div>
      <div className="pool-stats">
        <div><span>REAL SOL</span><strong>{fmtSol(real)}&nbsp;<Sol size={10} /></strong></div>
        <div><span>FLOOR</span><strong>{virt}&nbsp;<Sol size={10} /></strong></div>
        <div><span>FEE</span><strong>{(pool.feeBps / 100).toFixed(1)}%</strong></div>
        <div><span>≈ TVL</span><strong>{price ? fmtUsd(real * price) : '—'}</strong></div>
      </div>
    </button>
  )
}

export default function Pools({ go }) {
  const { pools, loading } = usePools()
  const price = useSolPrice()
  const { connection } = useConnection()
  const tvl = pools.reduce((s, p) => s + solOf(p.realSol), 0)

  const [sort, setSort] = useState('new')
  const [live, setLive] = useState(false)
  const [metaMap, setMetaMap] = useState({})
  const [activity, setActivity] = useState({}) // mint -> last trade ts
  const [flashSet, setFlashSet] = useState(() => new Set())

  // resolve token metadata (name / image / supply) for display + mcap sorting
  useEffect(() => {
    let alive = true
    Promise.all(pools.map((p) => resolveToken(connection, p.mint.toBase58())
      .then((t) => [p.mint.toBase58(), t]).catch(() => null)))
      .then((entries) => { if (alive) setMetaMap((m) => ({ ...m, ...Object.fromEntries(entries.filter(Boolean)) })) })
    return () => { alive = false }
  }, [pools, connection])

  const mcapOf = (p) => {
    const m = metaMap[p.mint.toBase58()]
    if (!m || m.supply == null || !price) return 0
    const dec = m.decimals ?? 6
    const px = Number(p.tokenReserve) > 0 ? (Number(p.virtualSol + p.realSol) / 1e9) / (Number(p.tokenReserve) / 10 ** dec) : 0
    return px * (Number(m.supply) / 10 ** dec) * price
  }

  // live mode: poll recent activity, bump freshly-traded pools to the top
  useEffect(() => {
    if (!live || pools.length === 0) return
    let alive = true
    const addrToMint = Object.fromEntries(pools.map((p) => [p.address.toBase58(), p.mint.toBase58()]))
    const load = async () => {
      try {
        const feed = await fetch(`${INDEXER_API}/feed?limit=40`).then((r) => r.json())
        if (!alive || !Array.isArray(feed)) return
        const fresh = {}
        for (const ev of feed) {
          const mint = addrToMint[ev.data?.pool]
          if (mint && (!fresh[mint] || ev.ts > fresh[mint])) fresh[mint] = ev.ts
        }
        setActivity((prev) => {
          const bumped = Object.entries(fresh).filter(([m, ts]) => prev[m] != null && ts > prev[m]).map(([m]) => m)
          if (bumped.length) {
            setFlashSet((s) => new Set([...s, ...bumped]))
            bumped.forEach((m) => setTimeout(() => setFlashSet((s) => { const n = new Set(s); n.delete(m); return n }), 1700))
          }
          return { ...prev, ...fresh }
        })
      } catch { /* keep last */ }
    }
    load()
    const t = setInterval(load, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [live, pools])

  const sorted = useMemo(() => {
    const arr = [...pools]
    if (live) {
      arr.sort((a, b) => (activity[b.mint.toBase58()] || 0) - (activity[a.mint.toBase58()] || 0) || Number(b.createdAtSlot - a.createdAtSlot))
    } else if (sort === 'mcap') {
      arr.sort((a, b) => mcapOf(b) - mcapOf(a))
    } else if (sort === 'volume') {
      arr.sort((a, b) => Number(b.totalSolVolume - a.totalSolVolume))
    } else {
      arr.sort((a, b) => Number(b.createdAtSlot - a.createdAtSlot))
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, sort, live, activity, metaMap, price])

  // FLIP: slide cards to their new positions whenever the order changes
  const prevPos = useRef(new Map())
  useLayoutEffect(() => {
    document.querySelectorAll('.pools-grid [data-flip]').forEach((el) => {
      const id = el.getAttribute('data-flip')
      const r = el.getBoundingClientRect()
      const p = prevPos.current.get(id)
      if (p) {
        const dx = p.x - r.left, dy = p.y - r.top
        if (dx || dy) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            { duration: 500, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
        }
      }
      prevPos.current.set(id, { x: r.left, y: r.top })
    })
  }, [sorted])

  return (
    <div className="pools-wrap">
      <div className="pools-band zone-item" style={{ '--i': 0 }}>
        <div className="band-cell"><span className="mini-label">LIVE POOLS</span><span className="mini-val">{loading ? '…' : pools.length}</span></div>
        <div className="band-cell"><span className="mini-label">TVL</span><span className="mini-val">{fmtSol(tvl)}&nbsp;<Sol size={12} /></span></div>
        <div className="band-cell"><span className="mini-label">≈ USD</span><span className="mini-val">{price ? fmtUsd(tvl * price) : '—'}</span></div>
        <div className="band-cell"><span className="mini-label">PROTOCOL FEE</span><span className="mini-val good">0.00%</span></div>
      </div>

      {loading && <div className="pools-loading">scanning the program…</div>}

      {!loading && pools.length === 0 && (
        <div className="pools-empty zone-item" style={{ '--i': 1 }}>
          <div className="pe-inf">∞</div>
          <div className="pe-title">NO POOLS YET</div>
          <div className="pe-sub">Be the first — launch a token with zero SOL and permanent liquidity.</div>
          <button className="ghost-btn" style={{ maxWidth: 220 }} onClick={() => go('launch')}>LAUNCH A TOKEN</button>
        </div>
      )}

      {!loading && pools.length > 0 && (
        <>
          <div className="pools-toolbar zone-item" style={{ '--i': 1 }}>
            <div className="pools-sorts">
              {SORTS.map((s) => (
                <button key={s.key} className={!live && sort === s.key ? 'on' : ''} disabled={live} onClick={() => setSort(s.key)}>{s.label}</button>
              ))}
            </div>
            <button className={`live-toggle ${live ? 'on' : ''}`} onClick={() => setLive((v) => !v)} title="Reorder by live activity">
              <span className="lt-dot" /> LIVE
            </button>
          </div>
          <div className="pools-grid">
            {sorted.map((p) => (
              <LiveCard key={p.address.toBase58()} pool={p} go={go} price={price}
                meta={metaMap[p.mint.toBase58()]} mcap={mcapOf(p)} flashing={flashSet.has(p.mint.toBase58())} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
