use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as Mint2022,
};
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod curve;
pub mod errors;
pub mod state;

use anchor_lang::Discriminator;
use curve::{buy_out, fee_ceil, sell_gross, split_fee3, CurveError};
use errors::InfinityError;
use state::*;

declare_id!("MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi");

fn map_curve(e: CurveError) -> Error {
    match e {
        CurveError::ZeroAmount => InfinityError::ZeroAmount.into(),
        CurveError::Overflow => InfinityError::MathOverflow.into(),
        CurveError::ExceedsReserve => InfinityError::FloorReached.into(),
    }
}

/// Move lamports out of a program-owned account. The pool's bookkeeping
/// buckets (real_sol + creator_fees + flywheel_sol) never include rent,
/// so rent-exemption is preserved by construction.
fn debit_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    let mut from_lamports = from.try_borrow_mut_lamports()?;
    let mut to_lamports = to.try_borrow_mut_lamports()?;
    **from_lamports = from_lamports
        .checked_sub(amount)
        .ok_or(InfinityError::MathOverflow)?;
    **to_lamports = to_lamports
        .checked_add(amount)
        .ok_or(InfinityError::MathOverflow)?;
    Ok(())
}

/// Only plain mints may create pools. For Token-2022, metadata-related
/// extensions are fine; anything that can tax, hook, seize or freeze
/// balances (TransferFee, TransferHook, PermanentDelegate, ...) is not.
fn validate_mint(mint_ai: &AccountInfo) -> Result<()> {
    if *mint_ai.owner == anchor_spl::token::ID {
        return Ok(()); // classic SPL: nothing beyond freeze check (constraint)
    }
    let data = mint_ai.try_borrow_data()?;
    let mint = StateWithExtensions::<Mint2022>::unpack(&data)
        .map_err(|_| InfinityError::UnsupportedMintExtension)?;
    for ext in mint
        .get_extension_types()
        .map_err(|_| InfinityError::UnsupportedMintExtension)?
    {
        match ext {
            ExtensionType::MetadataPointer | ExtensionType::TokenMetadata => {}
            _ => return err!(InfinityError::UnsupportedMintExtension),
        }
    }
    Ok(())
}

#[program]
pub mod infinity_amm {
    use super::*;

    /// One-sided pool creation: deposit only tokens, pick a virtual SOL
    /// tier. Liquidity is permanent — there is no withdraw instruction.
    pub fn create_pool(
        ctx: Context<CreatePool>,
        token_amount: u64,
        tier: u8,
        fee_bps: u16,
        creator_share_bps: u16,
        sniper_guard: bool,
        airdrop_share_bps: u16,
    ) -> Result<()> {
        require!(token_amount > 0, InfinityError::ZeroAmount);
        require!((tier as usize) < TIERS.len(), InfinityError::InvalidTier);
        require!(fee_bps <= MAX_FEE_BPS, InfinityError::InvalidFeeConfig);
        require!(
            (creator_share_bps as u32) + (airdrop_share_bps as u32) <= 10_000,
            InfinityError::InvalidFeeConfig
        );
        validate_mint(&ctx.accounts.mint.to_account_info())?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.creator_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            token_amount,
            ctx.accounts.mint.decimals,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.mint = ctx.accounts.mint.key();
        pool.token_vault = ctx.accounts.token_vault.key();
        pool.fee_receiver = ctx.accounts.creator.key();
        pool.virtual_sol = TIERS[tier as usize];
        pool.real_sol = 0;
        pool.token_reserve = token_amount;
        pool.fee_bps = fee_bps;
        pool.creator_share_bps = creator_share_bps;
        pool.creator_fees = 0;
        pool.flywheel_sol = 0;
        pool.total_sol_volume = 0;
        pool.total_burned = 0;
        pool.created_at_slot = Clock::get()?.slot;
        pool.last_crank_slot = 0;
        pool.bump = ctx.bumps.pool;
        pool.sniper_guard = sniper_guard as u8;
        pool.airdrop_share_bps = airdrop_share_bps;
        pool.airdrop_sol = 0;

        emit!(PoolCreated {
            pool: pool.key(),
            mint: pool.mint,
            creator: ctx.accounts.creator.key(),
            token_amount,
            virtual_sol: pool.virtual_sol,
            fee_bps,
            creator_share_bps,
            airdrop_share_bps,
        });
        Ok(())
    }

