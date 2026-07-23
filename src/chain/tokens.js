import { PublicKey } from '@solana/web3.js'
import {
  getMint, getTokenMetadata, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import { metadataPda, decodeMetadata } from './metadata.js'
import { SOL_MINT } from './jupiter.js'

// Popular tokens as quick-picks (mainnet). decimals + logos are fixed and known (verified via Jupiter).
export const CURATED = [
  { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, native: true, color: '#14F195' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, color: '#2775CA', logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, color: '#26A17B', logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, color: '#C7F284', logo: 'https://static.jup.ag/jup/icon.png' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, color: '#F5A623', logo: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat', decimals: 6, color: '#8B5A2B', logo: 'https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link' },
]

export const isSol = (mint) => mint === SOL_MINT

/** Resolve any mint to a usable token: decimals, token program, name/symbol/image. */
export async function resolveToken(connection, mintStr) {
  if (isSol(mintStr)) return CURATED[0]
  const known = CURATED.find((t) => t.mint === mintStr)
  const mint = new PublicKey(mintStr)
  const acc = await connection.getAccountInfo(mint)
  if (!acc) throw new Error('token not found')
  const tokenProgram = acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  const mi = await getMint(connection, mint, undefined, tokenProgram)

  let name = known?.name || '', symbol = known?.symbol || '', image = ''
  let description = '', website = '', twitter = '', telegram = ''
  try {
    let uri = ''
    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      const tm = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
      if (tm) { name = tm.name; symbol = tm.symbol; uri = tm.uri || '' }
    } else {
      const md = await connection.getAccountInfo(metadataPda(mint))
      if (md) { const d = decodeMetadata(md.data); name = d.name; symbol = d.symbol; uri = d.uri || '' }
    }
    if (uri) {
      const j = await fetch(uri).then((r) => r.json()).catch(() => null)
      if (j) {
        image = j.image || ''
        description = j.description || ''
        website = j.extensions?.website || j.external_url || ''
        twitter = j.extensions?.twitter || ''
        telegram = j.extensions?.telegram || ''
      }
    }
  } catch { /* no metadata */ }

  return {
    mint: mintStr,
    symbol: symbol || `${mintStr.slice(0, 4)}`,
    name: name || 'Token',
    decimals: mi.decimals,
    supply: mi.supply,
    tokenProgram,
    image: image || known?.logo || '',
    color: known?.color,
    description, website, twitter, telegram,
  }
}
