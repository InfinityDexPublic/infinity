//! Constant-product curve with a virtual-SOL floor.
//!
//! Pure u128 integer math, no external dependencies — testable standalone
//! (`rustc --test curve.rs`). All rounding is against the trader:
//! outputs floor, fees ceil.
//!
//! Reserves: x = token reserve, y = virtual_sol + real_sol.
//! Sells may never withdraw more than real_sol (the floor invariant) —
//! that check lives in the instruction handler, which knows real_sol.

pub const BPS_DENOM: u128 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurveError {
    ZeroAmount,
    Overflow,
    ExceedsReserve,
}

/// Tokens out for a net SOL input: floor(x * in / (y + in)).
pub fn buy_out(token_reserve: u64, sol_reserve: u64, sol_in_net: u64) -> Result<u64, CurveError> {
    if sol_in_net == 0 {
        return Err(CurveError::ZeroAmount);
    }
    let x = token_reserve as u128;
    let y = sol_reserve as u128;
    let d = y.checked_add(sol_in_net as u128).ok_or(CurveError::Overflow)?;
    let out = x
        .checked_mul(sol_in_net as u128)
        .ok_or(CurveError::Overflow)?
        / d;
    if out >= x {
        // cannot empty the token side (d > in guarantees out < x unless x == 0)
        return Err(CurveError::ExceedsReserve);
    }
    Ok(out as u64)
}

/// Gross SOL out for a token input: floor(y * in / (x + in)).
/// Caller must verify the result against real_sol (floor invariant).
pub fn sell_gross(token_reserve: u64, sol_reserve: u64, tokens_in: u64) -> Result<u64, CurveError> {
    if tokens_in == 0 {
        return Err(CurveError::ZeroAmount);
    }
    let x = token_reserve as u128;
    let y = sol_reserve as u128;
    let d = x.checked_add(tokens_in as u128).ok_or(CurveError::Overflow)?;
    let out = y
        .checked_mul(tokens_in as u128)
        .ok_or(CurveError::Overflow)?
        / d;
    Ok(out as u64)
}

/// Fee on a SOL amount, rounded UP (against the trader / in favor of holders).
pub fn fee_ceil(amount: u64, fee_bps: u16) -> Result<u64, CurveError> {
    let n = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(CurveError::Overflow)?;
    Ok(((n + BPS_DENOM - 1) / BPS_DENOM) as u64)
}

/// Split a fee into (creator, flywheel). Creator gets the floor,
/// the remainder goes to holders.
pub fn split_fee(fee: u64, creator_share_bps: u16) -> (u64, u64) {
    let creator = ((fee as u128) * (creator_share_bps as u128) / BPS_DENOM) as u64;
    (creator, fee - creator)
}

