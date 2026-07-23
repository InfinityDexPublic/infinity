// Infinity indexer — subscribes to program logs, decodes emitted events,
// stores them in SQLite, and serves them over HTTP (CORS) for the UI.
// Run in tmux on the VM. Node 22 (node:sqlite).

import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { Connection, PublicKey } from '@solana/web3.js'
import { PROGRAM_ID } from './infinity.mjs'

// token metadata + image hosting (Metaplex-standard JSON served over HTTPS)
const META_DIR = process.env.META_DIR || '/root/infinity/meta'
const IMG_DIR = process.env.IMG_DIR || '/root/infinity/img'
const META_BASE = process.env.META_BASE || 'https://api.infinitydex.pro'
mkdirSync(META_DIR, { recursive: true })
mkdirSync(IMG_DIR, { recursive: true })
const IMG_CT = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

// vanity mint stock: pre-ground keypairs ending in "infi", one consumed per
// launch (like pump.fun's "…pump" mints). The grinder refills the dir.
const MINT_DIR = process.env.MINT_DIR || '/root/infinity/vanity'
const MINT_USED = `${MINT_DIR}/used`
mkdirSync(MINT_USED, { recursive: true })
function claimVanityMint() {
  let files = []
  try { files = readdirSync(MINT_DIR).filter((f) => f.endsWith('infi.json')) } catch { return null }
  for (const f of files) {
    try {
      renameSync(`${MINT_DIR}/${f}`, `${MINT_USED}/${f}`) // atomic claim
      return JSON.parse(readFileSync(`${MINT_USED}/${f}`))
    } catch { /* raced — try next */ }
  }
  return null
}
function vanityStock() {
  try { return readdirSync(MINT_DIR).filter((f) => f.endsWith('infi.json')).length } catch { return 0 }
}

const RPC = process.env.RPC || 'https://api.devnet.solana.com'
const PORT = Number(process.env.PORT || 8098)
const conn = new Connection(RPC, 'confirmed')

const EVENT_DISC = {
  ca2c295868dc9d52: 'PoolCreated',
  '516ce3becdd00ac4': 'Swap',
  '370d45524bd9ccbd': 'FlywheelCrank',
  b53718cd7bf6b88c: 'CreatorClaim',
  '7011151e45babe6d': 'AirdropPayout',
}

