// Static launch parameters + display formatters. No mock market data —
// everything else on the UI comes from on-chain accounts, the indexer,
// and the live SOL price.

export const TIERS = [
  { sol: 10, label: 'SPARK', desc: 'micro experiment' },
  { sol: 35, label: 'ORBIT', desc: 'the standard' },
  { sol: 100, label: 'NOVA', desc: 'community listing' },
  { sol: 500, label: 'SUPERNOVA', desc: 'large project' },
]

export function fmtUsd(n) {
  if (!n) return '$0'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

export function fmtSol(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(2)}k` : `${n.toFixed(n < 1 ? 4 : 2)}`
}
