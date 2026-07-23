// Full launch WITH on-chain metadata, on devnet. Verifies tx size fits one
// transaction and the metadata account holds the right name/symbol.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection, Keypair, SystemProgram, Transaction, ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction, createMintToInstruction,
  createSetAuthorityInstruction, AuthorityType, getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token'
import { ixCreatePool, poolPda } from './infinity.mjs'
import { ixCreateMetadata, metadataPda } from './metadata.mjs'

const conn = new Connection(process.env.RPC || 'https://api.devnet.solana.com', 'confirmed')
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))))
const DEC = 6
const SUPPLY = 1_000_000_000n * 10n ** BigInt(DEC)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${m}`) }

async function main() {
  const mintKp = Keypair.generate()
  const mint = mintKp.publicKey
  const rent = await getMinimumBalanceForRentExemptMint(conn)
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID)
  const NAME = 'Infinity Test Coin'
  const SYMBOL = 'INFT'
  console.log('metadata launch test — mint', mint.toBase58())

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    SystemProgram.createAccount({ fromPubkey: wallet.publicKey, newAccountPubkey: mint, space: MINT_SIZE, lamports: rent, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint, DEC, wallet.publicKey, null, TOKEN_PROGRAM_ID),
    ixCreateMetadata({ mint, mintAuthority: wallet.publicKey, payer: wallet.publicKey, updateAuthority: wallet.publicKey, name: NAME, symbol: SYMBOL, uri: '' }),
    createAssociatedTokenAccountInstruction(wallet.publicKey, ata, wallet.publicKey, mint, TOKEN_PROGRAM_ID),
    createMintToInstruction(mint, ata, wallet.publicKey, SUPPLY, [], TOKEN_PROGRAM_ID),
    createSetAuthorityInstruction(mint, wallet.publicKey, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID),
    ixCreatePool({ creator: wallet.publicKey, mint, tokenAmount: SUPPLY, tier: 1, feeBps: 100, creatorShareBps: 5000, sniperGuard: true }).ix
  )
  tx.feePayer = wallet.publicKey
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
  const size = tx.serializeMessage().length
  console.log(`   tx message size: ${size} bytes (limit 1232)`)
  ok(size <= 1232, 'launch+metadata fits in one transaction')

  const sig = await sendAndConfirmTransaction(conn, tx, [wallet, mintKp], { commitment: 'confirmed' })
  console.log('   tx', sig)

  // read the metadata account and check the name is embedded
  const md = await conn.getAccountInfo(metadataPda(mint))
  ok(!!md, 'metadata account created')
  const raw = md.data.toString('utf8')
  ok(raw.includes(NAME), `metadata contains name "${NAME}"`)
  ok(raw.includes(SYMBOL), `metadata contains symbol "${SYMBOL}"`)
  ok(!!(await conn.getAccountInfo(poolPda(mint))), 'pool created in same tx')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
