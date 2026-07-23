import InfinityGlyph from './InfinityGlyph.jsx'

// Stroke icons drawn on a 24×24 grid — neon-outline style to match the chrome.
const I = {
  launch: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2.2-.7-3 .8z" />
      <path d="M12 15l-3-3c.5-1.3 1.2-2.6 2-3.7C14 4.5 17.5 3 21 3c0 3.5-1.5 7-5.3 10-1.1.8-2.4 1.5-3.7 2z" />
      <path d="M9 12H4.5L7 8.6C7.8 8.2 8.8 8 9.7 8.2" />
      <path d="M12 15v4.5l3.4-2.5c.4-.8.6-1.8.4-2.7" />
    </svg>
  ),
  pools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.7S6 9.2 6 13.5a6 6 0 0 0 12 0C18 9.2 12 2.7 12 2.7z" />
      <path d="M9.5 14.5a2.6 2.6 0 0 0 2.4 2.6" />
    </svg>
  ),
  swap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h13M14 3.5 17.5 7 14 10.5" />
      <path d="M20 17H7M10 13.5 6.5 17l3.5 3.5" />
    </svg>
  ),
  claim: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M15.2 9.8c-.6-1-1.8-1.6-3.2-1.6-1.7 0-3 .9-3 2.2 0 2.9 6 1.5 6 4.2 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3.2-1.6" />
    </svg>
  ),
  docs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17.5a2.5 2.5 0 0 1-2.5 2.5H7.5A2.5 2.5 0 0 1 5 19.5v-15z" />
      <path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H19" />
      <path d="M9 6.5h6M9 10h6" />
    </svg>
  ),
}

const TABS = [
  { id: 'home', label: 'HOME', glyph: true },
  { id: 'launch', label: 'LAUNCH' },
  { id: 'pools', label: 'POOLS' },
  { id: 'swap', label: 'SWAP' },
  { id: 'claim', label: 'CLAIM' },
  { id: 'docs', label: 'DOCS' },
]

export default function MobileNav({ zone, go }) {
  return (
    <nav className="mobile-nav" aria-label="Primary">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={zone === t.id ? 'on' : ''}
          onClick={() => go(t.id)}
        >
          <span className="mn-icon">
            {t.glyph ? <InfinityGlyph size={19} strokeWidth={3.2} /> : I[t.id]}
          </span>
          <span className="mn-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
