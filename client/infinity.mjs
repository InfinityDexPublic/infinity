// Infinity AMM — minimal JS SDK.
// No Anchor CLI available, so instructions are encoded by hand:
// discriminator = sha256("global:<ix>")[0..8], args in Anchor-Borsh order.

import { createHash } from 'node:crypto'
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

export const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi')
export const POOL_SEED = Buffer.from('pool')
export const TIERS_SOL = [10, 35, 100, 500]

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
const acctDisc = (name) => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8)

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

export function poolPda(mint) {
  return PublicKey.findProgramAddressSync([POOL_SEED, mint.toBuffer()], PROGRAM_ID)[0]
}

const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable })

/* ---------- instruction builders ---------- */

export function ixCreatePool({ creator, mint, tokenAmount, tier, feeBps, creatorShareBps, sniperGuard = false, airdropShareBps = 0, tokenProgram = TOKEN_PROGRAM_ID }) {
  const pool = poolPda(mint)
  const tokenVault = getAssociatedTokenAddressSync(mint, pool, true, tokenProgram)
  const creatorToken = getAssociatedTokenAddressSync(mint, creator, false, tokenProgram)
  const data = Buffer.concat([disc('create_pool'), u64(tokenAmount), u8(tier), u16(feeBps), u16(creatorShareBps), u8(sniperGuard ? 1 : 0), u16(airdropShareBps)])
  const keys = [
    meta(creator, true, true),
    meta(mint, false, false),
    meta(pool, false, true),
    meta(tokenVault, false, true),
    meta(creatorToken, false, true),
    meta(tokenProgram, false, false),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
    meta(SystemProgram.programId, false, false),
  ]
  return { ix: new TransactionInstruction({ programId: PROGRAM_ID, keys, data }), pool, tokenVault }
}

function tradeIx(name, { trader, mint, arg0, arg1, tokenProgram = TOKEN_PROGRAM_ID }) {
  const pool = poolPda(mint)
  const tokenVault = getAssociatedTokenAddressSync(mint, pool, true, tokenProgram)
  const traderToken = getAssociatedTokenAddressSync(mint, trader, false, tokenProgram)
  const data = Buffer.concat([disc(name), u64(arg0), u64(arg1)])
  const keys = [
    meta(trader, true, true),
    meta(pool, false, true),
    meta(mint, false, false),
    meta(tokenVault, false, true),
    meta(traderToken, false, true),
    meta(tokenProgram, false, false),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
    meta(SystemProgram.programId, false, false),
  ]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

export const ixBuy = ({ trader, mint, solIn, minTokensOut, tokenProgram }) =>
  tradeIx('buy', { trader, mint, arg0: solIn, arg1: minTokensOut, tokenProgram })

export const ixSell = ({ trader, mint, tokensIn, minSolOut, tokenProgram }) =>
  tradeIx('sell', { trader, mint, arg0: tokensIn, arg1: minSolOut, tokenProgram })

export function ixCrank({ caller, mint, minTokensOut = 0, tokenProgram = TOKEN_PROGRAM_ID }) {
  const pool = poolPda(mint)
  const tokenVault = getAssociatedTokenAddressSync(mint, pool, true, tokenProgram)
  const keys = [
    meta(caller, true, true),
    meta(pool, false, true),
    meta(mint, false, true),
    meta(tokenVault, false, true),
    meta(tokenProgram, false, false),
  ]
  const data = Buffer.concat([disc('crank_flywheel'), u64(minTokensOut)])
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

export function ixClaimCreatorFees({ pool, feeReceiver, amount }) {
  const data = Buffer.concat([disc('claim_creator_fees'), u64(amount)])
  const keys = [meta(pool, false, true), meta(feeReceiver, true, true)]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

export function ixReduceFees({ pool, feeReceiver, newFeeBps = null, newCreatorShareBps = null }) {
  const data = Buffer.concat([disc('reduce_fees'), optU16(newFeeBps), optU16(newCreatorShareBps)])
  const keys = [meta(pool, false, true), meta(feeReceiver, true, false)]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data })
}

export function ixTransferFeeReceiver({ pool, feeReceiver, newReceiver }) {
  const keys = [meta(pool, false, true), meta(feeReceiver, true, false), meta(newReceiver, true, false)]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: disc('transfer_fee_receiver') })
}

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

export function ixMigratePool({ payer, mint }) {
  const keys = [
    meta(payer, true, true),
    meta(poolPda(mint), false, true),
    meta(SystemProgram.programId, false, false),
  ]
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: disc('migrate_pool') })
}

/* ---------- account decoding ---------- */

const POOL_DISC = acctDisc('Pool')

export function decodePool(data) {
  if (!data || !data.subarray(0, 8).equals(POOL_DISC)) throw new Error('not a Pool account')
  let o = 8
  const pk = () => { const p = new PublicKey(data.subarray(o, o + 32)); o += 32; return p }
  const rU64 = () => { const v = data.readBigUInt64LE(o); o += 8; return v }
  const rU16 = () => { const v = data.readUInt16LE(o); o += 2; return v }
  const rU8 = () => { const v = data.readUInt8(o); o += 1; return v }
  return {
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
    airdropShareBps: data.length >= 192 ? rU16() : 0,
    airdropSol: data.length >= 192 ? rU64() : 0n,
  }
}

export const poolDiscFilter = () => ({ memcmp: { offset: 0, bytes: 'hQrXeCntzbV' } })

/* ---------- curve quotes (mirror of on-chain math, for UI) ---------- */

export function quoteBuy(pool, solIn) {
  const fee = (solIn * BigInt(pool.feeBps)) / 10000n
  const net = solIn - fee
  const y = pool.virtualSol + pool.realSol
  const out = (pool.tokenReserve * net) / (y + net)
  return { tokensOut: out, fee }
}

export function quoteSell(pool, tokensIn) {
  const y = pool.virtualSol + pool.realSol
  const gross = (y * tokensIn) / (pool.tokenReserve + tokensIn)
  const floorOk = gross <= pool.realSol
  const fee = (gross * BigInt(pool.feeBps)) / 10000n
  return { solOut: gross - fee, gross, fee, floorOk }
}
