import { useState } from 'react'
import InfinityGlyph from '../components/InfinityGlyph.jsx'
import Sol from '../components/SolLogo.jsx'
import { PROGRAM_ID } from '../chain/config.js'
import { EXPLORER_ADDR } from '../chain/config.js'

const SECTIONS = [
  { id: 'what', label: 'Overview' },
  { id: 'how', label: 'How it works' },
  { id: 'fees', label: 'Fees & flywheel' },
  { id: 'sniper', label: 'Anti-sniper' },
  { id: 'launch', label: 'Launch a token' },
  { id: 'trade', label: 'Trading' },
  { id: 'security', label: 'Security' },
  { id: 'infinity', label: '$INFINITY' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'faq', label: 'FAQ' },
]

const INFINITY_CA = '3pz7Xrpsj18m8LJE9vBVxEPDLnSvkDxE2hUxk4SPpump'
const STREAMFLOW_LOCK = 'https://app.streamflow.finance/contract/solana/mainnet/AcZJo2q7TPY3a2hHrLx4Qv4Ug2HVpDemVcq3Dkha81HE'

function Card({ children, className = '' }) {
  return <div className={`doc-card glass ${className}`}>{children}</div>
}

const FAQS = [
  ['Do I need SOL to launch?', 'No. You deposit only your token. The SOL side of the pool is virtual, so a launch costs you nothing beyond the small network rent (~0.02 SOL). Buyers bring the real SOL.'],
  ['What does the protocol take?', 'Zero. The protocol fee is hardcoded to 0.00%. The program has no fee account. Every swap fee is split three ways, all of it to the creator and the holders: creator fee, buyback-and-burn, and holders airdrop.'],
  ['Can liquidity be rugged?', 'No. There are no LP tokens and no withdraw instruction. Deposited liquidity is permanent by construction. The creator is paid in a fee stream, not pool ownership.'],
  ['What is the virtual SOL floor?', 'The pool opens as if seeded with a chosen amount of SOL (10 / 35 / 100 / 500). That number sets the opening market cap and price depth, but it is non-sellable: you can never extract virtual SOL, only the real SOL that buyers put in.'],
  ['How do holders earn?', 'Two ways, chosen by the creator at launch. Burn share: fees auto-buy the token on its own curve and burn it, raising the price and the floor for everyone. Airdrop share: fees accrue in SOL and are paid out pro-rata straight to holders’ wallets. Nothing to claim; holding is the reward.'],
  ['Is it audited?', 'Yes. The program passed a multi-lens security audit (0 critical, 0 high) before going live, and its core guarantees (0% protocol fee, permanent liquidity, value conservation) are enforced on-chain and verified by fuzz testing.'],
]

