import InfinityGlyph from '../components/InfinityGlyph.jsx'
import StatsPanel from '../components/StatsPanel.jsx'

export default function Home({ go }) {
  return (
    <>
      <section className="panel panel-left glass zone-item" style={{ '--i': 0 }}>
        <h2 className="panel-title">
          THE ZERO-FEE DEX <span className="accent">— ONE SIDE ONLY</span>
        </h2>
        <p className="home-copy">
          Launch or list any token by depositing <strong>only the token</strong>.
          No SOL pairing. Liquidity is permanent. The protocol takes
          <strong> 0.00%</strong> — every fee goes to the creator and the holders.
        </p>
        <button className="neon-btn" onClick={() => go('launch')} title="Launch a token">
          <svg className="neon-svg" viewBox="0 0 240 110" fill="none">
            <defs>
              <linearGradient id="neon-grad" x1="45" y1="20" x2="195" y2="90" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#7B2BFF" />
                <stop offset="0.5" stopColor="#c9b8ff" />
                <stop offset="1" stopColor="#00F0FF" />
              </linearGradient>
            </defs>
            <path className="neon-halo" d="M55 55 C55 24 105 24 120 55 C135 86 185 86 185 55 C185 24 135 24 120 55 C105 86 55 86 55 55 Z" stroke="url(#neon-grad)" strokeWidth="20" strokeLinecap="round" />
            <path className="neon-core" d="M55 55 C55 24 105 24 120 55 C135 86 185 86 185 55 C185 24 135 24 120 55 C105 86 55 86 55 55 Z" stroke="url(#neon-grad)" strokeWidth="13" strokeLinecap="round" />
            <path className="neon-hot" d="M55 55 C55 24 105 24 120 55 C135 86 185 86 185 55 C185 24 135 24 120 55 C105 86 55 86 55 55 Z" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" />
          </svg>
          <span className="neon-label">LAUNCH A TOKEN</span>
        </button>
        <button className="ghost-btn" onClick={() => go('launch')}>
          <InfinityGlyph size={14} strokeWidth={3.6} />
          LIST AN EXISTING TOKEN
        </button>
      </section>

      <StatsPanel className="zone-item" style={{ '--i': 1 }} />
    </>
  )
}
