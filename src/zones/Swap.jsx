import { useEffect, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { useInfinityActions, usePools } from '../chain/useInfinity.js'
import { useSolPrice } from '../chain/useSolPrice.js'
import { deriveMeta, solOf } from '../chain/display.js'
import { fmtUsd } from '../data.js'
import { EXPLORER } from '../chain/config.js'
import { CURATED, resolveToken, isSol } from '../chain/tokens.js'
import { jupQuote, jupSwapTx, SOL_MINT } from '../chain/jupiter.js'
import { useTokenMeta } from '../chain/useTokenMeta.js'
import Sol from '../components/SolLogo.jsx'

const SOL = CURATED[0]
const SLIPPAGE_BPS = 50

function Avatar({ token, size = 28 }) {
  const [broken, setBroken] = useState(false)
  const s = { width: size, height: size }
  const src = token.logo || token.image
  if (isSol(token.mint)) {
    return <span className="tok-av sol-av" style={{ ...s, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Sol size={Math.round(size * 0.62)} /></span>
  }
  if (src && !broken) return <img className="tok-av" style={s} src={src} alt="" onError={() => setBroken(true)} />
  return (
    <span className="tok-av ph" style={{ ...s, background: token.color || deriveMeta(token.mint).color }}>
      {(token.symbol || '?')[0]}
    </span>
  )
}

// A picker row. Infinity pool tokens are placeholders (symbol from the CA),
// so resolve their real on-chain name/image; curated tokens use their logo.
function PickerRow({ t, onPick }) {
  const meta = useTokenMeta(t.infinity ? t.mint : null)
  const tok = t.infinity && meta
    ? { ...t, symbol: meta.symbol || t.symbol, name: (meta.name && meta.name !== 'Token') ? meta.name : 'Infinity pool', image: meta.image, color: meta.color || t.color }
    : t
  return (
    <li>
      <button onClick={() => onPick(t)}>
        <Avatar token={tok} size={24} />
        <span className="token-symbol">{tok.symbol}{t.infinity && <em className="inf-tag">∞</em>}</span>
        <span className="token-balance">{tok.name}</span>
      </button>
    </li>
  )
}

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function Picker({ tokens, connection, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [resolving, setResolving] = useState(false)
  const [err, setErr] = useState(null)
  const filtered = tokens.filter((t) =>
    !q || t.symbol?.toLowerCase().includes(q.toLowerCase()) || t.name?.toLowerCase().includes(q.toLowerCase()) || t.mint === q
  )
  const isMint = MINT_RE.test(q)
  const alreadyListed = tokens.some((t) => t.mint === q)
  const tryPaste = async () => {
    setErr(null)
    try {
      new PublicKey(q) // validate
      setResolving(true)
      const t = await resolveToken(connection, q)
      onPick(t)
    } catch {
      setErr('could not import — not a valid SPL / Token-2022 mint')
    } finally {
      setResolving(false)
    }
  }
  return (
    <ul className="token-menu glass swap-picker">
      <li className="picker-search">
        <input autoFocus placeholder="Search name or paste any token address (CA)…" value={q} onChange={(e) => setQ(e.target.value.trim())} />
      </li>
      {isMint && !alreadyListed && (
        <li className="picker-import">
          <button onClick={tryPaste} disabled={resolving}>
            <span className="imp-plus">{resolving ? '…' : '＋'}</span>
            <span className="imp-txt">
              <strong>{resolving ? 'Importing…' : 'Import custom token'}</strong>
              <em>{q.slice(0, 8)}…{q.slice(-6)}</em>
            </span>
          </button>
        </li>
      )}
      {filtered.map((t) => (
        <PickerRow key={t.mint} t={t} onPick={onPick} />
      ))}
      {filtered.length === 0 && !isMint && (
        <li className="picker-empty">No match — paste a token address (CA) to import any coin</li>
      )}
      {err && <li className="picker-err">{err}</li>}
    </ul>
  )
}

export default function Swap({ pool, go }) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const { buy, sell } = useInfinityActions()
  const { pools } = usePools()
  const price = useSolPrice()

  const poolTokens = useMemo(
    () => pools.map((p) => {
      const m = deriveMeta(p.mint.toBase58())
      return { mint: p.mint.toBase58(), symbol: m.symbol, name: `Infinity pool`, color: m.color, infinity: true }
    }),
    [pools]
  )
  const tokenList = useMemo(() => {
    const seen = new Set()
    return [...CURATED, ...poolTokens].filter((t) => (seen.has(t.mint) ? false : seen.add(t.mint)))
  }, [poolTokens])

  const [pay, setPay] = useState(SOL)
  const [receive, setReceive] = useState(null)
  const [amount, setAmount] = useState('')
  const [picker, setPicker] = useState(null) // 'pay' | 'receive'
  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [payBalance, setPayBalance] = useState(null)

  // preselect the token from a clicked pool
  useEffect(() => {
    if (pool?.live) {
      resolveToken(connection, pool.live.mint.toBase58()).then(setReceive).catch(() => {})
    }
  }, [pool, connection])

  // balance of the token being paid (refreshes after a swap via `status`)
  useEffect(() => {
    let alive = true
    setPayBalance(null)
    if (!publicKey || !pay?.mint) return
    ;(async () => {
      try {
        if (isSol(pay.mint)) {
          const lamports = await connection.getBalance(publicKey)
          if (alive) setPayBalance(lamports / 1e9)
        } else {
          const tp = pay.tokenProgram || TOKEN_PROGRAM_ID
          const ata = getAssociatedTokenAddressSync(new PublicKey(pay.mint), publicKey, false, tp)
          const acc = await getAccount(connection, ata, undefined, tp)
          if (alive) setPayBalance(Number(acc.amount) / 10 ** (pay.decimals ?? 0))
        }
      } catch { if (alive) setPayBalance(0) }
    })()
    return () => { alive = false }
  }, [publicKey, pay, connection, status])

  const setPct = (frac) => {
    if (payBalance == null) return
    let amt = payBalance * frac
    // leave a little SOL for the network fee + any ATA rent on a MAX
    if (isSol(pay.mint) && frac === 1) amt = Math.max(0, payBalance - 0.012)
    const dec = Math.min(pay.decimals ?? 9, 9)
    setAmount(amt > 0 ? (amt.toFixed(dec).replace(/\.?0+$/, '') || '0') : '0')
  }
  const fmtBal = (v) =>
    v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(2)}k` : v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 4 : 2 })

  const pickToken = async (side, t) => {
    setPicker(null); setStatus(null)
    const full = t.decimals != null ? t : await resolveToken(connection, t.mint).catch(() => t)
    if (side === 'pay') setPay(full)
    else setReceive(full)
  }
  const flip = () => { const p = pay; setPay(receive || SOL); setReceive(p); setAmount('') }

  // which Infinity pool (if any) serves this pair: must be SOL <-> pool token
  const infinityPool = useMemo(() => {
    if (!receive) return null
    const solSide = isSol(pay.mint) || isSol(receive.mint)
    if (!solSide) return null
    const other = isSol(pay.mint) ? receive.mint : pay.mint
    return pools.find((p) => p.mint.toBase58() === other) || null
  }, [pay, receive, pools])

  // compute a quote whenever inputs change
  useEffect(() => {
    let alive = true
    const a = parseFloat(amount)
    if (!receive || !a || a <= 0 || pay.decimals == null || receive.decimals == null) { setQuote(null); return }
    setQuoting(true)
    const run = async () => {
      try {
        if (infinityPool) {
          const p = infinityPool
          const feePct = p.feeBps / 10_000
          const y = Number(p.virtualSol + p.realSol)
          const x = Number(p.tokenReserve)
          if (isSol(pay.mint)) {
            const net = a * 1e9 * (1 - feePct)
            const outRaw = (x * net) / (y + net)
            return { out: outRaw / 10 ** receive.decimals, route: 'infinity', side: 'buy', ok: true }
          }
          const tokIn = a * 10 ** pay.decimals
          const gross = (y * tokIn) / (x + tokIn)
          const ok = gross <= Number(p.realSol)
          return { out: (gross * (1 - feePct)) / 1e9, route: 'infinity', side: 'sell', ok }
        }
        const amountRaw = Math.floor(a * 10 ** pay.decimals)
        const jq = await jupQuote({ inputMint: pay.mint, outputMint: receive.mint, amountRaw, slippageBps: SLIPPAGE_BPS })
        return { out: Number(jq.outAmount) / 10 ** receive.decimals, route: 'jupiter', jup: jq, ok: true, impact: Number(jq.priceImpactPct || 0) * 100 }
      } catch (e) {
        return { error: String(e.message || e), ok: false }
      }
    }
    run().then((r) => { if (alive) { setQuote(r); setQuoting(false) } })
    return () => { alive = false }
  }, [amount, pay, receive, infinityPool])

  const submit = async () => {
    if (!publicKey) { setStatus({ err: 'connect a wallet' }); return }
    if (!quote || !quote.ok) return
    setBusy(true); setStatus(null)
    try {
      const a = parseFloat(amount)
      let sig
      if (quote.route === 'infinity') {
        const tokenMint = new PublicKey(infinityPool.mint)
        const tp = receive.tokenProgram || pay.tokenProgram
        if (quote.side === 'buy') {
          const minOut = BigInt(Math.floor(quote.out * 10 ** receive.decimals * 0.97))
          sig = await buy({ mint: tokenMint, solIn: a, minTokensOut: minOut, tokenProgram: tp })
        } else {
          const minSol = Math.floor(quote.out * 1e9 * 0.97)
          sig = await sell({ mint: tokenMint, tokensIn: BigInt(Math.floor(a * 10 ** pay.decimals)), minSolOut: minSol, tokenProgram: tp })
        }
      } else {
        const tx = await jupSwapTx({ quote: quote.jup, userPublicKey: publicKey.toBase58() })
        sig = await sendTransaction(tx, connection)
        const bh = await connection.getLatestBlockhash()
        await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed')
      }
      setStatus({ sig }); setAmount(''); setQuote(null)
    } catch (e) {
      setStatus({ err: String(e.message || e).slice(0, 140) })
    } finally {
      setBusy(false)
    }
  }

  const canSwap = quote && quote.ok && !busy && receive
  const outStr = quote?.out != null ? quote.out.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'

  return (
    <div className="uswap">
      <section className="panel swap-panel glass zone-item" style={{ '--i': 0 }}>
        <div className="uswap-head">
          <span className="lps-header" style={{ margin: 0 }}>SWAP</span>
          {quote?.route && <span className={`route-tag ${quote.route}`}>{quote.route === 'infinity' ? 'via Infinity · 0% fee' : 'via Jupiter'}</span>}
        </div>

        {/* PAY */}
        <div className="swap-side">
          <div className="swap-side-top">
            <span>YOU PAY</span>
            {publicKey && payBalance != null && (
              <div className="swap-bal">
                <button className="bal-amt" onClick={() => setPct(1)} title="Use max">bal {fmtBal(payBalance)}</button>
                <button onClick={() => setPct(0.25)}>25%</button>
                <button onClick={() => setPct(0.5)}>50%</button>
                <button onClick={() => setPct(1)}>MAX</button>
              </div>
            )}
          </div>
          <div className="swap-side-row">
            <input className="amount-input" inputMode="decimal" placeholder="0.00" value={amount}
              onChange={(e) => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setAmount(v) }} />
            <button className="tok-select" onClick={() => setPicker(picker === 'pay' ? null : 'pay')}>
              <Avatar token={pay} /><span>{pay.symbol}</span><span className="chevron">⌄</span>
            </button>
          </div>
          {picker === 'pay' && <Picker tokens={tokenList} connection={connection} onClose={() => setPicker(null)} onPick={(t) => pickToken('pay', t)} />}
        </div>

        <button className="flip-btn" onClick={flip} title="Flip">⇅</button>

        {/* RECEIVE */}
        <div className="swap-side">
          <div className="swap-side-top"><span>YOU RECEIVE</span></div>
          <div className="swap-side-row">
            <div className="amount-out">{quoting ? '…' : outStr}</div>
            <button className="tok-select" onClick={() => setPicker(picker === 'receive' ? null : 'receive')}>
              {receive ? <><Avatar token={receive} /><span>{receive.symbol}</span></> : <span className="pick-cta">Select</span>}
              <span className="chevron">⌄</span>
            </button>
          </div>
          {picker === 'receive' && <Picker tokens={tokenList} connection={connection} onClose={() => setPicker(null)} onPick={(t) => pickToken('receive', t)} />}
        </div>

        <div className="quote-box">
          <div className="kv"><span>ROUTE</span><strong>{quote?.route === 'infinity' ? 'Infinity pool' : quote?.route === 'jupiter' ? 'Jupiter' : '—'}</strong></div>
          {quote?.route === 'jupiter' && <div className="kv"><span>PRICE IMPACT</span><strong className={quote.impact > 5 ? 'warn' : ''}>{quote.impact != null ? `${quote.impact.toFixed(2)}%` : '—'}</strong></div>}
          {quote?.route === 'infinity' && <div className="kv"><span>PROTOCOL FEE</span><strong className="good">0.00%</strong></div>}
          <div className="kv"><span>SLIPPAGE</span><strong>{SLIPPAGE_BPS / 100}%</strong></div>
        </div>

        {quote && quote.route === 'infinity' && quote.side === 'sell' && !quote.ok && (
          <div className="floor-warn">VIRTUAL FLOOR — this sell exceeds the pool's real SOL. Reduce the amount.</div>
        )}
        {quote && quote.error && <div className="tx-err">{quote.error}</div>}

        <button className="ignite-btn" disabled={!canSwap} onClick={submit}>
          {busy ? 'SWAPPING…' : !publicKey ? 'CONNECT WALLET' : !receive ? 'SELECT A TOKEN' : `SWAP ${pay.symbol} → ${receive.symbol}`}
        </button>

        {status?.sig && <a className="tx-ok" href={EXPLORER(status.sig)} target="_blank" rel="noreferrer">✓ confirmed — view tx</a>}
        {status?.err && <div className="tx-err">{status.err}</div>}
        <div className="ca-note">Infinity pools when available (0% fee) · everything else routed through Jupiter</div>
      </section>
    </div>
  )
}
