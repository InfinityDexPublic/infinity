// Hand-built Metaplex Token Metadata CreateMetadataAccountV3 instruction
// (no umi dependency). Sets on-chain name / symbol / uri for a mint.
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

const borshStr = (s) => {
  const b = Buffer.from(s ?? '', 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(b.length)
  return Buffer.concat([len, b])
}
const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }

export function metadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  )[0]
}

export function ixCreateMetadata({ mint, mintAuthority, payer, updateAuthority, name, symbol, uri = '' }) {
  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3 discriminant
    borshStr(name.slice(0, 32)),
    borshStr(symbol.slice(0, 10)),
    borshStr(uri.slice(0, 200)),
    u16le(0),          // seller_fee_basis_points
    Buffer.from([0]),  // creators: None
    Buffer.from([0]),  // collection: None
    Buffer.from([0]),  // uses: None
    Buffer.from([1]),  // is_mutable: true
    Buffer.from([0]),  // collection_details: None
  ])
  const keys = [
    { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: mintAuthority, isSigner: true, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: updateAuthority, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]
  return new TransactionInstruction({ programId: TOKEN_METADATA_PROGRAM_ID, keys, data })
}
