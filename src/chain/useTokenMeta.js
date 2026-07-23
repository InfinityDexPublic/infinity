import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { resolveToken } from './tokens.js'
import { decodePool } from './infinity.js'
import { deriveMeta } from './display.js'

// module-level caches so each mint is resolved once across all cards
const cache = new Map()     // mint -> { symbol, name, image, color }
const inflight = new Map()  // mint -> Promise

/** Resolve a pool token's real on-chain name/symbol/image, cached. Falls back
 *  to the deterministic deriveMeta placeholder while loading or if absent. */
export function useTokenMeta(mintStr) {
  const { connection } = useConnection()
  const [meta, setMeta] = useState(() => cache.get(mintStr) || null)

  useEffect(() => {
    let alive = true
    if (!mintStr) { setMeta(null); return }
    if (cache.has(mintStr)) { setMeta(cache.get(mintStr)); return }
    let p = inflight.get(mintStr)
    if (!p) {
      p = resolveToken(connection, mintStr)
        .then((t) => ({ symbol: t.symbol, name: t.name, image: t.image, color: t.color, decimals: t.decimals, supply: t.supply }))
        .catch(() => { const d = deriveMeta(mintStr); return { symbol: d.symbol, name: '', image: '', color: d.color } })
        .then((m) => { cache.set(mintStr, m); inflight.delete(mintStr); return m })
      inflight.set(mintStr, p)
    }
    p.then((m) => { if (alive) setMeta(m) })
    return () => { alive = false }
  }, [connection, mintStr])

  return meta
}

// pool address -> token mint, cached (for feeds that only carry the pool key)
const poolMintCache = new Map()
const poolMintInflight = new Map()

export function usePoolMint(poolStr, hint) {
  const { connection } = useConnection()
  const [mint, setMint] = useState(() => hint || poolMintCache.get(poolStr) || null)
  useEffect(() => {
    let alive = true
    if (hint) { poolMintCache.set(poolStr, hint); setMint(hint); return }
    if (!poolStr) return
    if (poolMintCache.has(poolStr)) { setMint(poolMintCache.get(poolStr)); return }
    let p = poolMintInflight.get(poolStr)
    if (!p) {
      p = connection.getAccountInfo(new PublicKey(poolStr))
        .then((acc) => { const d = acc && decodePool(acc.data); return d ? d.mint.toBase58() : null })
        .catch(() => null)
        .then((m) => { poolMintCache.set(poolStr, m); poolMintInflight.delete(poolStr); return m })
      poolMintInflight.set(poolStr, p)
    }
    p.then((m) => { if (alive) setMint(m) })
    return () => { alive = false }
  }, [connection, poolStr, hint])
  return mint
}
