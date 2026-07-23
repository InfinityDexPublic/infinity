import { LAMPORTS_PER_SOL } from '@solana/web3.js'

const PALETTE = ['#7B2BFF', '#00F0FF', '#14F195', '#C7F284', '#F5A623', '#FF5CA8', '#8FE3FF', '#B3FF66']

/** Deterministic symbol/glyph/color from a mint address (no metadata on devnet). */
export function deriveMeta(mintBase58) {
  let h = 0
  for (let i = 0; i < mintBase58.length; i++) h = (h * 31 + mintBase58.charCodeAt(i)) >>> 0
  const symbol = mintBase58.slice(0, 4).toUpperCase()
  return { symbol, glyph: symbol[0], color: PALETTE[h % PALETTE.length] }
}

export const solOf = (lamports) => Number(lamports) / LAMPORTS_PER_SOL

export function priceSol(pool) {
  const y = Number(pool.virtualSol + pool.realSol)
  const x = Number(pool.tokenReserve)
  return x > 0 ? y / x : 0
}

// number only — render <Sol/> alongside at call sites
export const fmtSol = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(2)}k` : `${n.toFixed(n < 1 ? 4 : 2)}`
