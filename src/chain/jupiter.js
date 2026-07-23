// Jupiter aggregator client — universal any-to-any swaps across all Solana
// liquidity (Raydium, Orca, Meteora, pump, …). Used when a pair has no
// native Infinity pool. Free lite-api; override with VITE_JUP_API.
import { Buffer } from 'buffer'
import { VersionedTransaction } from '@solana/web3.js'

const JUP = import.meta.env.VITE_JUP_API || 'https://lite-api.jup.ag/swap/v1'

export const SOL_MINT = 'So11111111111111111111111111111111111111112'

/** Best route quote for inputMint→outputMint of `amountRaw` (base units). */
export async function jupQuote({ inputMint, outputMint, amountRaw, slippageBps = 50 }) {
  const u = new URL(`${JUP}/quote`)
  u.searchParams.set('inputMint', inputMint)
  u.searchParams.set('outputMint', outputMint)
  u.searchParams.set('amount', String(amountRaw))
  u.searchParams.set('slippageBps', String(slippageBps))
  u.searchParams.set('restrictIntermediateTokens', 'true')
  const r = await fetch(u)
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.error || 'No route found')
  }
  return r.json()
}

/** Build a signed-ready VersionedTransaction from a quote. */
export async function jupSwapTx({ quote, userPublicKey }) {
  const r = await fetch(`${JUP}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: 'high', maxLamports: 4_000_000 } },
    }),
  })
  const j = await r.json()
  if (!j.swapTransaction) throw new Error(j.error || 'swap build failed')
  return VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, 'base64'))
}
