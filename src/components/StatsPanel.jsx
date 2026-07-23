import Sol from './SolLogo.jsx'
import { usePools } from '../chain/useInfinity.js'
import { useSolPrice } from '../chain/useSolPrice.js'
import { solOf, fmtSol } from '../chain/display.js'
import { fmtUsd } from '../data.js'

export default function StatsPanel({ className = '', style }) {
  const { pools, loading } = usePools()
  const price = useSolPrice()
  const tvlSol = pools.reduce((s, p) => s + solOf(p.realSol), 0)
  const guarded = pools.filter((p) => p.sniperGuard === 1).length

  return (
    <section className={`panel panel-right glass ${className}`} style={style}>
      <div className="lps-header">PROTOCOL STATS</div>

      <div className="fee-row">
        <div className="fee-label">
          PROTOCOL
          <br />
          FEE
        </div>
        <div className="big-num">0.00%</div>
      </div>

      <div className="fees-tagline">
        100% OF FEES <span className="arrow">→</span> HOLDERS
      </div>

      <div className="stat-divider" />

      <div className="tvl-row">
        <span className="tvl-label">TVL</span>
        <span className="big-num mid">{fmtSol(tvlSol)}&nbsp;<Sol size={18} /></span>
      </div>
      <div className="kv">
        <span>≈ USD</span>
        <strong>{price ? fmtUsd(tvlSol * price) : '—'}</strong>
      </div>

      <div className="stat-divider" />

      <div className="two-col">
        <div className="col-cell">
          <span className="mini-label">LIVE POOLS</span>
          <span className="mini-val">{loading ? '…' : pools.length}</span>
        </div>
        <div className="col-cell">
          <span className="mini-label">SNIPER-GUARDED</span>
          <span className="mini-val">{loading ? '…' : guarded}</span>
        </div>
      </div>
    </section>
  )
}