const db = new DatabaseSync(process.env.DB || '/root/infinity/indexer.db')
db.exec(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sig TEXT, slot INTEGER, ts INTEGER, kind TEXT, pool TEXT, mint TEXT, data TEXT,
  UNIQUE(sig, kind, data)
)`)
const insert = db.prepare('INSERT OR IGNORE INTO events (sig,slot,ts,kind,pool,mint,data) VALUES (?,?,?,?,?,?,?)')

/* ---- borsh readers ---- */
function reader(buf) {
  let o = 0
  return {
    pk: () => { const p = new PublicKey(buf.subarray(o, o + 32)).toBase58(); o += 32; return p },
    u64: () => { const v = buf.readBigUInt64LE(o); o += 8; return v.toString() },
    u16: () => { const v = buf.readUInt16LE(o); o += 2; return v },
    bool: () => { const v = buf.readUInt8(o) === 1; o += 1; return v },
  }
}

function decodeEvent(b64) {
  const buf = Buffer.from(b64, 'base64')
  const disc = buf.subarray(0, 8).toString('hex')
  const kind = EVENT_DISC[disc]
  if (!kind) return null
  const body = buf.subarray(8)
  const r = reader(body)
  if (kind === 'Swap') {
    const ev = { kind, pool: r.pk(), trader: r.pk(), isBuy: r.bool(), solAmount: r.u64(), tokenAmount: r.u64(), feeCreator: r.u64(), feeFlywheel: r.u64(), realSol: r.u64(), tokenReserve: r.u64() }
    ev.feeAirdrop = body.length >= 121 ? r.u64() : '0' // V2 appends fee_airdrop
    return ev
  }
  if (kind === 'FlywheelCrank') {
    return { kind, pool: r.pk(), caller: r.pk(), solIn: r.u64(), tokensBurned: r.u64(), tip: r.u64(), realSol: r.u64(), tokenReserve: r.u64() }
  }
  if (kind === 'PoolCreated') {
    const ev = { kind, pool: r.pk(), mint: r.pk(), creator: r.pk(), tokenAmount: r.u64(), virtualSol: r.u64(), feeBps: r.u16(), creatorShareBps: r.u16() }
    ev.airdropShareBps = body.length >= 118 ? r.u16() : 0 // V2 appends airdrop share
    return ev
  }
  if (kind === 'CreatorClaim') {
    return { kind, pool: r.pk(), receiver: r.pk(), amount: r.u64() }
  }
  if (kind === 'AirdropPayout') {
    return { kind, pool: r.pk(), total: r.u64(), recipients: r.u16() }
  }
  return null
}

function ingest(logs, slot, sig) {
  let ts = Math.floor(Date.now() / 1000)
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/)
    if (!m) continue
    const ev = decodeEvent(m[1].trim())
    if (!ev) continue
    insert.run(sig, slot, ts, ev.kind, ev.pool || null, ev.mint || null, JSON.stringify(ev))
    console.log(new Date().toISOString(), ev.kind, ev.pool?.slice(0, 8))
  }
}

// live subscription
conn.onLogs(PROGRAM_ID, (l, ctx) => {
  if (l.err) return
  try { ingest(l.logs, ctx.slot, l.signature) } catch (e) { console.error('ingest', e.message) }
}, 'confirmed')

// light backfill on boot
;(async () => {
  try {
    const sigs = await conn.getSignaturesForAddress(PROGRAM_ID, { limit: 40 })
    for (const s of sigs.reverse()) {
      const tx = await conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      if (tx?.meta?.logMessages) ingest(tx.meta.logMessages, tx.slot, s.signature)
      await new Promise((r) => setTimeout(r, 250))
    }
    console.log('backfill done')
  } catch (e) { console.error('backfill', e.message) }
})()

/* ---- live SOL price (server-side, cached 60s) ---- */
let solPrice = { usd: 0, at: 0 }
async function getSolPrice() {
  if (Date.now() - solPrice.at < 60_000 && solPrice.usd) return solPrice.usd
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
    const j = await r.json()
    if (j?.solana?.usd) solPrice = { usd: j.solana.usd, at: Date.now() }
  } catch { /* keep last */ }
  return solPrice.usd
}
getSolPrice()

/* ---- HTTP API ---- */
const q = {
  feed: db.prepare("SELECT * FROM events WHERE kind IN ('Swap','FlywheelCrank','AirdropPayout') ORDER BY id DESC LIMIT ?"),
  burns: db.prepare("SELECT * FROM events WHERE kind='FlywheelCrank' ORDER BY id DESC LIMIT ?"),
  airdrops: db.prepare("SELECT * FROM events WHERE kind='AirdropPayout' ORDER BY id DESC LIMIT ?"),
  poolTrades: db.prepare("SELECT * FROM events WHERE kind IN ('Swap','FlywheelCrank','AirdropPayout') AND pool=? ORDER BY id ASC LIMIT 800"),
  stats: db.prepare("SELECT kind, COUNT(*) c FROM events GROUP BY kind"),
}
const rows = (r) => r.map((e) => ({ ...e, data: JSON.parse(e.data) }))

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
  try {
    // serve a hosted token image
    const im = url.pathname.match(/^\/img\/([\w.-]+)$/)
    if (im && req.method === 'GET') {
      const f = `${IMG_DIR}/${im[1]}`
      if (!existsSync(f)) { res.statusCode = 404; return res.end('{}') }
      res.setHeader('Content-Type', IMG_CT[im[1].split('.').pop()] || 'application/octet-stream')
      res.setHeader('Cache-Control', 'public, max-age=31536000')
      return res.end(readFileSync(f))
    }
    // serve a token metadata JSON
    const mj = url.pathname.match(/^\/meta\/([\w-]+)$/)
    if (mj && req.method === 'GET' && mj[1] !== 'create') {
      const f = `${META_DIR}/${mj[1]}.json`
      if (!existsSync(f)) { res.statusCode = 404; return res.end('{}') }
      res.setHeader('Content-Type', 'application/json')
      return res.end(readFileSync(f))
    }
    // create token metadata (image dataURL + fields) → returns a hosted uri
    if (url.pathname === '/meta/create' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 3_000_000) req.destroy() })
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}')
          const id = randomBytes(8).toString('hex')
          let image = ''
          const m = typeof d.image === 'string' && d.image.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/)
          if (m) {
            const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
            writeFileSync(`${IMG_DIR}/${id}.${ext}`, Buffer.from(m[2], 'base64'))
            image = `${META_BASE}/img/${id}.${ext}`
          }
          const meta = {
            name: String(d.name || '').slice(0, 32),
            symbol: String(d.symbol || '').slice(0, 10),
            description: String(d.description || '').slice(0, 1000),
            image,
            extensions: {
              website: String(d.website || '').slice(0, 200),
              twitter: String(d.twitter || '').slice(0, 200),
              telegram: String(d.telegram || '').slice(0, 200),
            },
          }
          writeFileSync(`${META_DIR}/${id}.json`, JSON.stringify(meta))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ uri: `${META_BASE}/meta/${id}`, image }))
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: String(e.message || e) }))
        }
      })
      return
    }
    res.setHeader('Content-Type', 'application/json')
    // serve + consume a vanity …infi mint keypair for a launch
    if (url.pathname === '/mint/next') {
      const kp = claimVanityMint()
      if (!kp) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'out of stock' })) }
      return res.end(JSON.stringify({ secretKey: kp }))
    }
    if (url.pathname === '/mint/stock') return res.end(JSON.stringify({ stock: vanityStock() }))
    if (url.pathname === '/solprice') return getSolPrice().then((usd) => res.end(JSON.stringify({ usd })))
    if (url.pathname === '/feed') return res.end(JSON.stringify(rows(q.feed.all(Number(url.searchParams.get('limit') || 25)))))
    if (url.pathname === '/burns') return res.end(JSON.stringify(rows(q.burns.all(Number(url.searchParams.get('limit') || 20)))))
    if (url.pathname === '/airdrops') return res.end(JSON.stringify(rows(q.airdrops.all(Number(url.searchParams.get('limit') || 20)))))
    if (url.pathname === '/stats') return res.end(JSON.stringify(q.stats.all()))
    const pm = url.pathname.match(/^\/pool\/([^/]+)\/trades$/)
    if (pm) return res.end(JSON.stringify(rows(q.poolTrades.all(pm[1]))))
    res.statusCode = 404
    res.end('{}')
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message }))
  }
}).listen(PORT, () => console.log(`indexer http on :${PORT}`))