/// Split a fee three ways: (creator, airdrop, flywheel). Creator and airdrop
/// take their floors; every rounding lamport lands in the flywheel (burn).
/// Caller guarantees creator_share_bps + airdrop_share_bps <= BPS_DENOM,
/// so creator + airdrop <= fee and the subtraction cannot underflow.
pub fn split_fee3(fee: u64, creator_share_bps: u16, airdrop_share_bps: u16) -> (u64, u64, u64) {
    let creator = ((fee as u128) * (creator_share_bps as u128) / BPS_DENOM) as u64;
    let airdrop = ((fee as u128) * (airdrop_share_bps as u128) / BPS_DENOM) as u64;
    (creator, airdrop, fee - creator - airdrop)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOL: u64 = 1_000_000_000;
    const SUPPLY: u64 = 1_000_000_000_000_000; // 1B tokens, 6 decimals

    /// Deterministic xorshift PRNG — no external deps.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            let mut s = self.0;
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            self.0 = s;
            s
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n.max(1)
        }
    }

    /// Minimal pool simulation mirroring the handler bookkeeping.
    struct Sim {
        x: u64,       // token reserve
        virt: u64,    // virtual SOL
        real: u64,    // real SOL
        fee_bps: u16,
        fees_accrued: u64,
    }
    impl Sim {
        fn new(tokens: u64, virt: u64, fee_bps: u16) -> Self {
            Sim { x: tokens, virt, real: 0, fee_bps, fees_accrued: 0 }
        }
        fn y(&self) -> u64 {
            self.virt + self.real
        }
        fn buy(&mut self, sol_in: u64) -> Option<u64> {
            let fee = fee_ceil(sol_in, self.fee_bps).ok()?;
            let net = sol_in.checked_sub(fee)?;
            let out = buy_out(self.x, self.y(), net).ok()?;
            self.real += net;
            self.fees_accrued += fee;
            self.x -= out;
            Some(out)
        }
        fn sell(&mut self, tokens_in: u64) -> Option<u64> {
            let gross = sell_gross(self.x, self.y(), tokens_in).ok()?;
            if gross > self.real {
                return None; // floor invariant: handler rejects
            }
            let fee = fee_ceil(gross, self.fee_bps).ok()?;
            let out = gross - fee;
            self.real -= gross;
            self.fees_accrued += fee;
            self.x += tokens_in;
            Some(out)
        }
    }

    #[test]
    fn opening_price_matches_tier() {
        // 1B tokens vs 35 virtual SOL: buying 1 SOL (no fee) yields
        // slightly less than supply/36 (price impact).
        let out = buy_out(SUPPLY, 35 * SOL, SOL).unwrap();
        assert!(out < SUPPLY / 35);
        assert!(out > SUPPLY / 37);
    }

    #[test]
    fn zero_amounts_rejected() {
        assert_eq!(buy_out(SUPPLY, 35 * SOL, 0), Err(CurveError::ZeroAmount));
        assert_eq!(sell_gross(SUPPLY, 35 * SOL, 0), Err(CurveError::ZeroAmount));
    }

    #[test]
    fn fee_rounds_up_and_split_favors_holders() {
        assert_eq!(fee_ceil(1, 100).unwrap(), 1); // 1% of 1 lamport → 1
        assert_eq!(fee_ceil(10_000, 100).unwrap(), 100);
        assert_eq!(fee_ceil(0, 100).unwrap(), 0);
        let (c, f) = split_fee(101, 5000);
        assert_eq!((c, f), (50, 51)); // odd lamport goes to the flywheel
        assert_eq!(split_fee(100, 0), (0, 100));
        assert_eq!(split_fee(100, 10_000), (100, 0));
    }

    #[test]
    fn split3_conserves_and_never_underflows() {
        // exact conservation across a sweep of fees and share configs,
        // including the degenerate creator+airdrop = 100% case
        let mut rng = Rng(7);
        for _ in 0..20_000 {
            let fee = rng.below(10 * SOL);
            let c = (rng.below(10_001)) as u16;
            let a = (rng.below((10_001 - c as u64).max(1))) as u16;
            let (fc, fa, fw) = split_fee3(fee, c, a);
            assert_eq!(fc + fa + fw, fee, "conservation fee={fee} c={c} a={a}");
            assert!(fc <= fee && fa <= fee);
        }
        assert_eq!(split_fee3(101, 5000, 5000), (50, 50, 1)); // dust burns
        assert_eq!(split_fee3(100, 0, 0), (0, 0, 100));
        assert_eq!(split_fee3(100, 10_000, 0), (100, 0, 0));
        assert_eq!(split_fee3(100, 0, 10_000), (0, 100, 0));
        assert_eq!(split_fee3(0, 5000, 5000), (0, 0, 0));
        // matches the 2-way split when airdrop is off
        for fee in [1u64, 99, 12345, 7 * SOL] {
            let (c2, f2) = split_fee(fee, 3300);
            let (c3, a3, f3) = split_fee3(fee, 3300, 0);
            assert_eq!((c2, 0, f2), (c3, a3, f3));
        }
    }

    #[test]
    fn cannot_sell_into_virtual_sol() {
        // Fresh pool, zero real SOL: any sell must be rejected by the
        // floor check even though the curve quotes a positive amount.
        let mut sim = Sim::new(SUPPLY, 35 * SOL, 0);
        assert_eq!(sim.sell(SUPPLY / 10), None);
        // After a real buy, selling everything back may extract at most
        // what was put in.
        let bought = sim.buy(5 * SOL).unwrap();
        let back = sim.sell(bought).unwrap();
        assert!(back <= 5 * SOL);
    }

    #[test]
    fn round_trip_never_profits() {
        // With zero fees, buy-then-sell-back must never return more SOL
        // than was paid, for a wide range of sizes (rounding is against
        // the trader).
        for sol_in in [1u64, 999, SOL / 1000, SOL, 7 * SOL, 400 * SOL] {
            let mut sim = Sim::new(SUPPLY, 35 * SOL, 0);
            if let Some(tokens) = sim.buy(sol_in) {
                if let Some(back) = sim.sell(tokens) {
                    assert!(back <= sol_in, "profit! in={sol_in} back={back}");
                }
            }
        }
    }

    #[test]
    fn real_sol_never_negative_fuzz() {
        // 200k random trades across several configs: the pool must never
        // pay out more SOL than it actually holds, and bookkeeping must
        // stay consistent (sum of outs ≤ sum of ins).
        for (seed, virt, fee_bps) in [
            (1u64, 10 * SOL, 0u16),
            (2, 35 * SOL, 100),
            (3, 100 * SOL, 1000),
            (4, 500 * SOL, 250),
        ] {
            let mut rng = Rng(seed);
            let mut sim = Sim::new(SUPPLY, virt, fee_bps);
            let mut sol_in_total: u128 = 0;
            let mut sol_out_total: u128 = 0;
            let mut wallet_tokens: u64 = 0;

            for _ in 0..50_000 {
                if rng.below(2) == 0 {
                    let amt = rng.below(20 * SOL) + 1;
                    if let Some(tokens) = sim.buy(amt) {
                        sol_in_total += amt as u128;
                        wallet_tokens += tokens;
                    }
                } else if wallet_tokens > 0 {
                    let amt = rng.below(wallet_tokens) + 1;
                    if let Some(out) = sim.sell(amt) {
                        sol_out_total += out as u128;
                        wallet_tokens -= amt;
                    }
                }
                // invariants after every step
                assert!(sim.real as u128 + sim.fees_accrued as u128 + sol_out_total <= sol_in_total || sol_in_total == 0);
            }
            // conservation: everything paid out + still held == everything paid in
            assert_eq!(
                sol_in_total,
                sol_out_total + sim.real as u128 + sim.fees_accrued as u128
            );
        }
    }

    #[test]
    fn flywheel_buy_raises_price_and_burns() {
        // Simulate a crank: SOL enters the curve with no fee, tokens out
        // are burned (removed from x). Spot price must strictly rise.
        let mut sim = Sim::new(SUPPLY, 35 * SOL, 100);
        sim.buy(10 * SOL).unwrap();
        let price_before = (sim.y() as f64) / (sim.x as f64);
        let crank_sol = SOL / 5;
        let burned = buy_out(sim.x, sim.y(), crank_sol).unwrap();
        sim.real += crank_sol;
        sim.x -= burned;
        let price_after = (sim.y() as f64) / (sim.x as f64);
        assert!(burned > 0);
        assert!(price_after > price_before);
    }

    #[test]
    fn extreme_reserves_no_overflow() {
        // u64::MAX-ish reserves must not panic (u128 intermediate).
        let big = u64::MAX / 2;
        let _ = buy_out(big, big, big);
        let _ = sell_gross(big, big, big);
        let _ = fee_ceil(u64::MAX, 1000);
    }
}
