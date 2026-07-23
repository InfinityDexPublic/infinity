// Complete the mainnet cycle on the existing test pool: buy → sell → crank
// → claim, with retry reads (Helius 'confirmed' lags right after writes).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { getAssociatedTokenAddressSync, getAccount, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { ixBuy, ixSell, ixCrank, ixClaimCreatorFees, poolPda, decodePool } from './infinity.mjs'

const conn = new Connection(process.env.RPC || 'https://api.mainnet-beta.solana.com', 'confirmed')
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))))
const MINT = new PublicKey('6NpnEGU5oHka4aguZQYAkQVm55z5AKNnseTSKTmDrpRv')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${m}`) }
const SOL = (n) => Math.round(n * LAMPORTS_PER_SOL)
const send = (ixs) => sendAndConfirmTransaction(conn,
  new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 60_000 }), ...ixs),
  [wallet], { commitment: 'confirmed' })
const retry = async (fn, n = 12) => { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v != null) return v } catch {} await new Promise((r) => setTimeout(r, 1500)) } throw new Error('read timeout') }
const pool = () => retry(async () => { const i = await conn.getAccountInfo(poolPda(MINT)); return i ? decodePool(i.data) : null })
const ata = getAssociatedTokenAddressSync(MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID)
const bal = () => retry(async () => (await getAccount(conn, ata)).amount)

async function main() {
  console.log('\nMAINNET trade cycle on pool', poolPda(MINT).toBase58(), '\n')
  const p0 = await pool()
  ok(p0.tokenReserve > 0n, `pool live, floor ${Number(p0.virtualSol) / LAMPORTS_PER_SOL} SOL, guard ${p0.sniperGuard}`)

  console.log('1. buy 0.01 SOL…')
  await send([ixBuy({ trader: wallet.publicKey, mint: MINT, solIn: SOL(0.01), minTokensOut: 0 })])
  const got = await bal()
  const p1 = await pool()
  ok(got > 0n, `received ${(Number(got) / 1e6).toLocaleString()} tokens`)
  ok(p1.realSol > 0n, `real_sol ${(Number(p1.realSol) / LAMPORTS_PER_SOL).toFixed(6)}`)
  ok(p1.flywheelSol > 0n, 'flywheel accrued (sniper tax → holders)')

  console.log('2. sell half back…')
  const p2a = await pool()
  await send([ixSell({ trader: wallet.publicKey, mint: MINT, tokensIn: got / 2n, minSolOut: 0 })])
  const p2 = await pool()
  ok(p2.realSol < p2a.realSol, 'real_sol decreased on sell')
  ok(p2.realSol >= 0n, 'real_sol never negative')

  console.log('3. crank flywheel (buyback + burn)…')
  const supBefore = (await getMint(conn, MINT)).supply
  await send([ixCrank({ caller: wallet.publicKey, mint: MINT, minTokensOut: 0 })])
  const supAfter = await retry(async () => { const s = (await getMint(conn, MINT)).supply; return s < supBefore ? s : null })
  ok(supAfter < supBefore, `burned ${(Number(supBefore - supAfter) / 1e6).toFixed(0)} tokens`)

  console.log('4. claim creator fees…')
  await send([ixClaimCreatorFees({ pool: poolPda(MINT), feeReceiver: wallet.publicKey, amount: 0n })])
  const p4 = await pool()
  ok(p4.creatorFees === 0n, 'creator fees claimed')

  console.log(`\n${'─'.repeat(36)}\n${pass} passed, ${fail} failed — full cycle LIVE on mainnet`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', String(e.message || e)); process.exit(1) })
