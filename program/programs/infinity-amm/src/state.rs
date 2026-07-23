use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub mint: Pubkey,
    pub token_vault: Pubkey,
    /// Receives the creator share of fees. Initially the creator;
    /// transferable with dual signature.
    pub fee_receiver: Pubkey,
    /// Non-payable SOL seeding the curve (the floor). Immutable.
    pub virtual_sol: u64,
    /// Real SOL inside the curve — the only SOL sellers can extract.
    pub real_sol: u64,
    /// Tokens inside the curve (mirrors the vault minus nothing — the
    /// vault holds exactly this).
    pub token_reserve: u64,
    /// Total swap fee in bps. Can only be lowered.
    pub fee_bps: u16,
    /// Creator's share of the fee in bps of the fee. Can only be lowered
    /// (shifted toward holders).
    pub creator_share_bps: u16,
    /// Claimable creator fees (lamports, held on this account).
    pub creator_fees: u64,
    /// Pending buyback-and-burn lamports (held on this account).
    pub flywheel_sol: u64,
    pub total_sol_volume: u64,
    pub total_burned: u64,
    pub created_at_slot: u64,
    pub last_crank_slot: u64,
    pub bump: u8,
    /// 1 = decaying anti-sniper buy tax active for the opening window.
    /// Chosen at creation, immutable (so a creator can't disable it mid-window
    /// to let their own sniper in).
    pub sniper_guard: u8,
    /// Holders-airdrop share of the fee in bps of the fee. Set at creation,
    /// immutable. creator_share + airdrop_share <= 100%; the flywheel
    /// (buyback-and-burn) gets the remainder.
    pub airdrop_share_bps: u16,
    /// Pending holders-airdrop lamports (held on this account) until the
    /// keeper distributes them pro-rata to holders.
    pub airdrop_sol: u64,
}

pub const POOL_SEED: &[u8] = b"pool";

/// Virtual SOL tiers (lamports): 10 / 35 / 100 / 500 SOL.
pub const TIERS: [u64; 4] = [
    10_000_000_000,
    35_000_000_000,
    100_000_000_000,
    500_000_000_000,
];

pub const MAX_FEE_BPS: u16 = 1_000; // 10%
pub const CRANK_TIP_BPS: u16 = 50; // 0.5% of cranked amount to the caller
pub const MAX_CRANK_LAMPORTS: u64 = 200_000_000; // 0.2 SOL per crank
pub const CRANK_COOLDOWN_SLOTS: u64 = 25; // ~10s

/// Anti-sniper: an optional decaying buy tax over the opening window. Starts
/// at SNIPER_MAX_BPS at the creation slot and falls linearly to 0 by
/// SNIPER_WINDOW_SLOTS. The tax goes 100% to the flywheel — snipers pay the
/// holders. Buys only (sells are already bounded by the real-SOL floor).
pub const SNIPER_WINDOW_SLOTS: u64 = 15; // ~6s
pub const SNIPER_MAX_BPS: u16 = 5_000; // 50% at slot 0

/// Pool account sizes (8-byte discriminator included). V1 pools predate the
/// holders-airdrop fields and are extended in place by `migrate_pool`.
pub const POOL_SIZE_V1: usize = 182;
pub const POOL_SIZE_V2: usize = 192; // + airdrop_share_bps (2) + airdrop_sol (8)

/// The keeper allowed to distribute accrued airdrops (the protocol cranker).
/// Distribution amounts are computed off-chain pro-rata over holders, but the
/// program bounds every payout by the pool's accrued airdrop bucket, so a
/// compromised keeper can never touch real_sol, creator fees or the flywheel.
pub const AIRDROP_KEEPER: Pubkey = pubkey!("CsCpTesRAwjL3vtHJRCKHGQLm1oiAvXsdtLqMtD679NU");
/// Max recipients per airdrop crank (fits comfortably in one transaction).
pub const MAX_AIRDROP_RECIPIENTS: usize = 20;

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub token_amount: u64,
    pub virtual_sol: u64,
    pub fee_bps: u16,
    pub creator_share_bps: u16,
    pub airdrop_share_bps: u16,
}

#[event]
pub struct Swap {
    pub pool: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub sol_amount: u64,   // gross SOL side (in for buys, out-before-fee for sells)
    pub token_amount: u64,
    pub fee_creator: u64,
    pub fee_flywheel: u64,
    pub real_sol: u64,
    pub token_reserve: u64,
    pub fee_airdrop: u64,
}

#[event]
pub struct AirdropPayout {
    pub pool: Pubkey,
    pub total: u64,
    pub recipients: u16,
}

#[event]
pub struct FlywheelCrank {
    pub pool: Pubkey,
    pub caller: Pubkey,
    pub sol_in: u64,
    pub tokens_burned: u64,
    pub tip: u64,
    pub real_sol: u64,
    pub token_reserve: u64,
}

#[event]
pub struct CreatorClaim {
    pub pool: Pubkey,
    pub receiver: Pubkey,
    pub amount: u64,
}
