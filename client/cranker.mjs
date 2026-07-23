// Infinity keeper — flywheel cranker + holders-airdrop distributor.
// Scans every pool; cranks pending buyback-and-burn SOL (collecting the 0.5%
// caller tip) and distributes accrued airdrop SOL pro-rata to top holders.
// Run in tmux on the VM.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { PROGRAM_ID, ixCrank, ixCrankAirdrop, ixMigratePool, decodePool, poolDiscFilter, poolPda } from './infinity.mjs'

const RPC = process.env.RPC || 'https://api.devnet.solana.com'
const POLL_MS = Number(process.env.POLL_MS || 30_000)
const MIN_FLYWHEEL = Number(process.env.MIN_FLYWHEEL || 0.002) * LAMPORTS_PER_SOL
const MIN_AIRDROP = Number(process.env.MIN_AIRDROP || 0.01) * LAMPORTS_PER_SOL
const MAX_RECIPIENTS = 20
const COOLDOWN_SLOTS = 25

const conn = new Connection(RPC, 'confirmed')
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))))
const log = (...a) => console.log(new Date().toISOString(), ...a)

async function sendIxs(ixs, cu = 250_000) {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ...ixs
  )
  return sendAndConfirmTransaction(conn, tx, [wallet], { commitment: 'confirmed' })
}

/** Top holders of `mint` as { owner, amount } — largest token accounts,
 *  mapped to their owner wallets, excluding the pool vault. */
async function topHolders(mint, vault) {
  const { value } = await conn.getTokenLargestAccounts(mint)
  const nonVault = value.filter((v) => !v.address.equals(vault) && BigInt(v.amount) > 0n)
  if (nonVault.length === 0) return []
  const infos = await conn.getMultipleParsedAccounts(nonVault.map((v) => v.address))
  const byOwner = new Map()
  nonVault.forEach((v, i) => {
    const owner = infos.value[i]?.data?.parsed?.info?.owner
    if (!owner) return
    byOwner.set(owner, (byOwner.get(owner) || 0n) + BigInt(v.amount))
  })
  return [...byOwner.entries()]
    .map(([owner, amount]) => ({ owner: new PublicKey(owner), amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : -1))
    .slice(0, MAX_RECIPIENTS)
}

let RENT_MIN_WALLET = 890_880n // rent-exempt minimum for a 0-data account
async function distributeAirdrop(p) {
  const holders = await topHolders(p.mint, p.tokenVault)
  if (holders.length === 0) { log(`airdrop skip ${p.mint.toBase58().slice(0, 8)}: no holders`); return }
  const pot = p.airdropSol
  const totalHeld = holders.reduce((s, h) => s + h.amount, 0n)
  let payouts = holders
    .map((h) => ({ owner: h.owner, lamports: (pot * h.amount) / totalHeld }))
    .filter((x) => x.lamports > 0n)

  // Sanity-filter recipients so one bad account can't fail the whole batch:
  // never the pool itself, never an executable account, and never a credit
  // that would leave an empty wallet below rent exemption (the runtime
  // rejects the entire transaction for that). Dropped shares stay accrued.
  const pool = poolPda(p.mint)
  const infos = await conn.getMultipleAccountsInfo(payouts.map((x) => x.owner))
  payouts = payouts.filter((x, i) => {
    if (x.owner.equals(pool)) return false
    const info = infos[i]
    if (info?.executable) return false
    if ((info?.lamports ?? 0) === 0 && x.lamports < RENT_MIN_WALLET) return false
    return true
  })
  if (payouts.length === 0) { log(`airdrop skip ${p.mint.toBase58().slice(0, 8)}: no payable recipients`); return }

  const sig = await sendIxs([
    ixCrankAirdrop({
      keeper: wallet.publicKey,
      mint: p.mint,
      recipients: payouts.map((x) => x.owner),
      amounts: payouts.map((x) => x.lamports),
    }),
  ], 200_000)
  const total = payouts.reduce((s, x) => s + x.lamports, 0n)
  log(`airdropped ${(Number(total) / LAMPORTS_PER_SOL).toFixed(5)} SOL to ${payouts.length} holders of ${p.mint.toBase58().slice(0, 8)}`, sig.slice(0, 12))
}

async function tick() {
  let slot
  try {
    slot = await conn.getSlot()
    try { RENT_MIN_WALLET = BigInt(await conn.getMinimumBalanceForRentExemption(0)) } catch { /* keep default */ }
    const accs = await conn.getProgramAccounts(PROGRAM_ID, { filters: [poolDiscFilter()] })
    for (const a of accs) {
      let p
      try { p = decodePool(a.account.data) } catch { continue }

      // safety net: extend any legacy 182-byte pool to the V2 layout
      if (a.account.data.length === 182) {
        try {
          const sig = await sendIxs([ixMigratePool({ payer: wallet.publicKey, mint: p.mint })], 80_000)
          log(`migrated ${a.pubkey.toBase58().slice(0, 8)} to V2`, sig.slice(0, 12))
        } catch (e) {
          log(`migrate failed ${a.pubkey.toBase58().slice(0, 8)}:`, String(e.message || e).slice(0, 80))
        }
        continue // trade against it next tick, once decoded at the new size
      }

      // 1) flywheel buyback & burn
      if (p.flywheelSol >= BigInt(Math.floor(MIN_FLYWHEEL)) && slot >= Number(p.lastCrankSlot) + COOLDOWN_SLOTS) {
        try {
          const sig = await sendIxs([ixCrank({ caller: wallet.publicKey, mint: p.mint })])
          log(`cranked ${p.mint.toBase58().slice(0, 8)} — flywheel ${(Number(p.flywheelSol) / LAMPORTS_PER_SOL).toFixed(4)} SOL`, sig.slice(0, 12))
        } catch (e) {
          log(`crank failed ${p.mint.toBase58().slice(0, 8)}:`, String(e.message || e).slice(0, 80))
        }
      }

      // 2) holders airdrop
      if (p.airdropSol >= BigInt(Math.floor(MIN_AIRDROP))) {
        try { await distributeAirdrop(p) } catch (e) {
          log(`airdrop failed ${p.mint.toBase58().slice(0, 8)}:`, String(e.message || e).slice(0, 80))
        }
      }
    }
  } catch (e) {
    log('tick error:', String(e.message || e).slice(0, 80))
  }
}

log(`Infinity keeper up — caller ${wallet.publicKey.toBase58()}, poll ${POLL_MS}ms, min flywheel ${MIN_FLYWHEEL / LAMPORTS_PER_SOL} SOL, min airdrop ${MIN_AIRDROP / LAMPORTS_PER_SOL} SOL`)
await tick()
setInterval(tick, POLL_MS)
