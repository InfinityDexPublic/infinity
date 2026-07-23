import { useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { fmtUsd } from '../data.js'
import { usePools, useInfinityActions } from '../chain/useInfinity.js'
import { useIndexer } from '../chain/useIndexer.js'
import { useSolPrice } from '../chain/useSolPrice.js'
import { useEffect } from 'react'
import Sol from '../components/SolLogo.jsx'
import TokenTag from '../components/TokenTag.jsx'
import { solOf } from '../chain/display.js'
import { usePoolMint, useTokenMeta } from '../chain/useTokenMeta.js'
import { ixClaimCreatorFees } from '../chain/infinity.js'
import { EXPLORER, HIDDEN_POOLS, INDEXER_API } from '../chain/config.js'

const fmtAmt = (v) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0)

// one creator pool: claimable now + lifetime fee stats from the trade history
function MyPool({ p, price, onClaim, claiming }) {
  const poolAddr = p.address.toBase58()
  const meta = useTokenMeta(p.mint.toBase58())
  const dec = meta?.decimals ?? 6
  const claimable = solOf(p.creatorFees)
  const [agg, setAgg] = useState(null)

  useEffect(() => {
    let alive = true
    fetch(`${INDEXER_API}/pool/${poolAddr}/trades`)
      .then((r) => r.json())
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return
        let earned = 0n, airdropped = 0n, swaps = 0
        for (const r of rows) {
          if (r.kind === 'Swap') { earned += BigInt(r.data.feeCreator || 0); swaps++ }
          else if (r.kind === 'AirdropPayout') { airdropped += BigInt(r.data.total || 0) }
        }
        setAgg({ earned: solOf(earned), airdropped: solOf(airdropped), swaps })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [poolAddr])

  const earned = agg ? agg.earned : null
  const claimed = earned != null ? Math.max(0, earned - claimable) : null
  const usd = (v) => (price && v != null ? `$${(v * price).toLocaleString(undefined, { maximumFractionDigits: v * price < 1 ? 4 : 2 })}` : '—')
  const feeBps = p.feeBps, cShare = p.creatorShareBps / 100, aShare = (p.airdropShareBps || 0) / 100
  const burnShare = 100 - cShare - aShare

  return (
    <div className="my-pool">
      <div className="preview-identity">
        <TokenTag mint={p.mint.toBase58()} size={40} showName />
      </div>
      <div className="claim-big">
        <span className="mini-label">CLAIMABLE FEES</span>
        <span className="big-num mid">{claimable.toFixed(5)}&nbsp;<Sol size={16} /></span>
        <span className="claim-usd">{price ? usd(claimable) : ''}</span>
      </div>
      <button className="ignite-btn" disabled={claimable === 0 || claiming} onClick={() => onClaim(p)}>
        {claiming ? 'CLAIMING…' : claimable === 0 ? 'NOTHING TO CLAIM' : 'CLAIM TO WALLET'}
      </button>

      <div className="cd-stats">
        <div className="cd-stat"><span>ALL-TIME EARNED</span><strong>{earned != null ? <>{earned.toFixed(4)}&nbsp;<Sol size={10} /></> : '…'}</strong><em>{usd(earned)}</em></div>
        <div className="cd-stat"><span>CLAIMED</span><strong>{claimed != null ? <>{claimed.toFixed(4)}&nbsp;<Sol size={10} /></> : '…'}</strong><em>{usd(claimed)}</em></div>
        <div className="cd-stat"><span>AIRDROPPED</span><strong className="good">{agg ? <>{agg.airdropped.toFixed(4)}&nbsp;<Sol size={10} /></> : '…'}</strong><em>{agg?.airdropped ? usd(agg.airdropped) : 'to holders'}</em></div>
        <div className="cd-stat"><span>VOLUME</span><strong>{solOf(p.totalSolVolume).toFixed(3)}&nbsp;<Sol size={10} /></strong><em>{usd(solOf(p.totalSolVolume))}</em></div>
        <div className="cd-stat"><span>TOKENS BURNED</span><strong className="burn">{fmtAmt(Number(p.totalBurned) / 10 ** dec)}</strong><em>flywheel</em></div>
        <div className="cd-stat"><span>TRADES</span><strong>{agg ? agg.swaps : '…'}</strong><em>swaps</em></div>
      </div>
      <div className="cd-split">
        <span>fee {(feeBps / 100).toFixed(1)}%</span>
        <span className="cd-dot creator" />creator {cShare}%
        <span className="cd-dot airdrop" />airdrop {aShare}%
        <span className="cd-dot burn" />burn {burnShare}%
      </div>
    </div>
  )
}

// one burn row, resolving its pool -> token so it shows which coin was burned
function BurnRow({ b, hint, go }) {
  const mint = usePoolMint(b.data.pool, hint)
  return (
    <li className={mint ? 'clickable' : ''} onClick={() => mint && go?.('token', { mint })}>
      <span className="burn-t">{ago(b.ts)}</span>
      {mint
        ? <TokenTag mint={mint} size={17} className="burn-tok" />
        : <span className="burn-tok-un">{b.data.pool.slice(0, 4)}…</span>}
      <span className="burn-sol">{(Number(b.data.solIn) / LAMPORTS_PER_SOL).toFixed(4)}&nbsp;<Sol size={9} /></span>
      <span className="burn">🔥 {(Number(b.data.tokensBurned) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
    </li>
  )
}

const ago = (ts) => {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Claim({ go }) {
  const { publicKey, sendTransaction } = useWallet()
  const { connection } = useConnection()
  const [refreshKey, setRefreshKey] = useState(0)
  const { pools } = usePools(refreshKey)
  const { poolPda } = useInfinityActions()
  // re-read pools now + shortly after (covers RPC confirmed-read lag)
  const refreshPools = () => { setRefreshKey((k) => k + 1); setTimeout(() => setRefreshKey((k) => k + 1), 2500) }
  const { data: burnsRaw } = useIndexer('/burns?limit=16')
  const { data: dropsRaw } = useIndexer('/airdrops?limit=12')
  // hidden test pools must not leak into the public feed
  const burns = useMemo(() => (burnsRaw || []).filter((b) => !HIDDEN_POOLS.has(b.data.pool)).slice(0, 8), [burnsRaw])
  const drops = useMemo(() => (dropsRaw || []).filter((d) => !HIDDEN_POOLS.has(d.data.pool)).slice(0, 6), [dropsRaw])
  const price = useSolPrice()
  const [claimingKey, setClaimingKey] = useState(null)
  const [claimingAll, setClaimingAll] = useState(false)
  const [status, setStatus] = useState(null)

  // pools whose fee_receiver is the connected wallet
  const mine = useMemo(
    () => (publicKey ? pools.filter((p) => p.feeReceiver.toBase58() === publicKey.toBase58()) : []),
    [pools, publicKey]
  )
  // fast pool -> mint hints for the burns feed (visible pools)
  const poolHints = useMemo(() => {
    const m = {}
    pools.forEach((p) => { m[p.address.toBase58()] = p.mint.toBase58() })
    return m
  }, [pools])

  const claim = async (pool) => {
    if (!publicKey) return
    setClaimingKey(pool.address.toBase58()); setStatus(null)
    try {
      const { Transaction, ComputeBudgetProgram } = await import('@solana/web3.js')
      const ix = ixClaimCreatorFees({ pool: pool.address, feeReceiver: publicKey, amount: 0n })
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), ix)
      const sig = await sendTransaction(tx, connection)
      const bh = await connection.getLatestBlockhash()
      await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed')
      setStatus({ sig })
      refreshPools()
    } catch (e) {
      setStatus({ err: String(e.message || e).slice(0, 120) })
    } finally {
      setClaimingKey(null)
    }
  }

  // claim from every pool that has fees, batched ~6 per transaction
  const claimAll = async () => {
    if (!publicKey) return
    const targets = mine.filter((p) => p.creatorFees > 0n)
    if (targets.length === 0) return
    setClaimingAll(true); setStatus(null)
    try {
      const { Transaction, ComputeBudgetProgram } = await import('@solana/web3.js')
      let lastSig
      for (let i = 0; i < targets.length; i += 6) {
        const chunk = targets.slice(i, i + 6)
        const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 * chunk.length }))
        chunk.forEach((p) => tx.add(ixClaimCreatorFees({ pool: p.address, feeReceiver: publicKey, amount: 0n })))
        const sig = await sendTransaction(tx, connection)
        const bh = await connection.getLatestBlockhash()
        await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed')
        lastSig = sig
      }
      setStatus({ sig: lastSig })
      refreshPools()
    } catch (e) {
      setStatus({ err: String(e.message || e).slice(0, 120) })
    } finally {
      setClaimingAll(false)
    }
  }

  const totalClaimable = mine.reduce((s, p) => s + solOf(p.creatorFees), 0)
  const nClaimable = mine.filter((p) => p.creatorFees > 0n).length

  return (
    <>
      <section className="panel claim-panel glass zone-item" style={{ '--i': 0 }}>
        <div className="lps-header">CREATOR DASHBOARD</div>

        {!publicKey && <div className="ca-note" style={{ marginTop: 30 }}>connect a wallet to see pools you created</div>}

        {publicKey && mine.length === 0 && (
          <div className="ca-note" style={{ marginTop: 30 }}>no pools found for this wallet, launch one from LAUNCH</div>
        )}

        {mine.length > 1 && (
          <div className="cd-portfolio">
            <div className="cd-pf-stat"><span>YOUR TOKENS</span><strong>{mine.length}</strong></div>
            <div className="cd-pf-stat"><span>TOTAL CLAIMABLE</span><strong>{totalClaimable.toFixed(5)}&nbsp;<Sol size={12} /></strong></div>
            <button className="cd-claim-all" disabled={claimingAll || nClaimable === 0} onClick={claimAll}>
              {claimingAll ? 'CLAIMING…' : nClaimable === 0 ? 'NOTHING' : `CLAIM ALL (${nClaimable})`}
            </button>
          </div>
        )}

        <div className={mine.length > 1 ? 'cd-list' : ''}>
          {mine.map((p) => (
            <MyPool key={p.address.toBase58()} p={p} price={price}
              onClaim={claim} claiming={claimingKey === p.address.toBase58()} />
          ))}
        </div>
        {status?.sig && <a className="tx-ok" href={EXPLORER(status.sig)} target="_blank" rel="noreferrer">✓ claimed, view tx</a>}
        {status?.err && <div className="tx-err">{status.err}</div>}
      </section>

      <section className="panel claim-flywheel glass zone-item" style={{ '--i': 1 }}>
        <div className="lps-header">FLYWHEEL — BURN &amp; AIRDROP</div>
        <div className="kv"><span>KEEPER</span><strong className="good">RUNNING</strong></div>
        <div className="kv"><span>CRANK TIP</span><strong>0.50%</strong></div>
        <div className="ca-note" style={{ textAlign: 'left', margin: '4px 0 10px' }}>
          holders' fee share auto-buys the token and burns it (the floor rises), and pools with an airdrop share pay accrued SOL straight to holders' wallets.
        </div>
        <div className="stat-divider" />
        <div className="mini-label">RECENT BURNS {burns && burns.length ? '· LIVE' : ''}</div>
        <ul className="burn-list">
          {burns && burns.length > 0 ? (
            burns.map((b) => <BurnRow key={b.id} b={b} hint={poolHints[b.data.pool]} go={go} />)
          ) : (
            <li className="burn-empty">no burns indexed yet, trade a live pool to feed the flywheel</li>
          )}
        </ul>
        <div className="mini-label" style={{ marginTop: 10 }}>RECENT HOLDER AIRDROPS {drops && drops.length ? '· LIVE' : ''}</div>
        <ul className="burn-list">
          {drops && drops.length > 0 ? (
            drops.map((d) => (
              <li key={d.id}>
                <span className="burn-t">{ago(d.ts)}</span>
                <span>{(Number(d.data.total) / LAMPORTS_PER_SOL).toFixed(4)}&nbsp;<Sol size={9} /></span>
                <span className="good">🎁 {d.data.recipients} holders</span>
              </li>
            ))
          ) : (
            <li className="burn-empty">no airdrops yet — launch a pool with an airdrop share</li>
          )}
        </ul>
      </section>
    </>
  )
}
