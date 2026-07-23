import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { PROGRAM_ID, HIDDEN_POOLS } from './config.js'
import {
  decodePool, poolSizeFilter, ixBuy, ixSell, ixCreatePool, poolPda,
} from './infinity.js'

/** Live pools from the program, newest first. */
export function usePools(refreshKey = 0) {
  const { connection } = useConnection()
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    connection
      .getProgramAccounts(PROGRAM_ID, { filters: [poolSizeFilter()] })
      .then((accs) => {
        if (!alive) return
        const decoded = accs
          .map((a) => {
            const p = decodePool(a.account.data)
            return p ? { ...p, address: a.pubkey } : null
          })
          .filter(Boolean)
          .filter((p) => !HIDDEN_POOLS.has(p.address.toBase58()))
          .sort((a, b) => Number(b.createdAtSlot - a.createdAtSlot))
        setPools(decoded)
        setLoading(false)
      })
      .catch(() => alive && setLoading(false))
    return () => { alive = false }
  }, [connection, refreshKey])

  return { pools, loading }
}

const withCu = (ix) =>
  new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ix
  )

export function useInfinityActions() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()

  const run = useCallback(
    async (ix) => {
      if (!publicKey) throw new Error('connect a wallet first')
      const tx = withCu(ix)
      tx.feePayer = publicKey
      const sig = await sendTransaction(tx, connection)
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      return sig
    },
    [connection, publicKey, sendTransaction]
  )

  const buy = useCallback(
    ({ mint, solIn, minTokensOut = 0, tokenProgram }) =>
      run(ixBuy({ trader: publicKey, mint, solIn: Math.round(solIn * LAMPORTS_PER_SOL), minTokensOut, tokenProgram })),
    [run, publicKey]
  )

  const sell = useCallback(
    ({ mint, tokensIn, minSolOut = 0, tokenProgram }) =>
      run(ixSell({ trader: publicKey, mint, tokensIn, minSolOut, tokenProgram })),
    [run, publicKey]
  )

  const createPool = useCallback(
    ({ mint, tokenAmount, tier, feeBps, creatorShareBps }) =>
      run(ixCreatePool({ creator: publicKey, mint, tokenAmount, tier, feeBps, creatorShareBps })),
    [run, publicKey]
  )

  return { buy, sell, createPool, poolPda }
}
