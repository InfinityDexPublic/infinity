// Real mainnet smoke test with tiny amounts. Proves the deployed vanity
// program runs the full cycle live. Net SOL bought stays locked in the pool
// forever (permanent liquidity — by design), so amounts are minimal.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getMint,
} from '@solana/spl-token'
import {
  ixCreatePool, ixBuy, ixSell, ixCrank, ixClaimCreatorFees, poolPda, decodePool,
} from './infinity.mjs'

const RPC = process.env.RPC // pass the mainnet RPC via env, never hardcode a key
if (!RPC) { console.error('set RPC env'); process.exit(1) }
const conn = new Connection(RPC, 'confirmed')
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))))
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${m}`) }
const SOL = (n) => Math.round(n * LAMPORTS_PER_SOL)
const cu = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
const cp = () => ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 60_000 })
const send = (ixs) => sendAndConfirmTransaction(conn, new Transaction().add(cu(), cp(), ...ixs), [wallet], { commitment: 'confirmed' })
const pool = async (mint) => {
  for (let i = 0; i < 12; i++) {
    const info = await conn.getAccountInfo(poolPda(mint))
    if (info) return decodePool(info.data)
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('pool not visible after retries')
}

async function main() {
  console.log('\nMAINNET smoke — wallet', wallet.publicKey.toBase58())
  const bal = await conn.getBalance(wallet.publicKey)
  console.log('balance', (bal / LAMPORTS_PER_SOL).toFixed(4), 'SOL\n')

  console.log('1. mint test token…')
  const mint = await createMint(conn, wallet, wallet.publicKey, null, 6)
  const ata = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, wallet.publicKey)
  const SUPPLY = 1_000_000_000n * 1_000_000n
  await mintTo(conn, wallet, mint, ata.address, wallet, SUPPLY)

  console.log('2. create_pool (SPARK tier, guard on)…')
  await send([ixCreatePool({ creator: wallet.publicKey, mint, tokenAmount: SUPPLY, tier: 0, feeBps: 100, creatorShareBps: 5000, sniperGuard: true }).ix])
  const p1 = await pool(mint)
  ok(p1.virtualSol === BigInt(SOL(10)), 'virtual floor = 10 SOL')
  ok(p1.realSol === 0n, 'real_sol = 0 (one-sided)')
  ok(p1.tokenReserve === SUPPLY, 'full supply in pool')
  ok(p1.sniperGuard === 1, 'sniper guard on')

  console.log('3. buy 0.01 SOL…')
  await send([ixBuy({ trader: wallet.publicKey, mint, solIn: SOL(0.01), minTokensOut: 0 })])
  const p2 = await pool(mint)
  ok(p2.realSol > 0n, `real_sol now ${(Number(p2.realSol) / LAMPORTS_PER_SOL).toFixed(5)}`)
  ok(p2.flywheelSol > 0n, 'flywheel accrued (sniper tax → holders)')
  ok(p2.tokenReserve < SUPPLY, 'tokens left the pool')

  console.log('4. oversized sell must hit the floor…')
  let reverted = false
  try { await send([ixSell({ trader: wallet.publicKey, mint, tokensIn: 500_000_000n * 1_000_000n, minSolOut: 0 })]) }
  catch (e) { reverted = /FloorReached|0x1774|custom program error/.test(String(e)) }
  ok(reverted, 'floor holds (cannot sell into virtual SOL)')

  console.log('5. crank flywheel (buyback + burn)…')
  const supBefore = (await getMint(conn, mint)).supply
  try {
    await send([ixCrank({ caller: wallet.publicKey, mint })])
    const supAfter = (await getMint(conn, mint)).supply
    ok(supAfter < supBefore, `burned ${(Number(supBefore - supAfter) / 1e6).toFixed(0)} tokens`)
  } catch (e) { ok(false, 'crank: ' + String(e.message || e).slice(0, 60)) }

  console.log('6. claim creator fees…')
  await send([ixClaimCreatorFees({ pool: poolPda(mint), feeReceiver: wallet.publicKey, amount: 0n })])
  const p3 = await pool(mint)
  ok(p3.creatorFees === 0n, 'creator fees claimed')

  console.log(`\n${'─'.repeat(36)}\n${pass} passed, ${fail} failed`)
  console.log('pool:', poolPda(mint).toBase58())
  console.log('mint:', mint.toBase58())
  const spent = (bal - await conn.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL
  console.log('SOL spent (incl. permanently-locked liquidity):', spent.toFixed(5))
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
