# INFINITY — Protocol Specification v0.1

**One-sided liquidity. Zero protocol fees. 100% of fees to the dev and the holders.**

A DEX/AMM on Solana where a pool is created by depositing **only the token** — no SOL, no
pairing, no LP management — and where the protocol takes **nothing**: every fee generated
by trading is split between the token's creator and its holders.

---

## 1. Design principles

1. **One-sided by construction.** The SOL side of every pool is bootstrapped virtually.
   Nobody ever needs to bring quote liquidity.
2. **Zero protocol fee, hardcoded.** Not a config value that could be raised later — the
   program has no protocol fee account and no code path that routes value to the protocol.
   This is the moat and the marketing.
3. **Liquidity is permanent.** Deposited tokens can never be withdrawn; real SOL in the
   pool belongs to the curve (it backs sellers' exits). There are **no LP tokens and no
   withdraw instruction** — the entire rug surface of Raydium/Heaven Pro Pools is deleted.
   The creator is paid with a fee stream, not with pool ownership.
4. **Holders are paid without claims.** The holders' fee share is auto-compounded via
   buyback-and-burn on the pool's own curve. No staking, no snapshots, no merkle drops,
   no unclaimed-balance liability. Holding the token *is* the claim.
5. **Standardized, minimal surface.** Few instructions, standardized virtual-SOL tiers,
   bounded fees. (Heaven's thesis is right: one good parameter set beats infinite knobs.)

## 2. The curve — CPMM with a virtual SOL floor

Constant-product AMM over reserves `(x, y)`:

```
x = token reserve (real tokens in the pool vault)
y = S + V        where  S = real SOL (lamports held by the pool)
                        V = virtual SOL (a number in pool state, never payable)
invariant: x * y = k
```

- **Pool creation** deposits `x₀` tokens and sets `S = 0`, `V = tier value`.
  Opening price = `V / x₀`.
- **Buy** (SOL → token): fee is taken from `sol_in`, the net amount enters the curve,
  tokens out by constant product. `S` increases.
- **Sell** (token → SOL): tokens enter the curve, `sol_out` by constant product, fee is
  taken from `sol_out`. **Reverts if `sol_out > S`** — you can never sell into virtual
  SOL. This is the price floor: the pool can only pay out real SOL that buyers put in.
- All math in u128, rounding always against the trader.

Why it's safe: `S = y − V` and sells are the only outflow, checked against `S`. By CPMM
path-independence the pool can never owe more SOL than it received (fees only add margin).

**Virtual SOL tiers** (standardized, chosen at creation, immutable):

| Tier | V | Opening feel |
|------|-----|--------------|
| I    | 10 SOL | micro / experiment |
| II   | 35 SOL | default (Heaven-calibrated) |
| III  | 100 SOL | established community listing existing token |
| IV   | 500 SOL | large project |

Tier + deposited token amount fully determine the opening price and depth. The UI shows
the implied opening market cap before the creator signs.

Works identically for a **brand-new token** (mint in the same client-side tx bundle) and
an **existing SPL / Token-2022 token** (a community lists its token by throwing supply
in). This is the gap Heaven left open: their one-sided model exists only for tokens they
mint; ours works for anything. One pool per mint.

## 3. Fees — 0% protocol, creator ⇄ holders split

Set at pool creation by the creator, within bounds:

```
fee_bps           total swap fee, 0..=1000        (0% – 10%, default 100 = 1%)
creator_share_bps creator's cut of the fee, 0..=10000 (default 5000 = 50/50)
```

- Fees are always assessed **on the SOL side** (on `sol_in` for buys, on `sol_out` for
  sells) so both fee buckets accrue in SOL — no token-denominated dust.
- `creator_fees` (lamports) accrue in pool state → claimable any time, partially or
  fully, by the **fee receiver** (initially the creator; transferable with dual
  signature, current + new — Heaven's pattern, it's correct).
- `flywheel_sol` (the holders' share) accrues in pool state until cranked (§4).
- The creator may later **lower** `fee_bps` or shift the split **toward holders** —
  never the reverse. Rugging by fee-hike is structurally impossible.
- **There is no third bucket.** Protocol fee = 0 is not a parameter; the struct doesn't
  contain one.

## 4. The flywheel — holders' share as buyback-and-burn

A permissionless `crank_flywheel` instruction:

1. Takes `flywheel_sol` accumulated in the pool.
2. Buys the token **on the pool's own curve** (fee-exempt, as real SOL entering `S`).
3. **Burns** the tokens bought (pool PDA signs the burn from its vault).

Effects: `S` rises, `x` falls → spot price and the floor both ratchet up. Every trade
makes the token more scarce and the floor higher. "100% of fees go to holders" is
delivered as automatic, trustless value accrual — nothing to claim, nothing to forget,
no account rent per holder.

Crank rules:
- Callable by anyone (bots, us, the creator); a tiny caller incentive (e.g. 0.5% of the
  cranked amount, paid in SOL) makes the ecosystem self-cranking.
- Per-crank cap (e.g. max 1% of `S` per crank) + the buy executes at curve price with no
  slippage parameter → sandwiching a crank is unprofitable by construction (the burn
  raises the price permanently; the MEV "profit" is donated to holders).
- Emits an event with SOL spent / tokens burned → public buyback feed per token
  (Heaven ships this as an API; we ship it as indexable events from day 1).

## 5. Program design (Anchor)

**Accounts**

```
Config  (PDA ["config"])            admin, paused, tier table, fee bounds, crank params
Pool    (PDA ["pool", mint])        mint, token_vault, bump,
                                    virtual_sol: u64, real_sol: u64,
                                    fee_bps: u16, creator_share_bps: u16,
                                    fee_receiver: Pubkey,
                                    creator_fees: u64, flywheel_sol: u64,
                                    total_burned: u64, created_at_slot: u64,
                                    cumulative_volume_sol: u64
```

SOL is held as native lamports on the Pool PDA (no wSOL wrapping — one less account,
one less failure mode). Token vault is an ATA owned by the Pool PDA (supports SPL and
Token-2022; transfer-fee/hook extensions rejected at creation via extension whitelist).

**Instructions**

| ix | signer | notes |
|----|--------|-------|
| `create_pool(amount, tier, fee_bps, creator_share_bps)` | creator | transfers tokens in, permanent; validates mint extensions, one pool per mint |
| `buy(max_sol_in, min_tokens_out)` | trader | slippage-guarded |
| `sell(tokens_in, min_sol_out)` | trader | reverts if payout > real SOL |
| `claim_creator_fees(amount)` | fee receiver | partial claims OK |
| `crank_flywheel()` | anyone | buyback + burn + caller tip |
| `reduce_fees(fee_bps?, creator_share_bps?)` | creator | monotonic: only down / toward holders |
| `transfer_fee_receiver(new)` | current + new | dual signature |

**Events**: `PoolCreated`, `Swap{side, sol, tokens, price, fee_creator, fee_flywheel}`,
`FlywheelCrank{sol_in, tokens_burned}`, `CreatorClaim`. These four events are the entire
indexing surface for the UI (ticker, charts, buyback feed).

**Explicitly out of v1** (yagni until proven needed): LP positions of any kind,
post-creation one-sided top-ups (changes price or dilutes the floor — needs its own
analysis), slot-based sniper tax (v2: route first-N-slots fees 100% to flywheel so
snipers pay holders), oracle/USD fee brackets, permissioned classification.

## 6. Where Infinity itself earns

Nowhere in the protocol — that's the point. The play is Heaven's own logic taken to its
conclusion: launch **$INF through Infinity**, with its fee split set toward the flywheel.
The team holds $INF and earns exactly like every other creator on the platform. "We eat
our own dog food" is the entire business model, and it's only credible because the
protocol fee is provably zero on-chain.

## 7. Build & rollout plan

1. **M1 — Program**: Anchor workspace, curve math + unit tests (floor invariant,
   rounding, fee accrual), the 7 instructions above. ⚠️ Build on the VM (Anchor doesn't
   build on this Windows box), deploy devnet.
2. **M2 — SDK + UI wiring**: tiny TS SDK (quote/buy/sell/create from IDL), wallet
   adapter in the existing front, real pool data behind the deposit panel / stats /
   ticker, event-driven buyback feed.
3. **M3 — Launch**: security pass (overflow, PDA seeds, token-2022 extensions,
   crank griefing), mainnet deploy, $INF genesis pool as the first pool.

---

*Reference: Heaven (docs.heaven.xyz) — virtual-SOL floor and fee-receiver handover
patterns adopted; closed AMM, protocol fee, and paired Pro-Pool deposits deliberately
rejected. Raydium/PumpSwap fee benchmarks: 0.25% / 0.05% protocol take — Infinity: 0.*
