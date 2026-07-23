import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import {
  getAccount, getMint, getTokenMetadata, getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import InfinityGlyph from '../components/InfinityGlyph.jsx'
import Sol from '../components/SolLogo.jsx'
import { TIERS, fmtUsd } from '../data.js'
import { useSolPrice } from '../chain/useSolPrice.js'
import { buildLaunchTx, uploadTokenMetadata } from '../chain/launch.js'
import { ixCreatePool, poolPda } from '../chain/infinity.js'
import { metadataPda, decodeMetadata } from '../chain/metadata.js'
import { EXPLORER, EXPLORER_ADDR } from '../chain/config.js'

// turn raw errors into something a human understands
function friendlyError(e) {
  const s = String(e?.message || e)
  if (/TokenAccountNotFound|could not find account/i.test(s)) return "You don't hold this token — you must hold the amount you want to deposit."
  if (/FreezeAuthorityPresent|0x1775/.test(s)) return 'This token has a freeze authority — Infinity only lists freeze-less tokens.'
  if (/UnsupportedMintExtension|0x1779/.test(s)) return 'This token uses a Token-2022 extension (transfer fee / hook / freeze) that Infinity does not support.'
  if (/already in use|0x0\b/i.test(s)) return 'A pool already exists for this token.'
  if (/insufficient|0x1|debit an account/i.test(s)) return 'Not enough SOL in your wallet for the network fee + rent.'
  if (/User rejected|rejected the request/i.test(s)) return 'You rejected the transaction in your wallet.'
  if (/WALLET_TIMEOUT/.test(s)) return "Your wallet didn't respond. If you opened this site inside an app (Telegram, X, Instagram…), open infinitydex.pro in Safari/Chrome or your Phantom/Solflare wallet browser — wallets can't sign inside in-app browsers."
  if (/blockhash|expired|timed out/i.test(s)) return 'Network was congested and the transaction expired. Try again.'
  return s.slice(0, 160)
}

export default function Launch({ go }) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const [mode, setMode] = useState('new')
  const [name, setName] = useState('')
  const [ticker, setTicker] = useState('')
  const [description, setDescription] = useState('')
  const [website, setWebsite] = useState('')
  const [twitter, setTwitter] = useState('')
  const [telegram, setTelegram] = useState('')
  const [image, setImage] = useState(null) // dataURL
  const fileRef = useRef(null)
  const [mintStr, setMintStr] = useState('')
  const [tier, setTier] = useState(1)
  const [feeBps, setFeeBps] = useState(100)
  const [creatorShare, setCreatorShare] = useState(50)
  const [airdropShare, setAirdropShare] = useState(0)
  const [devBuy, setDevBuy] = useState('')
  const [sniperGuard, setSniperGuard] = useState(true)
  const [busy, setBusy] = useState(false)
  const [launched, setLaunched] = useState(null)
  const [error, setError] = useState(null)
  const solPrice = useSolPrice()

  const openingMcapUsd = TIERS[tier].sol * (solPrice || 0)

  // existing-token preview: resolve the mint, its metadata, and your balance
  const [existing, setExisting] = useState(null) // {name,symbol,image,decimals,balance,tokenProgram,exists,poolExists}
  const [existingErr, setExistingErr] = useState(null)
  useEffect(() => {
    if (mode !== 'existing') return
    const s = mintStr.trim()
    setExisting(null); setExistingErr(null)
    if (!s) return
    let mint
    try { mint = new PublicKey(s) } catch { setExistingErr('Not a valid Solana address'); return }
    let alive = true
    ;(async () => {
      try {
        const acc = await connection.getAccountInfo(mint)
        if (!acc) { if (alive) setExistingErr('No token found at this address'); return }
        const tokenProgram = acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
        const mi = await getMint(connection, mint, undefined, tokenProgram)
        const poolExists = !!(await connection.getAccountInfo(poolPda(mint)))
        // metadata: Token-2022 stores it inside the mint (TokenMetadata
        // extension); classic SPL uses a separate Metaplex account.
        let name = '', symbol = '', image = '', uri = ''
        try {
          if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
            const tm = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
            if (tm) { name = tm.name; symbol = tm.symbol; uri = tm.uri }
          } else {
            const md = await connection.getAccountInfo(metadataPda(mint))
            if (md) { const d = decodeMetadata(md.data); name = d.name; symbol = d.symbol; uri = d.uri }
          }
          if (uri) {
            const j = await fetch(uri).then((r) => r.json()).catch(() => null)
            if (j?.image) image = j.image
          }
        } catch { /* no metadata — fine */ }
        // your balance
        let balance = 0n
        if (publicKey) {
          try {
            const ata = getAssociatedTokenAddressSync(mint, publicKey, false, tokenProgram)
            balance = (await getAccount(connection, ata, undefined, tokenProgram)).amount
          } catch { balance = 0n }
        }
        if (alive) setExisting({ name, symbol, image, decimals: mi.decimals, balance, tokenProgram, poolExists })
      } catch (e) {
        if (alive) setExistingErr('Could not read this token')
      }
    })()
    return () => { alive = false }
  }, [mintStr, mode, connection, publicKey])

  const onPickImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2_000_000) { setError('image too large (max 2MB)'); return }
    const reader = new FileReader()
    reader.onload = () => setImage(reader.result)
    reader.readAsDataURL(file)
  }

  // wallets in in-app browsers can hang forever on sign; cap the wait so the
  // button unsticks and shows guidance instead of spinning on "IGNITING".
  const signAndSend = (tx, opts) => Promise.race([
    sendTransaction(tx, connection, opts),
    new Promise((_, rej) => setTimeout(() => rej(new Error('WALLET_TIMEOUT')), 90_000)),
  ])

  const ignite = async () => {
    if (busy || launched) return
    if (!publicKey) { setError('connect a wallet first'); return }
    setBusy(true); setError(null)
    try {
      if (mode === 'new') {
        const sym = ticker || 'INF'
        const nm = name.trim() || ticker || 'Infinity Token'
        // host image + metadata JSON, get the on-chain uri
        let uri = ''
        try {
          const meta = await uploadTokenMetadata({ name: nm, symbol: sym, description, image, website, twitter, telegram })
          uri = meta.uri || ''
        } catch { /* non-fatal: launch still works without a uri */ }
        const { tx, signers, mint, pool, blockhash, lastValidBlockHeight } = await buildLaunchTx({
          connection, creator: publicKey, tier,
          feeBps, creatorShareBps: creatorShare * 100, sniperGuard,
          airdropShareBps: airdropShare * 100,
          devBuySol: parseFloat(devBuy) || 0,
          name: nm, symbol: sym, uri,
        })
        const sig = await signAndSend(tx, { signers })
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
        setLaunched({ mint: mint.toBase58(), pool: pool.toBase58(), sig })
        go?.('token', { mint: mint.toBase58() })
      } else {
        let mint
        try { mint = new PublicKey(mintStr) } catch { throw new Error('Invalid mint address') }
        if (!existing) throw new Error('Enter a valid token address first')
        if (existing.poolExists) throw new Error('A pool already exists for this token')
        if (existing.balance === 0n) throw new Error(`You hold 0 ${existing.symbol || 'of this token'}. To list it, you must hold the amount you want to deposit as liquidity.`)
        const ix = ixCreatePool({ creator: publicKey, mint, tokenAmount: existing.balance, tier, feeBps, creatorShareBps: creatorShare * 100, sniperGuard, airdropShareBps: airdropShare * 100, tokenProgram: existing.tokenProgram })
        const { Transaction, ComputeBudgetProgram } = await import('@solana/web3.js')
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
          ix
        )
        tx.feePayer = publicKey
        tx.recentBlockhash = blockhash
        const sig = await signAndSend(tx)
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
        setLaunched({ mint: mint.toBase58(), pool: poolPda(mint).toBase58(), sig })
        go?.('token', { mint: mintStr })
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const short = (s) => `${s.slice(0, 6)}…${s.slice(-4)}`

  // live preview reflects the active mode's inputs
  const pvImage = mode === 'new' ? image : existing?.image
  const pvName = mode === 'new' ? (name || 'Your Token') : (existing?.name || 'Your Token')
  const pvSym = mode === 'new' ? (ticker || 'TICKER') : (existing?.symbol || 'TICKER')

  return (
    <>
      <section className="panel launch-panel glass zone-item" style={{ '--i': 0 }}>
        <h2 className="panel-title">
          LAUNCH <span className="accent">— DEPOSIT ONLY YOUR TOKEN</span>
        </h2>

        <div className="seg">
          <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>NEW TOKEN</button>
          <button className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>EXISTING TOKEN</button>
        </div>

        {mode === 'new' ? (
          <>
            <div className="form-grid">
              <button
                type="button"
                className="drop-circle"
                title="Token image (max 2MB)"
                onClick={() => fileRef.current?.click()}
                style={image ? { backgroundImage: `url(${image})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              >
                {!image && (<><InfinityGlyph size={22} strokeWidth={3} /><span>IMAGE</span></>)}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={onPickImage} />
              <div className="form-fields">
                <input className="field" placeholder="Token name" value={name} maxLength={28} onChange={(e) => setName(e.target.value)} />
                <input className="field" placeholder="$TICKER" value={ticker} maxLength={10} onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
              </div>
            </div>
            <textarea
              className="field field-ta"
              placeholder="Description (optional)"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="link-row">
              <input className="field" placeholder="Website" value={website} onChange={(e) => setWebsite(e.target.value)} />
              <input className="field" placeholder="X / Twitter" value={twitter} onChange={(e) => setTwitter(e.target.value)} />
              <input className="field" placeholder="Telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <input className="field" placeholder="Paste mint address (any SPL token you hold)" value={mintStr} onChange={(e) => setMintStr(e.target.value.trim())} />
            {existingErr && <div className="token-hint err">{existingErr}</div>}
            {existing && (
              <div className="token-found">
                {existing.image
                  ? <img className="tf-img" src={existing.image} alt="" />
                  : <span className="tf-img tf-ph">{(existing.symbol || '?')[0]}</span>}
                <div className="tf-meta">
                  <div className="tf-name">{existing.name || 'Unknown token'} <em>{existing.symbol ? `$${existing.symbol}` : ''}</em></div>
                  <div className="tf-bal">
                    you hold {(Number(existing.balance) / 10 ** existing.decimals).toLocaleString(undefined, { maximumFractionDigits: 2 })} {existing.symbol}
                  </div>
                </div>
                {existing.poolExists
                  ? <span className="tf-tag warn">pool exists</span>
                  : existing.balance === 0n
                    ? <span className="tf-tag warn">no balance</span>
                    : <span className="tf-tag ok">listable</span>}
              </div>
            )}
            {existing && existing.balance > 0n && !existing.poolExists && (
              <div className="token-hint">Deposits your full balance as permanent liquidity.</div>
            )}
          </>
        )}

        <div className="tier-label">OPENING MARKET CAP</div>
        <div className="tier-row">
          {TIERS.map((t, i) => (
            <button key={t.label} className={`tier-card ${i === tier ? 'on' : ''}`} onClick={() => setTier(i)}>
              <span className="tier-mcap">{solPrice ? fmtUsd(t.sol * solPrice) : '—'}</span>
              <span className="tier-name">{t.label}</span>
              <span className="tier-sub">{t.sol}&nbsp;<Sol size={10} /></span>
            </button>
          ))}
        </div>

        <div className="slider-row">
          <span className="slider-label">SWAP FEE</span>
          <input type="range" min="0" max="1000" step="25" value={feeBps} onChange={(e) => setFeeBps(+e.target.value)} />
          <span className="slider-val">{(feeBps / 100).toFixed(2)}%</span>
        </div>
        <div className="tier-label" style={{ marginTop: 4 }}>FEE SPLIT, WHERE EVERY FEE GOES</div>
        <div className="slider-row">
          <span className="slider-label">CREATOR FEE</span>
          <input type="range" min="0" max="100" step="5" value={creatorShare}
            onChange={(e) => { const v = +e.target.value; setCreatorShare(v); if (v + airdropShare > 100) setAirdropShare(100 - v) }} />
          <span className="slider-val">{creatorShare}%</span>
        </div>
        {/* the non-creator remainder splits between airdrop (left) and burn (right) */}
        <div className="split-slider">
          <div className="ss-end">
            <span className="ss-label">HOLDERS AIRDROP</span>
            <span className="ss-val airdrop">{airdropShare}%</span>
          </div>
          <input type="range" min="0" max={100 - creatorShare} step="5"
            value={100 - creatorShare - airdropShare}
            onChange={(e) => setAirdropShare(Math.max(0, (100 - creatorShare) - +e.target.value))} />
          <div className="ss-end right">
            <span className="ss-label">BUYBACK &amp; BURN</span>
            <span className="ss-val burn">{100 - creatorShare - airdropShare}%</span>
          </div>
        </div>
        <div className="split-bar" aria-hidden="true">
          <i className="sb-creator" style={{ width: `${creatorShare}%` }} />
          <i className="sb-airdrop" style={{ width: `${airdropShare}%` }} />
          <i className="sb-burn" style={{ width: `${100 - creatorShare - airdropShare}%` }} />
        </div>
        <div className="split-legend">
          <span><i className="sb-creator" /> creator {creatorShare}%</span>
          <span><i className="sb-airdrop" /> airdrop {airdropShare}%</span>
          <span><i className="sb-burn" /> buyback &amp; burn {100 - creatorShare - airdropShare}%</span>
        </div>

        {mode === 'new' && (
          <div className="devbuy">
            <div className="slider-row">
              <span className="slider-label">DEV BUY <em>optional</em></span>
              <input className="devbuy-input" inputMode="decimal" placeholder="0.0"
                value={devBuy} onChange={(e) => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setDevBuy(v) }} />
              <span className="slider-val"><Sol size={11} />&nbsp;SOL</span>
            </div>
            <div className="devbuy-note">
              buy your own token first, in the same launch transaction, before anyone else.
              {sniperGuard && parseFloat(devBuy) > 0 && <strong> anti-sniper is on, so this first buy pays the opening tax to holders.</strong>}
            </div>
          </div>
        )}

        <button
          type="button"
          className={`sniper-toggle ${sniperGuard ? 'on' : ''}`}
          onClick={() => setSniperGuard((v) => !v)}
        >
          <span className="st-switch"><span className="st-knob" /></span>
          <span className="st-text">
            ANTI-SNIPER GUARD
            <small>{sniperGuard ? '50%→0% buy tax first ~6s · 100% to holders' : 'off — launch is fully open at block 0'}</small>
          </span>
        </button>

        <button className={`ignite-btn ${busy ? 'busy' : ''}`} onClick={ignite} disabled={busy || (mode === 'existing' && !mintStr)}>
          {busy ? 'IGNITING ∞ …' : launched ? 'LIVE ∞' : !publicKey ? 'CONNECT TO IGNITE' : 'IGNITE'}
        </button>
        {error && <div className="tx-err">{error}</div>}
      </section>

      <section className="panel launch-preview glass zone-item" style={{ '--i': 1 }}>
        <div className="lps-header">{launched ? 'LAUNCHED ∞' : 'PREVIEW'}</div>
        <div className="preview-identity">
          {pvImage
            ? <img className="preview-avatar preview-img" src={pvImage} alt="" />
            : <span className="preview-avatar">{pvSym[0] || '∞'}</span>}
          <div>
            <div className="preview-name">{pvName}</div>
            <div className="preview-ticker">${pvSym}</div>
          </div>
        </div>
        {mode === 'new' && description && <p className="preview-desc">{description}</p>}
        {mode === 'new' && (website || twitter || telegram) && (
          <div className="preview-links">
            {website && <span>🌐</span>}{twitter && <span>𝕏</span>}{telegram && <span>✈</span>}
            <em>{[website && 'web', twitter && 'x', telegram && 'tg'].filter(Boolean).join(' · ')}</em>
          </div>
        )}
        <div className="stat-divider" />
        <div className="kv">
          <span>OPENING MCAP</span>
          <strong>{solPrice ? `≈ ${fmtUsd(openingMcapUsd)}` : '…'} <span className="kv-sub">({TIERS[tier].sol}&nbsp;<Sol size={9} />)</span></strong>
        </div>
        <div className="kv"><span>YOUR SOL COST</span><strong className="good">0&nbsp;<Sol size={9} /> liquidity</strong></div>
        <div className="kv"><span>PROTOCOL FEE</span><strong className="good">0.00%</strong></div>
        <div className="kv"><span>CREATOR EARNS</span><strong>{((feeBps / 100) * (creatorShare / 100)).toFixed(2)}% / trade</strong></div>
        <div className="kv"><span>HOLDERS AIRDROP</span><strong>{((feeBps / 100) * (airdropShare / 100)).toFixed(2)}% / trade</strong></div>
        <div className="kv"><span>HOLDERS BURN</span><strong>{((feeBps / 100) * ((100 - creatorShare - airdropShare) / 100)).toFixed(2)}% / trade</strong></div>
        <div className="kv"><span>LIQUIDITY</span><strong>PERMANENT — UNRUGGABLE</strong></div>

        {launched && (
          <>
            <div className="stat-divider" />
            <a className="ca-box" href={EXPLORER_ADDR(launched.mint)} target="_blank" rel="noreferrer">
              <span>MINT</span>
              <code>{short(launched.mint)}</code>
            </a>
            <a className="ca-box" href={EXPLORER_ADDR(launched.pool)} target="_blank" rel="noreferrer">
              <span>POOL</span>
              <code>{short(launched.pool)}</code>
            </a>
            <a className="tx-ok" href={EXPLORER(launched.sig)} target="_blank" rel="noreferrer">✓ live on mainnet · view tx</a>
          </>
        )}
        {!launched && <div className="ca-note">mint + supply + frozen authority + pool — one signature</div>}
      </section>
    </>
  )
}
