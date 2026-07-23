use anchor_lang::prelude::*;

#[error_code]
pub enum InfinityError {
    #[msg("Invalid virtual SOL tier")]
    InvalidTier,
    #[msg("Fee configuration out of bounds")]
    InvalidFeeConfig,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Sell would exceed real SOL reserves (virtual floor reached)")]
    FloorReached,
    #[msg("Mint has an unsupported Token-2022 extension")]
    UnsupportedMintExtension,
    #[msg("Mint must have no freeze authority")]
    FreezeAuthorityPresent,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Fees can only be reduced or shifted toward holders")]
    FeeIncreaseForbidden,
    #[msg("Only the fee receiver can do this")]
    UnauthorizedFeeReceiver,
    #[msg("Crank is cooling down")]
    CrankCooldown,
    #[msg("Nothing to crank")]
    NothingToCrank,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Only the airdrop keeper can do this")]
    UnauthorizedKeeper,
    #[msg("Invalid airdrop batch (empty, too large, or accounts/amounts mismatch)")]
    InvalidAirdrop,
    #[msg("Airdrop payout exceeds the accrued airdrop bucket")]
    AirdropExceedsAccrued,
    #[msg("Pool is already on the current layout")]
    MigrationNotNeeded,
}
