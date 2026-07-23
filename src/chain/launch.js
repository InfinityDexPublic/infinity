// Full token launch: mint a new SPL token, mint the whole supply to the
// creator, freeze the supply (revoke mint authority), and open a
// one-sided Infinity pool — in a single transaction the creator signs.

import {
  Keypair, SystemProgram, Transaction, ComputeBudgetProgram,
} from '@solana/web3.js'
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction, createMintToInstruction,
  createSetAuthorityInstruction, AuthorityType,
  getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token'
import { ixCreatePool, ixBuy, poolPda } from './infinity.js'
import { ixCreateMetadata } from './metadata.js'
import { INDEXER_API } from './config.js'

/** Claim a pre-ground vanity mint keypair (…infi) from the stock. */
export async function nextVanityMint() {
  try {
    const r = await fetch(`${INDEXER_API}/mint/next`)
    if (!r.ok) return null
    const { secretKey } = await r.json()
    return Keypair.fromSecretKey(Uint8Array.from(secretKey))
  } catch { return null }
}

/** Upload token image + fields; returns a hosted Metaplex metadata URI. */
export async function uploadTokenMetadata({ name, symbol, description, image, website, twitter, telegram }) {
  const r = await fetch(`${INDEXER_API}/meta/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, symbol, description, image, website, twitter, telegram }),
  })
  if (!r.ok) throw new Error('metadata upload failed')
  return r.json() // { uri, image }
}

export const LAUNCH_DECIMALS = 6
export const LAUNCH_SUPPLY = 1_000_000_000n * 10n ** BigInt(LAUNCH_DECIMALS) // 1B

/**
 * Mint + on-chain metadata (name/symbol/uri) + full supply + frozen authority
 * + one-sided pool, all in a single transaction (fits well under 1232 bytes).
 * @param mintKeypair optional pre-ground vanity keypair (…infi). Random if absent.
 * @returns { tx, signers, mint, pool }
 */
export async function buildLaunchTx({
  connection, creator, tier, feeBps, creatorShareBps, sniperGuard = true,
  airdropShareBps = 0, devBuySol = 0, name = '', symbol = '', uri = '', mintKeypair,
}) {
  // vanity …infi mint from the stock, else a random one (launch never blocks)
  const mintKp = mintKeypair ?? (await nextVanityMint()) ?? Keypair.generate()
  const mint = mintKp.publicKey
  const [rent, { blockhash, lastValidBlockHeight }] = await Promise.all([
    getMinimumBalanceForRentExemptMint(connection),
    connection.getLatestBlockhash('confirmed'),
  ])
  const creatorAta = getAssociatedTokenAddressSync(mint, creator, false, TOKEN_PROGRAM_ID)

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    // 1. allocate + init the mint (creator is temp mint authority, no freeze authority)
    SystemProgram.createAccount({
      fromPubkey: creator, newAccountPubkey: mint, space: MINT_SIZE, lamports: rent, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint, LAUNCH_DECIMALS, creator, null, TOKEN_PROGRAM_ID),
    // 2. on-chain metadata (creator is still mint authority here) → named in wallets
    ixCreateMetadata({ mint, mintAuthority: creator, payer: creator, updateAuthority: creator, name, symbol, uri }),
    // 3. creator ATA + mint the whole supply to it
    createAssociatedTokenAccountInstruction(creator, creatorAta, creator, mint, TOKEN_PROGRAM_ID),
    createMintToInstruction(mint, creatorAta, creator, LAUNCH_SUPPLY, [], TOKEN_PROGRAM_ID),
    // 4. freeze supply forever (no more minting — unruggable supply)
    createSetAuthorityInstruction(mint, creator, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID),
    // 5. open the one-sided pool with the full supply
    ixCreatePool({ creator, mint, tokenAmount: LAUNCH_SUPPLY, tier, feeBps, creatorShareBps, sniperGuard, airdropShareBps })
  )
  // 6. optional dev buy: the creator buys the first tokens in the SAME tx,
  // atomically at the opening price before anyone else can trade.
  if (devBuySol > 0) {
    tx.add(ixBuy({ trader: creator, mint, solIn: Math.floor(devBuySol * 1e9), minTokensOut: 0, tokenProgram: TOKEN_PROGRAM_ID }))
  }
  tx.feePayer = creator
  // set the blockhash now so it's the SAME one used to confirm — avoids a
  // second fetch that can drift and make confirmation expire early on mobile.
  tx.recentBlockhash = blockhash
  return { tx, signers: [mintKp], mint, pool: poolPda(mint), blockhash, lastValidBlockHeight }
}
