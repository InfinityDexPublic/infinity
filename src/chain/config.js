import { PublicKey } from '@solana/web3.js'

// All network config is env-driven so devnet ↔ mainnet is a build-mode flip,
// never a code change. Defaults target devnet. Mainnet values live in
// .env.mainnet (gitignored — holds the paid RPC key) and load with
// `npm run dev:mainnet` / `npm run build:mainnet`.
export const CLUSTER = import.meta.env.VITE_CLUSTER || 'devnet'
export const RPC_ENDPOINT = import.meta.env.VITE_RPC || 'https://api.devnet.solana.com'
export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID || 'MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi'
)

const explorerSuffix = CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`
export const EXPLORER = (sig) => `https://explorer.solana.com/tx/${sig}${explorerSuffix}`
export const EXPLORER_ADDR = (a) => `https://explorer.solana.com/address/${a}${explorerSuffix}`

// Event indexer + metadata host. Override with VITE_INDEXER.
export const INDEXER_API = import.meta.env.VITE_INDEXER || 'https://api.infinitydex.pro'

// Pools hidden from the UI (internal test pools, etc.).
export const HIDDEN_POOLS = new Set([
  '8tGdreiSdVcm5rYw35d9KaWLaeqThm9Fz23UTHGSfu6y',
])
