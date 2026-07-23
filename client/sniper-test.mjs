// Verify the anti-sniper guard on devnet: a guarded pool taxes an
// immediate buy heavily and routes 100% of that tax to the flywheel,
// while an identical unguarded pool does not.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'
import { ixCreatePool, ixBuy, poolPda, decodePool } from './infinity.mjs'

const conn = new Connection(process.env.RPC || 'https://api.devnet.solana.com', 'confirmed')
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))))
const SUPPLY = 1_000_000_000n * 1_000_000n
const cu = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
const send = (ixs) => sendAndConfirmTransaction(conn, new Transaction().add(cu(), ...ixs), [wallet], { commitment: 'confirmed' })
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${m}`) }

async function launchAndBuy(guard) {
  const mint = await createMint(conn, wallet, wallet.publicKey, null, 6)
  const ata = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, wallet.publicKey)
  await mintTo(conn, wallet, mint, ata.address, wallet, SUPPLY)
  await send([ixCreatePool({ creator: wallet.publicKey, mint, tokenAmount: SUPPLY, tier: 1, feeBps: 100, creatorShareBps: 5000, sniperGuard: guard }).ix])
  // buy immediately (same opening window)
  await send([ixBuy({ trader: wallet.publicKey, mint, solIn: Math.round(0.5 * LAMPORTS_PER_SOL), minTokensOut: 0 })])
  const p = decodePool((await conn.getAccountInfo(poolPda(mint))).data)
  return p
}

async function main() {
  console.log('\nANTI-SNIPER test — devnet\n')
  console.log('1. guarded pool, immediate 0.5 SOL buy…')
  const g = await launchAndBuy(true)
  ok(g.sniperGuard === 1, 'pool decodes sniper_guard = 1')
  console.log('2. unguarded pool, immediate 0.5 SOL buy…')
  const u = await launchAndBuy(false)
  ok(u.sniperGuard === 0, 'pool decodes sniper_guard = 0')

  // guarded: big chunk of the buy taxed to flywheel; unguarded: only base fee
  console.log(`   guarded flywheel_sol:   ${(Number(g.flywheelSol) / LAMPORTS_PER_SOL).toFixed(5)} ◎`)
  console.log(`   unguarded flywheel_sol: ${(Number(u.flywheelSol) / LAMPORTS_PER_SOL).toFixed(5)} ◎`)
  ok(g.flywheelSol > u.flywheelSol * 5n, 'guarded pool routed far more to the flywheel (sniper tax → holders)')
  ok(g.tokenReserve > u.tokenReserve, 'guarded sniper received fewer tokens (net after tax is smaller)')
  ok(g.creatorFees === u.creatorFees, 'creator fee identical — the sniper tax is NOT taken by the creator')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
