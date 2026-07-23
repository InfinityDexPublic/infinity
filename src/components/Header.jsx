import InfinityGlyph from './InfinityGlyph.jsx'
import ConnectButton from './ConnectButton.jsx'

const NAV = [
  { id: 'launch', label: 'LAUNCH' },
  { id: 'pools', label: 'POOLS' },
  { id: 'swap', label: 'SWAP' },
  { id: 'claim', label: 'CLAIM' },
  { id: 'docs', label: 'DOCS' },
]

export default function Header({ zone, go }) {
  return (
    <header className="header">
      <div />
      <button className="wordmark" onClick={() => go('home')} title="Home">
        <span>INF</span>
        <InfinityGlyph size={26} strokeWidth={3.2} className="wordmark-glyph" />
        <span>ITY</span>
      </button>
      <nav className="header-right">
        {NAV.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`nav-link ${zone === item.id ? 'active' : ''}`}
            onClick={(e) => {
              e.preventDefault()
              go(item.id)
            }}
          >
            {item.label}
          </a>
        ))}
        <a
          className="x-link"
          href="https://github.com/InfinityDexPublic/infinity"
          target="_blank"
          rel="noreferrer"
          aria-label="Infinity on GitHub"
          title="GitHub — open source"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.4 1.24-3.24-.12-.31-.54-1.53.12-3.19 0 0 1.01-.32 3.3 1.24a11.5 11.5 0 0 1 6 0c2.29-1.56 3.3-1.24 3.3-1.24.66 1.66.24 2.88.12 3.19.77.84 1.24 1.92 1.24 3.24 0 4.63-2.81 5.65-5.49 5.95.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
          </svg>
        </a>
        <a
          className="x-link"
          href="https://x.com/infinitydex_pro"
          target="_blank"
          rel="noreferrer"
          aria-label="Infinity on X"
          title="@infinitydex_pro"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <a
          className="x-link"
          href="https://t.me/infinitydexpro"
          target="_blank"
          rel="noreferrer"
          aria-label="Infinity on Telegram"
          title="Telegram"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M21.94 4.66a1.3 1.3 0 0 0-1.35-.2L3.36 11.1c-.86.34-.83 1.58.04 1.88l4.3 1.45 1.64 5.03c.22.66 1.05.86 1.55.38l2.38-2.28 4.32 3.18c.55.4 1.34.11 1.49-.56l3.28-14.6a1.3 1.3 0 0 0-.42-1.3zM9.9 14.2l8.2-5.05c.15-.09.3.12.18.24l-6.66 6.2a.9.9 0 0 0-.28.53l-.24 1.77c-.03.2-.31.23-.38.04l-.9-2.75a.9.9 0 0 1 .3-1z" />
          </svg>
        </a>
        <ConnectButton />
      </nav>
    </header>
  )
}