    pub fn buy(ctx: Context<Trade>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_in > 0, InfinityError::ZeroAmount);
        let pool = &ctx.accounts.pool;

        let base_fee = fee_ceil(sol_in, pool.fee_bps).map_err(map_curve)?;
        // Anti-sniper: a decaying extra tax over the opening window, 100% to
        // the flywheel. Linear from SNIPER_MAX_BPS at the creation slot to 0.
        let sniper_extra = if pool.sniper_guard == 1 {
            let elapsed = Clock::get()?.slot.saturating_sub(pool.created_at_slot);
            if elapsed < SNIPER_WINDOW_SLOTS {
                let remaining = SNIPER_WINDOW_SLOTS - elapsed;
                let bps = ((SNIPER_MAX_BPS as u128) * (remaining as u128)
                    / (SNIPER_WINDOW_SLOTS as u128)) as u16;
                fee_ceil(sol_in, bps).map_err(map_curve)?
            } else {
                0
            }
        } else {
            0
        };
        let fee = base_fee
            .checked_add(sniper_extra)
            .ok_or(InfinityError::MathOverflow)?;
        let net = sol_in.checked_sub(fee).ok_or(InfinityError::MathOverflow)?;
        require!(net > 0, InfinityError::ZeroAmount);
        let y = pool
            .virtual_sol
            .checked_add(pool.real_sol)
            .ok_or(InfinityError::MathOverflow)?;
        let tokens_out = buy_out(pool.token_reserve, y, net).map_err(map_curve)?;
        require!(tokens_out >= min_tokens_out, InfinityError::SlippageExceeded);
        require!(tokens_out > 0, InfinityError::ZeroAmount);
        // base fee splits creator/airdrop/flywheel; the sniper tax is entirely flywheel
        let (fee_creator, fee_airdrop, base_flywheel) =
            split_fee3(base_fee, pool.creator_share_bps, pool.airdrop_share_bps);
        let fee_flywheel = base_flywheel
            .checked_add(sniper_extra)
            .ok_or(InfinityError::MathOverflow)?;