export default function Docs() {
  const [open, setOpen] = useState(0)
  const [caCopied, setCaCopied] = useState(false)
  const scrollTo = (id) => document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const copyCa = () => {
    if (INFINITY_CA === 'TBA') return
    navigator.clipboard?.writeText(INFINITY_CA).catch(() => {})
    setCaCopied(true); setTimeout(() => setCaCopied(false), 1800)
  }

  return (
    <div className="docs-wrap">
      <aside className="docs-nav glass">
        <div className="dn-title"><InfinityGlyph size={16} strokeWidth={3.4} /> DOCS</div>
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => scrollTo(s.id)}>{s.label}</button>
        ))}
        <a className="dn-ext" href={EXPLORER_ADDR(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">Program ↗</a>
        <a className="dn-ext" href="https://x.com/infinitydex_pro" target="_blank" rel="noreferrer">X / Twitter ↗</a>
      </aside>

      <main className="docs-body">
        <header className="docs-hero">
          <div className="dh-glyph"><InfinityGlyph size={40} strokeWidth={3.2} /></div>
          <h1>INFINITY DOCS</h1>
          <p>The zero-fee, one-sided AMM &amp; launchpad on Solana. Launch or list any token with only the token: no pairing, permanent liquidity, and 100% of fees to the creator and holders.</p>
        </header>

        <section id="doc-what" className="doc-sec">
          <h2><span className="ds-num">01</span> Overview</h2>
          <Card>
            <p>Infinity is a decentralized exchange and launchpad where a market is created by depositing <strong>only your token</strong>. The counter-asset (SOL) starts <strong>virtual</strong>, so no one has to bring paired liquidity. Trading is live the instant a pool is created. There is no bonding-curve graduation, no migration, and no second venue.</p>
            <div className="doc-badges">
              <span className="db"><b>0.00%</b> protocol fee</span>
              <span className="db"><b>100%</b> to creator + holders</span>
              <span className="db"><b>0 <Sol size={11} /></b> to launch</span>
              <span className="db"><b>∞</b> permanent liquidity</span>
            </div>
          </Card>
        </section>

        <section id="doc-how" className="doc-sec">
          <h2><span className="ds-num">02</span> How it works</h2>
          <Card>
            <h3>One-sided pools + virtual SOL floor</h3>
            <p>A pool is a constant-product market over two reserves: your token and SOL. At creation the SOL side is a chosen <em>virtual</em> amount (the tier). Because the whole token supply is deposited, the opening market cap equals that virtual SOL amount.</p>
            <p>The one safety rule that makes this honest: <strong>a sell can only pay out real SOL that real buyers put in</strong>. You can never sell into the virtual floor, so the pool can never owe more than it holds.</p>
          </Card>
          <Card>
            <h3>Permanent, unruggable liquidity</h3>
            <p>There are <strong>no LP tokens and no withdraw instruction</strong>. Deposited liquidity is locked forever by design. The creator does not own the pool; they own a <strong>fee stream</strong>. This removes the entire rug surface that paired AMMs and other launchpads carry.</p>
          </Card>
        </section>

        <section id="doc-fees" className="doc-sec">
          <h2><span className="ds-num">03</span> Fees &amp; the flywheel</h2>
          <Card>
            <p>The protocol takes <strong>nothing</strong>. 0.00% is hardcoded, not a setting. Each swap charges a creator-chosen fee (0 to 10%, default 1%), split three ways at launch: <strong>creator fee</strong>, <strong>buyback &amp; burn</strong>, and <strong>holders airdrop</strong>.</p>
            <table className="doc-table">
              <thead><tr><th>Bucket</th><th>Who</th><th>How it's paid</th></tr></thead>
              <tbody>
                <tr><td>Protocol</td><td>None</td><td className="good">0.00%, always</td></tr>
                <tr><td>Creator</td><td>Token creator</td><td>Accrues in SOL, claim anytime</td></tr>
                <tr><td>Burn</td><td>Every holder</td><td>Buyback &amp; burn on the curve</td></tr>
                <tr><td>Airdrop</td><td>Every holder</td><td>SOL paid straight to holders' wallets</td></tr>
              </tbody>
            </table>
          </Card>
          <Card>
            <h3>The buyback-and-burn flywheel</h3>
            <p>The burn share accrues in SOL, then a permissionless <strong>crank</strong> spends it buying the token on its own curve (fee-exempt) and <strong>burns</strong> what it buys. Spot price and the floor both ratchet up on every trade. Fees can only be lowered, and the split can only shift <em>toward</em> holders, never the reverse.</p>
          </Card>
          <Card>
            <h3>Holders airdrop</h3>
            <p>If the creator allocates an airdrop share, that slice of every fee accrues in SOL inside the pool, and the keeper periodically pays it out <strong>pro-rata to the top holders, straight to their wallets</strong>. Nothing to stake, nothing to claim: hold the token, receive SOL. The program caps every payout at the accrued airdrop bucket, so the keeper can never touch pool liquidity, creator fees or the burn reserve.</p>
          </Card>
        </section>

        <section id="doc-sniper" className="doc-sec">
          <h2><span className="ds-num">04</span> Anti-sniper guard</h2>
          <Card>
            <p>Launches can opt into a decaying opening tax: <strong>50% → 0% over the first ~6 seconds</strong> (15 slots) on buys only. The tax goes <strong>100% to the flywheel</strong>, so snipers who front-run a launch end up paying the holders. It's chosen at launch and immutable, so a creator can't disable it mid-window to let their own bot in.</p>
          </Card>
        </section>

        <section id="doc-launch" className="doc-sec">
          <h2><span className="ds-num">05</span> Launch a token</h2>
          <Card>
            <ol className="doc-steps">
              <li>Connect a Solana wallet.</li>
              <li>Pick <strong>New token</strong> (we mint it) or <strong>Existing token</strong> (list one you hold).</li>
              <li>Add name, ticker, image, description and links.</li>
              <li>Choose the <strong>opening market cap</strong> tier and the fee / split.</li>
              <li>Hit IGNITE. Mint, metadata, full supply, frozen mint authority and the pool are created in a single transaction.</li>
            </ol>
            <p className="doc-note">Every token minted on Infinity gets a vanity address ending in <strong>“infi”</strong>, instantly recognisable as an Infinity launch, the way pump.fun mints end in “pump”.</p>
            <h3>Opening market-cap tiers</h3>
            <table className="doc-table">
              <thead><tr><th>Tier</th><th>Virtual SOL</th><th>Feel</th></tr></thead>
              <tbody>
                <tr><td>SPARK</td><td>10 <Sol size={10} /></td><td>micro / experiment</td></tr>
                <tr><td>ORBIT</td><td>35 <Sol size={10} /></td><td>the standard</td></tr>
                <tr><td>NOVA</td><td>100 <Sol size={10} /></td><td>community listing</td></tr>
                <tr><td>SUPERNOVA</td><td>500 <Sol size={10} /></td><td>large project</td></tr>
              </tbody>
            </table>
            <p className="doc-note">Higher tier = higher opening market cap and deeper price (more SOL needed to move it). It does not create real withdrawable liquidity; that always comes from buyers.</p>
          </Card>
        </section>

        <section id="doc-trade" className="doc-sec">
          <h2><span className="ds-num">06</span> Trading</h2>
          <Card>
            <p>Buy with SOL, sell for SOL, straight against the curve. Quotes show price impact and the exact fee split. Early sellers are bounded by the <strong>real SOL</strong> in the pool (the floor); the UI warns you when a sell would exceed it. There is no protocol cut on any trade.</p>
          </Card>
          <Card>
            <h3>Universal swap</h3>
            <p>The swap routes any token pair automatically: <strong>through Infinity pools when available</strong> (0% protocol fee), and through <strong>Jupiter</strong> for everything else. Paste any mint to import and trade it.</p>
          </Card>
          <Card>
            <h3>Every token has a page</h3>
            <p>Each pool opens a dedicated token page with a <strong>live USD price chart</strong> built from on-chain trades, the <strong>top holders</strong> (the Infinity pool shows as permanently locked), and a <strong>live feed</strong> of every buy, sell, burn and airdrop. Shareable at <code>/#token/&lt;mint&gt;</code>.</p>
          </Card>
        </section>

        <section id="doc-security" className="doc-sec">
          <h2><span className="ds-num">07</span> Security</h2>
          <Card>
            <ul className="doc-list">
              <li><strong>0% protocol fee is structural</strong>: the program has no fee account, so "we take nothing" is provable on-chain.</li>
              <li><strong>No withdraw / no LP tokens</strong>: liquidity is permanent; the rug surface is deleted.</li>
              <li><strong>Value conservation</strong>: sells can never pay out more SOL than the pool holds (verified by fuzz + audit).</li>
              <li><strong>Token-2022 extensions</strong> that could tax, hook, freeze or seize balances are rejected at pool creation.</li>
              <li>Internal multi-lens audit: <strong>0 critical / 0 high</strong>; 2 low findings fixed before mainnet.</li>
            </ul>
            <div className="doc-kv"><span>Program</span><a href={EXPLORER_ADDR(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer"><code>{PROGRAM_ID.toBase58()}</code></a></div>
          </Card>
        </section>

        <section id="doc-infinity" className="doc-sec">
          <h2><span className="ds-num">08</span> $INFINITY token</h2>
          <Card>
            <p><strong>$INFINITY</strong> is the protocol's own token, launched on <strong>Pump.Fun</strong>. Every creator fee it earns is used to <strong>buy back $INFINITY</strong>, so the protocol's growth feeds straight back into the token.</p>
            <div className="doc-ca">
              <span className="doc-ca-label">CONTRACT ADDRESS</span>
              <button className="doc-ca-box" onClick={copyCa} disabled={INFINITY_CA === 'TBA'}>
                <code>{INFINITY_CA}</code>
                <span>{INFINITY_CA === 'TBA' ? 'soon' : caCopied ? '✓ copied' : 'copy'}</span>
              </button>
            </div>
            <table className="doc-table">
              <thead><tr><th>Metric</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td>Total supply</td><td>1,000,000,000 (1B)</td></tr>
                <tr><td>Launch platform</td><td>Pump.Fun</td></tr>
                <tr><td>Locked</td><td>20% locked for 3 years on Streamflow</td></tr>
                <tr><td>Creator fees</td><td className="good">100% buy back $INFINITY</td></tr>
              </tbody>
            </table>
            <p className="doc-note"><strong>100% of creator fees buy back $INFINITY.</strong> And <strong>20%</strong> of the supply is <strong>locked for 3 years</strong> on <strong>Streamflow</strong>, publicly verifiable below.</p>
            <div className="doc-kv"><span>Streamflow lock</span><a href={STREAMFLOW_LOCK} target="_blank" rel="noreferrer">verify on Streamflow ↗</a></div>
          </Card>
        </section>

        <section id="doc-roadmap" className="doc-sec">
          <h2><span className="ds-num">09</span> Roadmap</h2>
          <Card>
            <div className="roadmap">
              <div className="rm-phase done">
                <div className="rm-head"><span className="rm-dot live" /> LIVE NOW</div>
                <ul>
                  <li>Zero-fee, one-sided AMM &amp; launchpad on Solana mainnet</li>
                  <li>Token pages: live candlestick charts, top holders, live trades</li>
                  <li>Universal swap (Infinity pools when available, Jupiter for the rest)</li>
                  <li>Holders airdrop &amp; buyback-and-burn flywheel</li>
                  <li>$INFINITY token</li>
                </ul>
              </div>
              <div className="rm-phase">
                <div className="rm-head"><span className="rm-dot next" /> NEXT</div>
                <ul>
                  <li>Phantom &amp; Solflare integration (verified dApp, no security warnings)</li>
                  <li>DexScreener integration</li>
                  <li>Jupiter listing &amp; routing integration</li>
                </ul>
              </div>
              <div className="rm-phase">
                <div className="rm-head"><span className="rm-dot" /> LISTINGS &amp; TERMINALS</div>
                <ul>
                  <li>Trading terminal integrations (Axiom, Photon, BullX, GMGN)</li>
                  <li>Birdeye data integration</li>
                  <li>CoinGecko &amp; CoinMarketCap listings</li>
                </ul>
              </div>
              <div className="rm-phase">
                <div className="rm-head"><span className="rm-dot" /> BEYOND</div>
                <ul>
                  <li>Mobile-first app / PWA</li>
                  <li>Creator analytics: fees, holders, airdrop &amp; burn history</li>
                  <li>Live buyback &amp; burn dashboard</li>
                  <li>Developer API &amp; SDK</li>
                </ul>
              </div>
            </div>
          </Card>
        </section>

        <section id="doc-faq" className="doc-sec">
          <h2><span className="ds-num">10</span> FAQ</h2>
          <div className="doc-faq">
            {FAQS.map(([q, a], i) => (
              <button key={i} className={`faq-item ${open === i ? 'open' : ''}`} onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="faq-q">{q}<span className="faq-plus">{open === i ? '−' : '+'}</span></span>
                {open === i && <span className="faq-a">{a}</span>}
              </button>
            ))}
          </div>
        </section>

        <footer className="docs-foot">
          <InfinityGlyph size={22} strokeWidth={3.4} />
          <span>INFINITY · great ideas live here.</span>
        </footer>
      </main>
    </div>
  )
}
