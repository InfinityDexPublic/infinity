<div align="center">

<img src="./public/logo.png" width="170" alt="Infinity" />

# ∞ INFINITY

### The zero-fee, one-sided AMM &amp; launchpad on Solana

Launch or list any token with **only the token** — no SOL pairing, permanent liquidity,
and a **0% protocol fee**. 100% of every swap fee goes to the creator and the holders.

[![site](https://img.shields.io/badge/app-infinitydex.pro-7B2BFF?style=flat-square)](https://www.infinitydex.pro)
[![x](https://img.shields.io/badge/X-@infinitydex__pro-00F0FF?style=flat-square)](https://x.com/infinitydex_pro)
[![network](https://img.shields.io/badge/Solana-mainnet--beta-14F195?style=flat-square)](https://solscan.io/account/MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi)
[![license](https://img.shields.io/badge/license-MIT-888?style=flat-square)](#license)

</div>

---

## Contents

- [What is Infinity](#what-is-infinity)
- [How it compares](#how-it-compares)
- [How it works](#how-it-works)
  - [One-sided pools &amp; the virtual SOL floor](#one-sided-pools--the-virtual-sol-floor)
  - [Permanent, unruggable liquidity](#permanent-unruggable-liquidity)
  - [Fees: 0% protocol, 100% to creator &amp; holders](#fees-0-protocol-100-to-creator--holders)
  - [The buyback-and-burn flywheel](#the-buyback-and-burn-flywheel)
  - [Anti-sniper guard](#anti-sniper-guard)
  - [Vanity mints](#vanity-mints)
- [Opening market-cap tiers](#opening-market-cap-tiers)
- [On-chain program](#on-chain-program)
- [Repository layout](#repository-layout)
- [Running locally](#running-locally)
- [Security](#security)
- [Roadmap](#roadmap)
- [Disclaimer](#disclaimer) · [License](#license)

## What is Infinity

Most launchpads are a thin wrapper on someone else's AMM, take a cut of every trade for their
own token, and let liquidity be pulled. Infinity is a **self-contained AMM + launchpad** built
from scratch around three ideas:

1. **You launch with nothing but your token.** The SOL side of a pool is *virtual* at creation,
   so a creator never has to bring paired liquidity. Trading is live the instant the pool exists.
2. **The protocol takes 0%.** There is no protocol fee account in the program — "we take nothing"
   is provable on-chain, not a promise. Every fee flows to the token's creator and its holders.
3. **Liquidity is permanent.** No LP tokens, no withdraw instruction. The rug surface that every
   paired AMM carries simply does not exist.

## How it compares

| | **Infinity** | Typical launchpad / AMM |
|---|---|---|
| Protocol fee | **0.00%** (hardcoded) | 0.25% – 1%+ |
| SOL needed to launch | **0** — token only | full paired side |
| Where fees go | **100%** → creator + holders | protocol / its token |
| Liquidity | **permanent, unruggable** | can be pulled |
| Graduation / migration | **none** — one venue forever | bonding curve → external DEX |
| Sniper protection | optional, **100% → holders** | usually none |
| Mint address | ends in **`infi`** | random |

## How it works

### One-sided pools &amp; the virtual SOL floor

A pool is a constant-product market (`x · y = k`) over two reserves: the token (`x`) and SOL
(`y = virtual_sol + real_sol`). At creation the creator deposits **only tokens**; the SOL side
is seeded with a chosen **virtual** amount (a tier). Because the whole supply is deposited, the
opening fully-diluted market cap equals the virtual SOL amount.

- **Buy** — SOL in, tokens out along the curve; `real_sol` grows.
- **Sell** — tokens in, SOL out — but **only real SOL is ever payable**. A sell that would dip
  into the virtual floor reverts. So the pool can never owe more SOL than buyers actually put in.

All curve math is `u128` integer, rounds against the trader, and the floor invariant is
fuzz-tested over 200k randomized trades.

### Permanent, unruggable liquidity

There are **no LP tokens** and **no withdraw instruction**. Deposited liquidity is locked
forever by design. The creator is paid through a **fee stream**, not pool ownership — so there is
nothing to pull, disable, or drain.

### Fees: 0% protocol, 100% to creator &amp; holders

Each swap charges a creator-chosen fee (`0`–`10%`, default `1%`), split between the creator and
the holders (default `50/50`). The split and fee can only ever be **lowered** or shifted
**toward holders** — never raised. There is **no protocol bucket**.

| Bucket | Who | How it's paid |
|---|---|---|
| Protocol | — | **0.00%, always** |
| Creator | token creator (fee receiver) | accrues in SOL, claim anytime |
| Holders | every holder | buyback &amp; burn on the curve |

### The buyback-and-burn flywheel

The holders' share accrues in SOL, then a **permissionless crank** spends it buying the token on
its own curve (fee-exempt) and **burns** what it buys. Price and floor ratchet up on every trade.
The crank pays its caller a small tip, is rate-limited, and caps its per-call price impact so it
can't be sandwiched profitably.

### Anti-sniper guard

Launches can opt into a decaying opening tax — **50% → 0% over the first ~6 seconds** (15 slots),
on buys only — routed **100% to the flywheel**. Snipers who front-run a launch end up paying the
holders. It is chosen at launch and immutable, so a creator can't disable it mid-window.

### Vanity mints

Every token launched through Infinity gets a mint address ending in **`infi`** — instantly
recognizable as an Infinity launch, the way pump.fun mints end in `pump`.

## Opening market-cap tiers

| Tier | Virtual SOL | Feel |
|---|---|---|
| SPARK | 10 | micro / experiment |
| ORBIT | 35 | the standard |
| NOVA | 100 | community listing |
| SUPERNOVA | 500 | large project |

Higher tier = higher opening market cap and deeper price (more SOL to move it). It does not create
withdrawable liquidity — real exit liquidity always comes from buyers.

## On-chain program

**Program (mainnet-beta):** [`MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi`](https://solscan.io/account/MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi) — Anchor, upgradeable.

| Instruction | Signer | Purpose |
|---|---|---|
| `create_pool` | creator | deposit tokens, open a one-sided pool (tier, fee, 3-way split, guard) |
| `buy` | trader | SOL → token, slippage-guarded |
| `sell` | trader | token → SOL, reverts past the real-SOL floor |
| `crank_flywheel` | anyone | buyback + burn the holders' burn share; caller tip |
| `crank_airdrop` | keeper | pay accrued airdrop SOL pro-rata to holders (bounded by the accrued bucket) |
| `claim_creator_fees` | fee receiver | withdraw accrued creator fees (SOL) |
| `reduce_fees` | fee receiver | monotonic: lower fee / shift toward holders only |
| `transfer_fee_receiver` | both | dual-signature handover of the fee stream |
| `migrate_pool` | anyone | one-time V1→V2 layout extension (zeroed airdrop fields) |

Every swap fee is split three ways, fixed at launch: **creator fee**, **buyback & burn**, and **holders airdrop** (SOL paid straight to holders' wallets by the keeper, capped on-chain by the accrued airdrop bucket).

Guarantees enforced on-chain: **0% protocol fee**, **value conservation** (a pool never pays out
more SOL than it holds), **permanent liquidity**, and rejection of Token-2022 mints whose
extensions could tax, hook, freeze or seize balances.

## Repository layout

```
program/    Anchor program (Rust) — the AMM: curve.rs + 7 instructions, unit + fuzz tests
src/        Front-end (Vite + React 19 + three.js / R3F) — the mouse-reactive 3D infinity UI,
            5 zones (home / launch / pools / swap / claim) + a full Docs page
client/     JS SDK, devnet + mainnet smoke tests, the flywheel cranker, and the event indexer
            (SQLite + HTTP: live pools, burns feed, SOL price, token-metadata hosting, vanity stock)
design/     Design mockups
SPEC.md     Full protocol specification
```

## Running locally

```bash
# front-end
npm install
npm run dev            # http://localhost:5199  (devnet defaults)
```

Network config is env-driven — set your own RPC; nothing secret lives in the repo:

```
VITE_CLUSTER=mainnet-beta
VITE_RPC=<your RPC endpoint>
VITE_PROGRAM_ID=MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi
VITE_INDEXER=<your indexer url>
```

```bash
# program (Solana toolchain)
cd program && cargo build-sbf

# SDK / on-chain smoke test (see client/)
cd client && npm install && node smoke.mjs      # full cycle on devnet
```

## Security

- The program passed a **multi-lens security audit — 0 critical, 0 high** — before going live.
- Core guarantees are structural (no fee account, no withdraw path) and **fuzz-tested**.
- The full launch (mint + metadata + supply + frozen mint authority + pool) is a **single
  transaction**; the mint authority is revoked so supply is fixed.

## Roadmap

- [x] Mainnet program + live app
- [x] One-sided launch, swap, claim, flywheel crank
- [x] On-chain Metaplex metadata, image + links, vanity `…infi` mints
- [x] Anti-sniper guard, live indexer &amp; buyback feed

## Disclaimer

Infinity is experimental DeFi software. Trading and launching tokens carries risk, including
total loss. Nothing here is financial advice. Use at your own risk.

## License

MIT
