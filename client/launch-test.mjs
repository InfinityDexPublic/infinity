// Verify the one-transaction launch flow on devnet.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, SystemProgram, Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction, createMintToInstruction,
  createSetAuthorityInstruction, AuthorityType, getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint, getMint,
} from '@solana/spl-token'
import { ixCreatePool, poolPda, decodePool } from './infinity.mjs'

const conn = new Connection(process.env.RPC || 'https://api.devnet.solana.com', 'confirmed')
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))))
const DEC = 6
const SUPPLY = 1_000_000_000n * 10n ** BigInt(DEC)

async function main() {
  const mintKp = Keypair.generate()
  const mint = mintKp.publicKey
  const rent = await getMinimumBalanceForRentExemptMint(conn)
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID)
  console.log('launch test — mint', mint.toBase58())

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    SystemProgram.createAccount({ fromPubkey: wallet.publicKey, newAccountPubkey: mint, space: MINT_SIZE, lamports: rent, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint, DEC, wallet.publicKey, null, TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(wallet.publicKey, ata, wallet.publicKey, mint, TOKEN_PROGRAM_ID),
    createMintToInstruction(mint, ata, wallet.publicKey, SUPPLY, [], TOKEN_PROGRAM_ID),
    createSetAuthorityInstruction(mint, wallet.publicKey, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID),
    ixCreatePool({ creator: wallet.publicKey, mint, tokenAmount: SUPPLY, tier: 1, feeBps: 100, creatorShareBps: 5000, sniperGuard: false }).ix
  )
  const { sendAndConfirmTransaction } = await import('@solana/web3.js')
  const sig = await sendAndConfirmTransaction(conn, tx, [wallet, mintKp], { commitment: 'confirmed' })

  const info = await conn.getAccountInfo(poolPda(mint))
  const p = decodePool(info.data)
  const mi = await getMint(conn, mint)
  let pass = 0, fail = 0
  const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${m}`) }
  ok(p.tokenReserve === SUPPLY, 'pool holds full supply')
  ok(p.virtualSol === BigInt(35 * LAMPORTS_PER_SOL), 'virtual floor 35 SOL')
  ok(mi.mintAuthority === null, 'mint authority revoked (supply frozen)')
  ok(mi.supply === SUPPLY, 'supply = 1B')
  console.log(`\n${pass} passed, ${fail} failed`)
  console.log('tx', sig)
  console.log('pool', poolPda(mint).toBase58())
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
