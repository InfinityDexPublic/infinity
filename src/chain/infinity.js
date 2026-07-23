// Browser SDK for the Infinity AMM program.
// Discriminators are precomputed (sha256("global:<ix>")[0..8]) so the
// browser never needs async crypto to build an instruction.

import { Buffer } from 'buffer'
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { PROGRAM_ID } from './config.js'

export const POOL_SEED = Buffer.from('pool')
export const TIERS_SOL = [10, 35, 100, 500]

const DISC = {
  create_pool: 'e992d18ecf6840bc',
  buy: '66063d1201daebea',
  sell: '33e685a4017f83ad',
  crank_flywheel: 'e1d28ff734566575',
  claim_creator_fees: '00177dea9c768659',
  reduce_fees: 'ef8817633704a77e',
  transfer_fee_receiver: '5974ddc9c45f6612',
  crank_airdrop: '20e7c485836507bc',
  migrate_pool: '37aaab7bd24527ac',
}
const POOL_ACCOUNT_DISC = Buffer.from('f19a6d0411b16dbc', 'hex')
const POOL_ACCOUNT_DISC_B58 = 'hQrXeCntzbV'

const disc = (name) => Buffer.from(DISC[name], 'hex')
const u64 = (v) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(v))
  return b
}
const u16 = (v) => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(v)
  return b
}
const u8 = (v) => Buffer.from([v])
const optU16 = (v) => (v == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), u16(v)]))
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable })

export function poolPda(mint) {
  return PublicKey.findProgramAddressSync([POOL_SEED, mint.toBuffer()], PROGRAM_ID)[0]
}
export function vaultFor(mint, pool, tokenProgram = TOKEN_PROGRAM_ID) {
  return getAssociatedTokenAddressSync(mint, pool, true, tokenProgram)
}

export function ixCreatePool({ creator, mint, tokenAmount, tier, feeBps, creatorShareBps, sniperGuard = false, airdropShareBps = 0, tokenProgram = TOKEN_PROGRAM_ID }) {
  const pool = poolPda(mint)
  const data = Buffer.concat([disc('create_pool'), u64(tokenAmount), u8(tier), u16(feeBps), u16(creatorShareBps), u8(sniperGuard ? 1 : 0), u16(airdropShareBps)])
  const keys = [
    meta(creator, true, true),
    meta(mint, false, false),
    meta(pool, false, true),
    meta(vaultFor(mint, pool, tokenProgram), false, true),
    meta(getAssociatedTokenAddressSync(mint, creator, false, tokenProgram), false, true),
    meta(tokenProgram, false, false),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
    meta(SystemProgram.programId, false, false),
  ]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

function tradeIx(name, { trader, mint, arg0, arg1, tokenProgram = TOKEN_PROGRAM_ID }) {
  const pool = poolPda(mint)
  const keys = [
    meta(trader, true, true),
    meta(pool, false, true),
    meta(mint, false, false),
    meta(vaultFor(mint, pool, tokenProgram), false, true),
    meta(getAssociatedTokenAddressSync(mint, trader, false, tokenProgram), false, true),
    meta(tokenProgram, false, false),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
    meta(SystemProgram.programId, false, false),
  ]
  const data = Buffer.concat([disc(name), u64(arg0), u64(arg1)])
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

export const ixBuy = ({ trader, mint, solIn, minTokensOut, tokenProgram }) =>
  tradeIx('buy', { trader, mint, arg0: solIn, arg1: minTokensOut, tokenProgram })
export const ixSell = ({ trader, mint, tokensIn, minSolOut, tokenProgram }) =>
  tradeIx('sell', { trader, mint, arg0: tokensIn, arg1: minSolOut, tokenProgram })

export function ixCrank({ caller, mint, minTokensOut = 0, tokenProgram = TOKEN_PROGRAM_ID }) {
  const pool = poolPda(mint)
  const keys = [
    meta(caller, true, true),
    meta(pool, false, true),
    meta(mint, false, true),
    meta(vaultFor(mint, pool, tokenProgram), false, true),
    meta(tokenProgram, false, false),
  ]
  const data = Buffer.concat([disc('crank_flywheel'), u64(minTokensOut)])
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

export function ixClaimCreatorFees({ pool, feeReceiver, amount }) {
  const data = Buffer.concat([disc('claim_creator_fees'), u64(amount)])
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(pool, false, true), meta(feeReceiver, true, true)],
    data,
  })
}

export function ixReduceFees({ pool, feeReceiver, newFeeBps = null, newCreatorShareBps = null }) {
  const data = Buffer.concat([disc('reduce_fees'), optU16(newFeeBps), optU16(newCreatorShareBps)])
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(pool, false, true), meta(feeReceiver, true, false)],
    data,
  })
}

/** Keeper-only: distribute accrued airdrop SOL to `recipients` (owners, not
 *  token accounts), one amount per recipient. */
export function ixCrankAirdrop({ keeper, mint, recipients, amounts }) {
  const pool = poolPda(mint)
  const vec = Buffer.alloc(4)
  vec.writeUInt32LE(amounts.length)
  const data = Buffer.concat([disc('crank_airdrop'), vec, ...amounts.map((a) => u64(a))])
  const keys = [
    meta(keeper, true, true),
    meta(pool, false, true),
    ...recipients.map((r) => meta(r, false, true)),
  ]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

/** Permissionless: extend a legacy 182-byte pool to the airdrop-aware layout. */
export function ixMigratePool({ payer, mint }) {
  const keys = [
    meta(payer, true, true),
    meta(poolPda(mint), false, true),
    meta(SystemProgram.programId, false, false),
  ]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: disc('migrate_pool') })
}

/* ---------- decoding ---------- */

export function decodePool(data) {
  if (!data || !Buffer.from(data.subarray(0, 8)).equals(POOL_ACCOUNT_DISC)) return null
  let o = 8
  const buf = Buffer.from(data)
  const pk = () => { const p = new PublicKey(buf.subarray(o, o + 32)); o += 32; return p }
  const rU64 = () => { const v = buf.readBigUInt64LE(o); o += 8; return v }
  const rU16 = () => { const v = buf.readUInt16LE(o); o += 2; return v }
  const rU8 = () => { const v = buf.readUInt8(o); o += 1; return v }
  const p = {
    mint: pk(),
    tokenVault: pk(),
    feeReceiver: pk(),
    virtualSol: rU64(),
    realSol: rU64(),
    tokenReserve: rU64(),
    feeBps: rU16(),
    creatorShareBps: rU16(),
    creatorFees: rU64(),
    flywheelSol: rU64(),
    totalSolVolume: rU64(),
    totalBurned: rU64(),
    createdAtSlot: rU64(),
    lastCrankSlot: rU64(),
    bump: rU8(),
    sniperGuard: rU8(),
    // V2 fields — legacy 182-byte pools predate the airdrop bucket
    airdropShareBps: 0,
    airdropSol: 0n,
  }
  if (buf.length >= o + 10) {
    p.airdropShareBps = rU16()
    p.airdropSol = rU64()
  }
  return p
}

// Pools are matched by their account discriminator (size-agnostic: V1 legacy
// pools are 182 bytes, V2 airdrop-aware pools are 192).
export const POOL_ACCOUNT_SIZE = 192
export const poolSizeFilter = () => ({ memcmp: { offset: 0, bytes: POOL_ACCOUNT_DISC_B58 } })
