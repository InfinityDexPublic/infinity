// One-shot: extend every legacy 182-byte pool to the airdrop-aware V2 layout.
// Run on the VM after deploying the upgraded program.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction,
} from '@solana/web3.js'
import { PROGRAM_ID, ixMigratePool, decodePool, poolDiscFilter } from './infinity.mjs'

const RPC = process.env.RPC
if (!RPC) { console.error('Set RPC explicitly (this script must never silently target the wrong cluster).'); process.exit(1) }
console.log('cluster:', RPC.replace(/api-key=[^&]+/, 'api-key=***'))
const conn = new Connection(RPC, 'confirmed')
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))))

const accs = await conn.getProgramAccounts(PROGRAM_ID, { filters: [poolDiscFilter()] })
console.log(`${accs.length} pool(s) found`)
for (const a of accs) {
  const len = a.account.data.length
  if (len !== 182) { console.log(`${a.pubkey.toBase58()} — already V2 (${len}B), skip`); continue }
  const p = decodePool(a.account.data)
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ixMigratePool({ payer: wallet.publicKey, mint: p.mint })
  )
  const sig = await sendAndConfirmTransaction(conn, tx, [wallet], { commitment: 'confirmed' })
  const after = await conn.getAccountInfo(a.pubkey)
  console.log(`migrated ${a.pubkey.toBase58()} → ${after.data.length}B`, sig.slice(0, 16))
}
console.log('done')
