// Devnet smoke test: create one-sided pool → buy → sell → floor guard →
// accrue fees → crank flywheel (burn) → claim creator fees.
// Run on the VM: node smoke.mjs

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
  LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from '@solana/web3.js'
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  ixCreatePool, ixBuy, ixSell, ixCrank, ixClaimCreatorFees,
  poolPda, decodePool,
} from './infinity.mjs'

const RPC = process.env.RPC || 'https://api.devnet.solana.com'
const conn = new Connection(RPC, 'confirmed')
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`)))
)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}`) } }
const SOL = (n) => Math.round(n * LAMPORTS_PER_SOL)
const cu = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })

async function send(ixs, signers = [wallet]) {
  const tx = new Transaction().add(cu(), ...ixs)
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed', skipPreflight: false })
}
async function pool(mint) {
  const info = await conn.getAccountInfo(poolPda(mint))
  return decodePool(info.data)
}

async function main() {
  console.log(`\nINFINITY smoke test — devnet`)
  console.log(`wallet ${wallet.publicKey.toBase58()}`)
  const bal = await conn.getBalance(wallet.publicKey)
  console.log(`balance ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL\n`)
  if (bal < SOL(0.5)) throw new Error('need ≥ 0.5 devnet SOL')

  // --- create a test SPL token, 6 decimals, 1B supply to us ---
  console.log('1. minting test token…')
  const mint = await createMint(conn, wallet, wallet.publicKey, null, 6)
  const ata = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, wallet.publicKey)
  const SUPPLY = 1_000_000_000n * 1_000_000n // 1B * 1e6
  await mintTo(conn, wallet, mint, ata.address, wallet, SUPPLY)
  console.log(`   mint ${mint.toBase58()}`)

  // --- create one-sided pool: deposit only tokens ---
  console.log('\n2. create_pool (ORBIT tier, 1% fee, 50/50 split)…')
  const solBefore = await conn.getBalance(wallet.publicKey)
  const { ix } = ixCreatePool({
    creator: wallet.publicKey, mint, tokenAmount: SUPPLY, tier: 1, feeBps: 100, creatorShareBps: 5000, sniperGuard: false,
  })
  const sig1 = await send([ix])
  const p1 = await pool(mint)
  ok(p1.virtualSol === BigInt(SOL(35)), `virtual_sol = 35 SOL (${Number(p1.virtualSol) / LAMPORTS_PER_SOL})`)
  ok(p1.realSol === 0n, 'real_sol = 0 (nobody bought yet)')
  ok(p1.tokenReserve === SUPPLY, 'token_reserve = full supply')
  ok(p1.feeBps === 100 && p1.creatorShareBps === 5000, 'fee config stored')
  const vault = await getAccount(conn, p1.tokenVault)
  ok(vault.amount === SUPPLY, 'vault holds the deposited tokens')
  const solCost = solBefore - (await conn.getBalance(wallet.publicKey))
  console.log(`   creator SOL spent (rent+fees only): ${(solCost / LAMPORTS_PER_SOL).toFixed(4)} — no liquidity SOL`)
  console.log(`   ${sig1}`)

  // --- buy ---
  console.log('\n3. buy 0.3 SOL…')
  const walBefore = (await getAccount(conn, ata.address)).amount
  await send([ixBuy({ trader: wallet.publicKey, mint, solIn: SOL(0.3), minTokensOut: 0 })])
  const p2 = await pool(mint)
  const walAfter = (await getAccount(conn, ata.address)).amount
  ok(walAfter > walBefore, `received ${(Number(walAfter - walBefore) / 1e6).toLocaleString()} tokens`)
  ok(p2.realSol > 0n, `real_sol now ${(Number(p2.realSol) / LAMPORTS_PER_SOL).toFixed(4)}`)
  ok(p2.creatorFees > 0n && p2.flywheelSol > 0n, 'creator + flywheel fees accrued')
  ok(p2.tokenReserve < p1.tokenReserve, 'token_reserve decreased')

  // --- sell a small slice back (within the floor) ---
  console.log('\n4. sell 5M tokens back (within floor)…')
  const p3a = await pool(mint)
  await send([ixSell({ trader: wallet.publicKey, mint, tokensIn: 5_000_000n * 1_000_000n, minSolOut: 0 })])
  const p3 = await pool(mint)
  ok(p3.realSol < p3a.realSol, 'real_sol decreased on sell')
  ok(p3.realSol >= 0n, 'real_sol never negative')

  // --- floor guard: try to sell a huge amount, expect FloorReached ---
  console.log('\n5. sell 500M tokens (must hit virtual floor and revert)…')
  let reverted = false
  try {
    await send([ixSell({ trader: wallet.publicKey, mint, tokensIn: 500_000_000n * 1_000_000n, minSolOut: 0 })])
  } catch (e) {
    reverted = /FloorReached|0x1774|custom program error/.test(String(e))
  }
  ok(reverted, 'oversized sell reverted (floor holds)')

  // --- accrue more fees, then crank the flywheel ---
  console.log('\n6. two more buys to feed the flywheel…')
  await send([ixBuy({ trader: wallet.publicKey, mint, solIn: SOL(0.2), minTokensOut: 0 })])
  await send([ixBuy({ trader: wallet.publicKey, mint, solIn: SOL(0.2), minTokensOut: 0 })])
  const pc0 = await pool(mint)
  console.log(`   flywheel_sol pending: ${(Number(pc0.flywheelSol) / LAMPORTS_PER_SOL).toFixed(5)} SOL`)

  console.log('\n7. crank_flywheel (buyback + burn)…')
  const supBefore = (await getMint(conn, mint)).supply
  await send([ixCrank({ caller: wallet.publicKey, mint })])
  const pc1 = await pool(mint)
  const supAfter = (await getMint(conn, mint)).supply
  ok(supAfter < supBefore, `supply burned: ${(Number(supBefore - supAfter) / 1e6).toLocaleString()} tokens`)
  ok(pc1.totalBurned > 0n, 'total_burned recorded on pool')
  ok(pc1.flywheelSol < pc0.flywheelSol, 'flywheel_sol consumed')
  ok(pc1.realSol > pc0.realSol, 'buyback SOL entered the curve (floor rises)')

  // --- claim creator fees ---
  console.log('\n8. claim_creator_fees…')
  const pcl = await pool(mint)
  const before = await conn.getBalance(wallet.publicKey)
  await send([ixClaimCreatorFees({ pool: poolPda(mint), feeReceiver: wallet.publicKey, amount: 0n })])
  const pcl2 = await pool(mint)
  ok(pcl2.creatorFees === 0n, `claimed ${(Number(pcl.creatorFees) / LAMPORTS_PER_SOL).toFixed(5)} SOL to creator`)

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  console.log(`pool: ${poolPda(mint).toBase58()}`)
  console.log(`mint: ${mint.toBase58()}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\nFATAL', e); process.exit(1) })