        // SOL in (net + fee both land on the pool account)
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.trader.to_account_info(),
                    to: ctx.accounts.pool.to_account_info(),
                },
            ),
            sol_in,
        )?;

        // tokens out, pool PDA signs
        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[ctx.accounts.pool.bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.trader_token.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[seeds],
            ),
            tokens_out,
            ctx.accounts.mint.decimals,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.real_sol = pool.real_sol.checked_add(net).ok_or(InfinityError::MathOverflow)?;
        pool.creator_fees = pool.creator_fees.checked_add(fee_creator).ok_or(InfinityError::MathOverflow)?;
        pool.flywheel_sol = pool.flywheel_sol.checked_add(fee_flywheel).ok_or(InfinityError::MathOverflow)?;
        pool.airdrop_sol = pool.airdrop_sol.checked_add(fee_airdrop).ok_or(InfinityError::MathOverflow)?;
        pool.token_reserve = pool.token_reserve.checked_sub(tokens_out).ok_or(InfinityError::MathOverflow)?;
        pool.total_sol_volume = pool.total_sol_volume.saturating_add(sol_in);

        emit!(Swap {
            pool: pool.key(),
            trader: ctx.accounts.trader.key(),
            is_buy: true,
            sol_amount: sol_in,
            token_amount: tokens_out,
            fee_creator,
            fee_flywheel,
            real_sol: pool.real_sol,
            token_reserve: pool.token_reserve,
            fee_airdrop,
        });
        Ok(())
    }

    pub fn sell(ctx: Context<Trade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        require!(tokens_in > 0, InfinityError::ZeroAmount);
        let pool = &ctx.accounts.pool;

        let y = pool
            .virtual_sol
            .checked_add(pool.real_sol)
            .ok_or(InfinityError::MathOverflow)?;
        let gross = sell_gross(pool.token_reserve, y, tokens_in).map_err(map_curve)?;
        // The floor: only real SOL is payable, never the virtual seed.
        require!(gross <= pool.real_sol, InfinityError::FloorReached);
        let fee = fee_ceil(gross, pool.fee_bps).map_err(map_curve)?;
        let sol_out = gross.checked_sub(fee).ok_or(InfinityError::MathOverflow)?;
        require!(sol_out >= min_sol_out, InfinityError::SlippageExceeded);
        require!(sol_out > 0, InfinityError::ZeroAmount);
        let (fee_creator, fee_airdrop, fee_flywheel) =
            split_fee3(fee, pool.creator_share_bps, pool.airdrop_share_bps);

        // tokens in
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.trader_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            tokens_in,
            ctx.accounts.mint.decimals,
        )?;

        // SOL out (fee lamports stay on the pool account, re-bucketed)
        debit_lamports(
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.trader.to_account_info(),
            sol_out,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.real_sol = pool.real_sol.checked_sub(gross).ok_or(InfinityError::MathOverflow)?;
        pool.creator_fees = pool.creator_fees.checked_add(fee_creator).ok_or(InfinityError::MathOverflow)?;
        pool.flywheel_sol = pool.flywheel_sol.checked_add(fee_flywheel).ok_or(InfinityError::MathOverflow)?;
        pool.airdrop_sol = pool.airdrop_sol.checked_add(fee_airdrop).ok_or(InfinityError::MathOverflow)?;
        pool.token_reserve = pool.token_reserve.checked_add(tokens_in).ok_or(InfinityError::MathOverflow)?;
        pool.total_sol_volume = pool.total_sol_volume.saturating_add(gross);

        emit!(Swap {
            pool: pool.key(),
            trader: ctx.accounts.trader.key(),
            is_buy: false,
            sol_amount: gross,
            token_amount: tokens_in,
            fee_creator,
            fee_flywheel,
            real_sol: pool.real_sol,
            token_reserve: pool.token_reserve,
            fee_airdrop,
        });
        Ok(())
    }

    /// Permissionless: buy the token with accumulated holder fees on the
    /// pool's own curve (fee-exempt) and burn what was bought. Caller
    /// earns a tip. Capped + cooled down so sandwiching is pointless.
    /// `min_tokens_out` lets an honest keeper protect the burn from being
    /// sandwiched (0 = no guard).
    pub fn crank_flywheel(ctx: Context<Crank>, min_tokens_out: u64) -> Result<()> {
        let slot = Clock::get()?.slot;
        let pool = &ctx.accounts.pool;
        require!(
            slot >= pool.last_crank_slot.saturating_add(CRANK_COOLDOWN_SLOTS),
            InfinityError::CrankCooldown
        );
        let y = pool
            .virtual_sol
            .checked_add(pool.real_sol)
            .ok_or(InfinityError::MathOverflow)?;
        // Cap a single crank to ~1% of the curve so it can never be pushed to
        // buy back at a materially manipulated price (sandwich resistance),
        // on top of the absolute MAX_CRANK_LAMPORTS ceiling.
        let impact_cap = (y / 100).max(1);
        let amount = pool.flywheel_sol.min(MAX_CRANK_LAMPORTS).min(impact_cap);
        require!(amount > 0, InfinityError::NothingToCrank);

        let tip = (amount as u128 * CRANK_TIP_BPS as u128 / curve::BPS_DENOM) as u64;
        let net = amount - tip;
        let tokens_burned = buy_out(pool.token_reserve, y, net).map_err(map_curve)?;
        require!(tokens_burned > 0, InfinityError::NothingToCrank);
        require!(tokens_burned >= min_tokens_out, InfinityError::SlippageExceeded);

        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[ctx.accounts.pool.bump]];
        burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[seeds],
            ),
            tokens_burned,
        )?;

        debit_lamports(
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.caller.to_account_info(),
            tip,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.flywheel_sol = pool.flywheel_sol.checked_sub(amount).ok_or(InfinityError::MathOverflow)?;
        pool.real_sol = pool.real_sol.checked_add(net).ok_or(InfinityError::MathOverflow)?;
        pool.token_reserve = pool.token_reserve.checked_sub(tokens_burned).ok_or(InfinityError::MathOverflow)?;
        pool.total_burned = pool.total_burned.saturating_add(tokens_burned);
        pool.last_crank_slot = slot;

        emit!(FlywheelCrank {
            pool: pool.key(),
            caller: ctx.accounts.caller.key(),
            sol_in: net,
            tokens_burned,
            tip,
            real_sol: pool.real_sol,
            token_reserve: pool.token_reserve,
        });
        Ok(())
    }

    /// amount = 0 claims everything.
    pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let claim = if amount == 0 { pool.creator_fees } else { amount };
        require!(claim > 0, InfinityError::NothingToClaim);
        require!(claim <= pool.creator_fees, InfinityError::NothingToClaim);

        debit_lamports(
            &ctx.accounts.pool.to_account_info(),
            &ctx.accounts.fee_receiver.to_account_info(),
            claim,
        )?;
        let pool = &mut ctx.accounts.pool;
        pool.creator_fees -= claim;

        emit!(CreatorClaim {
            pool: pool.key(),
            receiver: ctx.accounts.fee_receiver.key(),
            amount: claim,
        });
        Ok(())
    }

    /// Monotonic: total fee can only go down, split can only shift toward
    /// holders. Pass None to leave a value unchanged.
    pub fn reduce_fees(
        ctx: Context<FeeAdmin>,
        new_fee_bps: Option<u16>,
        new_creator_share_bps: Option<u16>,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        if let Some(f) = new_fee_bps {
            require!(f <= pool.fee_bps, InfinityError::FeeIncreaseForbidden);
            pool.fee_bps = f;
        }
        if let Some(s) = new_creator_share_bps {
            require!(s <= pool.creator_share_bps, InfinityError::FeeIncreaseForbidden);
            pool.creator_share_bps = s;
        }
        Ok(())
    }

    /// Dual-signature handover of the fee stream.
    pub fn transfer_fee_receiver(ctx: Context<TransferFeeReceiver>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.fee_receiver = ctx.accounts.new_receiver.key();
        Ok(())
    }

    /// Distribute accrued holders-airdrop SOL. Recipients are the remaining
    /// accounts, one amount each (computed off-chain pro-rata over holders by
    /// the keeper). The program guarantees the payout can never exceed the
    /// pool's accrued airdrop bucket — the keeper cannot touch real SOL,
    /// creator fees or the flywheel.
    pub fn crank_airdrop(ctx: Context<CrankAirdrop>, amounts: Vec<u64>) -> Result<()> {
        let n = amounts.len();
        require!(
            n > 0 && n <= MAX_AIRDROP_RECIPIENTS && ctx.remaining_accounts.len() == n,
            InfinityError::InvalidAirdrop
        );
        let mut total: u64 = 0;
        for a in &amounts {
            require!(*a > 0, InfinityError::ZeroAmount);
            total = total.checked_add(*a).ok_or(InfinityError::MathOverflow)?;
        }
        require!(
            total <= ctx.accounts.pool.airdrop_sol,
            InfinityError::AirdropExceedsAccrued
        );

        // Skip-not-abort: a hostile or empty recipient must never wedge the
        // whole batch. Skipped shares simply stay accrued for the next crank.
        let pool_key = ctx.accounts.pool.key();
        let pool_ai = ctx.accounts.pool.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(0);
        let mut paid: u64 = 0;
        let mut paid_count: u16 = 0;
        for (i, recipient) in ctx.remaining_accounts.iter().enumerate() {
            // paying the pool to itself would double-borrow its lamports
            if recipient.key() == pool_key || recipient.executable {
                continue;
            }
            // crediting an empty wallet below rent exemption fails the whole
            // transaction at the runtime rent-state check — skip instead
            if recipient.lamports() == 0 && amounts[i] < rent_min {
                continue;
            }
            debit_lamports(&pool_ai, recipient, amounts[i])?;
            paid = paid.checked_add(amounts[i]).ok_or(InfinityError::MathOverflow)?;
            paid_count += 1;
        }
        require!(paid > 0, InfinityError::InvalidAirdrop);

        let pool = &mut ctx.accounts.pool;
        pool.airdrop_sol = pool
            .airdrop_sol
            .checked_sub(paid)
            .ok_or(InfinityError::MathOverflow)?;

        emit!(AirdropPayout {
            pool: pool.key(),
            total: paid,
            recipients: paid_count,
        });
        Ok(())
    }

    /// One-time, permissionless V1 → V2 layout migration: extends a legacy
    /// 182-byte pool with zeroed airdrop fields (share 0 = feature off).
    /// Purely additive — no live field is touched. The payer tops up the
    /// rent-exemption delta for the extra bytes.
    pub fn migrate_pool(ctx: Context<MigratePool>) -> Result<()> {
        let pool_ai = &ctx.accounts.pool;
        require!(pool_ai.owner == &crate::ID, InfinityError::InvalidAirdrop);
        require!(
            pool_ai.data_len() == POOL_SIZE_V1,
            InfinityError::MigrationNotNeeded
        );
        {
            let data = pool_ai.try_borrow_data()?;
            require!(
                data[..8] == Pool::DISCRIMINATOR[..],
                InfinityError::MigrationNotNeeded
            );
        }

        // Pay the FULL rent delta unconditionally. The pool's balance also
        // holds user buckets (real_sol + fees), so comparing the current
        // balance against the new minimum would silently count user funds as
        // rent and leave the last `delta` lamports of the buckets frozen.
        let rent = Rent::get()?;
        let delta = rent
            .minimum_balance(POOL_SIZE_V2)
            .saturating_sub(rent.minimum_balance(POOL_SIZE_V1));
        if delta > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: pool_ai.to_account_info(),
                    },
                ),
                delta,
            )?;
        }

        #[allow(deprecated)]
        pool_ai.realloc(POOL_SIZE_V2, true)?; // new bytes zeroed → airdrop off
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(constraint = mint.freeze_authority.is_none() @ InfinityError::FreezeAuthorityPresent)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = creator,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    // init_if_needed (not init): the vault address is the deterministic
    // ATA(pool, mint), so anyone could pre-create it to grief a plain `init`.
    // Adopting a pre-existing (necessarily pool-owned, correct-mint) ATA is
    // safe; any stray tokens sent to it are simply locked, not counted in
    // token_reserve.
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub creator_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(
        mut,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump = pool.bump,
        has_one = mint,
        has_one = token_vault
    )]
    pub pool: Account<'info, Pool>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = trader,
        associated_token::mint = mint,
        associated_token::authority = trader,
        associated_token::token_program = token_program
    )]
    pub trader_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Crank<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump = pool.bump,
        has_one = mint,
        has_one = token_vault
    )]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimCreatorFees<'info> {
    #[account(
        mut,
        has_one = fee_receiver @ InfinityError::UnauthorizedFeeReceiver
    )]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub fee_receiver: Signer<'info>,
}

#[derive(Accounts)]
pub struct FeeAdmin<'info> {
    #[account(
        mut,
        has_one = fee_receiver @ InfinityError::UnauthorizedFeeReceiver
    )]
    pub pool: Account<'info, Pool>,
    pub fee_receiver: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferFeeReceiver<'info> {
    #[account(
        mut,
        has_one = fee_receiver @ InfinityError::UnauthorizedFeeReceiver
    )]
    pub pool: Account<'info, Pool>,
    pub fee_receiver: Signer<'info>,
    pub new_receiver: Signer<'info>,
}

#[derive(Accounts)]
pub struct CrankAirdrop<'info> {
    #[account(mut, address = AIRDROP_KEEPER @ InfinityError::UnauthorizedKeeper)]
    pub keeper: Signer<'info>,
    #[account(
        mut,
        seeds = [POOL_SEED, pool.mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    // remaining accounts: the recipients, one per entry in `amounts`
}

#[derive(Accounts)]
pub struct MigratePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: verified in the handler — must be program-owned, exactly the
    /// legacy V1 size, and carry the Pool discriminator. It cannot be typed
    /// `Account<Pool>` because the V2 struct no longer deserializes from the
    /// V1 layout (that's the point of the migration).
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
