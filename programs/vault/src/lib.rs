use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use solana_program::declare_id;
pub mod constants;
use constants::*;


declare_id!("B2iJWvv6hwMvVkdKm1ovTzSr52neJU9k8AQyQHVBtFRM");

#[program]
pub mod vault {
    use super::*;

 pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        reserve_factor: u64,
    ) -> Result<()> {
        require!(reserve_factor <= constants::MAX_RESERVE_FACTOR, ErrorCode::ReserveFactorTooHigh);
        
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        
        vault.authority = ctx.accounts.authority.key();
        vault.mint = ctx.accounts.mint.key();
        vault.token_account = ctx.accounts.token_account.key();
        vault.pool = ctx.accounts.pool.key();
        vault.total_borrowed = 0;
        vault.borrow_index = constants::INITIAL_BORROW_INDEX;
        vault.borrow_rate = BASE_RATE;
        vault.last_update_time = clock.unix_timestamp;
        vault.reserve_factor = reserve_factor;
        vault.total_reserves = 0;
        vault.total_shares = 0;
        vault.is_paused = false;
        vault.bump = ctx.bumps.vault;
        
        Ok(())
    }

        pub fn deposit_with_nft(ctx: Context<DepositWithNFT>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        // Verify NFT ownership
        require!(
            ctx.accounts.nft_token_account.amount == 1,
            ErrorCode::InvalidNFTOwnership
        );
        require!(
            ctx.accounts.nft_token_account.owner == ctx.accounts.user.key(),
            ErrorCode::InvalidNFTOwnership
        );
        
        update_interest(&mut ctx.accounts.vault)?;
        
        let vault = &mut ctx.accounts.vault;
        let total_assets = get_total_assets(ctx.accounts.token_account.amount, vault)?;
        
        // Calculate shares to mint
        let shares_to_mint = if vault.total_shares == 0 {
            amount
        } else {
            (amount * vault.total_shares) / total_assets
        };
        
        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        // Update NFT-based user info (uses NFT mint as identifier)
        let nft_user_info = &mut ctx.accounts.nft_user_info;
        nft_user_info.vault = vault.key();
        nft_user_info.nft_mint = ctx.accounts.nft_mint.key();
        nft_user_info.owner = ctx.accounts.user.key();
        nft_user_info.shares += shares_to_mint;
        nft_user_info.deposited_amount += amount;
        nft_user_info.last_update = Clock::get()?.unix_timestamp;
        
        vault.total_shares += shares_to_mint;
        
        emit!(NFTDepositEvent {
            user: ctx.accounts.user.key(),
            nft_mint: ctx.accounts.nft_mint.key(),
            amount,
            shares: shares_to_mint,
        });
        
        Ok(())
    }

    // Modified withdraw function - requires NFT ownership
    pub fn withdraw_with_nft(ctx: Context<WithdrawWithNFT>, shares: u64) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        require!(shares > 0, ErrorCode::InvalidAmount);
        
        // Verify NFT ownership
        require!(
            ctx.accounts.nft_token_account.amount == 1,
            ErrorCode::InvalidNFTOwnership
        );
        require!(
            ctx.accounts.nft_token_account.owner == ctx.accounts.user.key(),
            ErrorCode::InvalidNFTOwnership
        );
        
        // Verify the NFT user info belongs to this NFT
        require!(
            ctx.accounts.nft_user_info.nft_mint == ctx.accounts.nft_mint.key(),
            ErrorCode::InvalidNFTUserInfo
        );
        
        update_interest(&mut ctx.accounts.vault)?;
        
        let vault = &mut ctx.accounts.vault;
        let nft_user_info = &mut ctx.accounts.nft_user_info;
        
        require!(nft_user_info.shares >= shares, ErrorCode::InsufficientShares);
        
        let total_assets = get_total_assets(ctx.accounts.token_account.amount, vault)?;
        let assets_to_withdraw = (shares * total_assets) / vault.total_shares;
        
        let available_liquidity = ctx.accounts.token_account.amount - vault.total_reserves;
        require!(available_liquidity >= assets_to_withdraw, ErrorCode::InsufficientLiquidity);
        
        // Update NFT-based user shares
        nft_user_info.shares -= shares;
        nft_user_info.last_update = Clock::get()?.unix_timestamp;
        vault.total_shares -= shares;
        
        // Transfer tokens from vault to user
        let seeds = &[
            b"vault",
            vault.mint.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, assets_to_withdraw)?;
        
        emit!(NFTWithdrawEvent {
            user: ctx.accounts.user.key(),
            nft_mint: ctx.accounts.nft_mint.key(),
            shares,
            amount: assets_to_withdraw,
        });
        
        Ok(())
    }

    // Transfer vault position to another NFT
    pub fn transfer_position_to_nft(ctx: Context<TransferPositionToNFT>) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        
        // Verify source NFT ownership
        require!(
            ctx.accounts.source_nft_token_account.amount == 1,
            ErrorCode::InvalidNFTOwnership
        );
        require!(
            ctx.accounts.source_nft_token_account.owner == ctx.accounts.user.key(),
            ErrorCode::InvalidNFTOwnership
        );
        
        // Verify target NFT ownership
        require!(
            ctx.accounts.target_nft_token_account.amount == 1,
            ErrorCode::InvalidNFTOwnership
        );
        
        let source_info = &mut ctx.accounts.source_nft_user_info;
        let target_info = &mut ctx.accounts.target_nft_user_info;
        
        // Transfer all shares from source NFT to target NFT
        target_info.vault = source_info.vault;
        target_info.nft_mint = ctx.accounts.target_nft_mint.key();
        target_info.owner = ctx.accounts.target_nft_token_account.owner;
        target_info.shares += source_info.shares;
        target_info.deposited_amount += source_info.deposited_amount;
        target_info.last_update = Clock::get()?.unix_timestamp;
        
        // Clear source NFT info
        let transferred_shares = source_info.shares;
        source_info.shares = 0;
        source_info.deposited_amount = 0;
        source_info.last_update = Clock::get()?.unix_timestamp;
        
        emit!(PositionTransferredEvent {
            from_nft: ctx.accounts.source_nft_mint.key(),
            to_nft: ctx.accounts.target_nft_mint.key(),
            shares: transferred_shares,
            user: ctx.accounts.user.key(),
        });
        
        Ok(())
    }

    // Get vault info for a specific NFT
    pub fn get_nft_position(ctx: Context<GetNFTPosition>) -> Result<NFTPositionInfo> {
        let nft_user_info = &ctx.accounts.nft_user_info;
        let vault = &ctx.accounts.vault;
        
        let total_assets = get_total_assets(ctx.accounts.token_account.amount, vault)?;
        let asset_value = if vault.total_shares > 0 {
            (nft_user_info.shares * total_assets) / vault.total_shares
        } else {
            0
        };
        
        Ok(NFTPositionInfo {
            nft_mint: nft_user_info.nft_mint,
            shares: nft_user_info.shares,
            asset_value,
            deposited_amount: nft_user_info.deposited_amount,
            last_update: nft_user_info.last_update,
        })
    }

    // Borrow function with NFT collateral
    pub fn borrow_with_nft(ctx: Context<BorrowWithNFT>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.pool.key() == ctx.accounts.vault.pool, ErrorCode::UnauthorizedPool);
        
        // Verify NFT ownership
        require!(
            ctx.accounts.nft_token_account.amount == 1,
            ErrorCode::InvalidNFTOwnership
        );
        
        let vault = &mut ctx.accounts.vault;
        let nft_user_info = &ctx.accounts.nft_user_info;
        
        // Check if NFT has sufficient collateral (shares)
        let total_assets = get_total_assets(ctx.accounts.token_account.amount, vault)?;
        let collateral_value = if vault.total_shares > 0 {
            (nft_user_info.shares * total_assets) / vault.total_shares
        } else {
            0
        };
        
        // Example: Allow borrowing up to 50% of collateral value
        let max_borrow = collateral_value / 2;
        
        let nft_borrow_info = &mut ctx.accounts.nft_borrow_info;
        let current_debt = if nft_borrow_info.borrowed > 0 {
            (nft_borrow_info.borrowed * vault.borrow_index) / nft_borrow_info.borrow_index
        } else {
            0
        };
        
        require!(current_debt + amount <= max_borrow, ErrorCode::InsufficientCollateral);
        
        let available_liquidity = ctx.accounts.token_account.amount - vault.total_reserves;
        require!(available_liquidity >= amount, ErrorCode::InsufficientLiquidity);
        
        update_interest(vault)?;
        
        // Update borrow info
        nft_borrow_info.vault = vault.key();
        nft_borrow_info.nft_mint = ctx.accounts.nft_mint.key();
        nft_borrow_info.user = ctx.accounts.user.key();
        nft_borrow_info.borrowed = current_debt + amount;
        nft_borrow_info.borrow_index = vault.borrow_index;
        vault.total_borrowed += amount;
        
        update_borrow_rate(vault, ctx.accounts.token_account.amount)?;
        
        // Transfer tokens
        let seeds = &[
            b"vault",
            vault.mint.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        
        emit!(NFTBorrowEvent {
            user: ctx.accounts.user.key(),
            nft_mint: ctx.accounts.nft_mint.key(),
            amount,
        });
        
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        update_interest(&mut ctx.accounts.vault)?;
        
        let vault = &mut ctx.accounts.vault;
        let total_assets = get_total_assets(ctx.accounts.token_account.amount, vault)?;
        
        // Calculate shares to mint (ERC4626 logic)
        let shares_to_mint = if vault.total_shares == 0 {
            amount
        } else {
            (amount * vault.total_shares) / total_assets
        };
        
        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        // Update user shares
        let user_info = &mut ctx.accounts.user_info;
        user_info.shares += shares_to_mint;
        vault.total_shares += shares_to_mint;
        
        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
            shares: shares_to_mint,
        });
        
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        require!(shares > 0, ErrorCode::InvalidAmount);
        
      
        
        update_interest(&mut ctx.accounts.vault)?;
        
        
        let vault = &mut ctx.accounts.vault;
        let user_info = &mut ctx.accounts.user_info;
        
        require!(user_info.shares >= shares, ErrorCode::InsufficientShares);
        
        let total_assets = get_total_assets(ctx.accounts.token_account.amount, vault)?;
        let assets_to_withdraw = (shares * total_assets) / vault.total_shares;
        
        let available_liquidity = ctx.accounts.token_account.amount - vault.total_reserves;
        require!(available_liquidity >= assets_to_withdraw, ErrorCode::InsufficientLiquidity);
        
        // Update user shares
        user_info.shares -= shares;
        vault.total_shares -= shares;
        
        // Transfer tokens from vault to user
        let seeds = &[
            b"vault",
            vault.mint.as_ref(),
            &[vault.bump],
        ];
    
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, assets_to_withdraw)?;
        
        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            shares,
            amount: assets_to_withdraw,
        });
        
        Ok(())
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.pool.key() == ctx.accounts.vault.pool, ErrorCode::UnauthorizedPool);
        
        let vault = &mut ctx.accounts.vault;
        let available_liquidity = ctx.accounts.token_account.amount - vault.total_reserves;
        require!(available_liquidity >= amount, ErrorCode::InsufficientLiquidity);
        
        update_interest(vault)?;
        
        let user_borrow = &mut ctx.accounts.user_borrow;
        
        // If user has existing borrow, calculate current debt first
        if user_borrow.borrowed > 0 {
            let current_debt = (user_borrow.borrowed * vault.borrow_index) / user_borrow.borrow_index;
            user_borrow.borrowed = current_debt;
        }
        
        user_borrow.borrowed += amount;
        user_borrow.borrow_index = vault.borrow_index;
        vault.total_borrowed += amount;
        
        update_borrow_rate(vault, ctx.accounts.token_account.amount)?;
        
        // Transfer tokens from vault to user
        let seeds = &[
            b"vault",
            vault.mint.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        
        emit!(BorrowEvent {
            user: ctx.accounts.user.key(),
            amount,
        });
        
        Ok(())
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.pool.key() == ctx.accounts.vault.pool, ErrorCode::UnauthorizedPool);
        
        let vault = &mut ctx.accounts.vault;
        update_interest(vault)?;
        
        let user_borrow = &mut ctx.accounts.user_borrow;
        require!(user_borrow.borrowed > 0, ErrorCode::NoDebtToRepay);
        
        // Calculate current debt with interest
        let current_debt = (user_borrow.borrowed * vault.borrow_index) / user_borrow.borrow_index;
        let repay_amount = amount.min(current_debt);
        
        // Update user's borrow info
        user_borrow.borrowed = current_debt - repay_amount;
        user_borrow.borrow_index = vault.borrow_index;
        vault.total_borrowed -= repay_amount;
        
        update_borrow_rate(vault, ctx.accounts.token_account.amount)?;
        
        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, repay_amount)?;
        
        emit!(RepayEvent {
            user: ctx.accounts.user.key(),
            amount: repay_amount,
        });
        
        Ok(())
    }

    pub fn set_reserve_factor(ctx: Context<SetReserveFactor>, new_reserve_factor: u64) -> Result<()> {
        require!(new_reserve_factor <= MAX_RESERVE_FACTOR, ErrorCode::ReserveFactorTooHigh);
        
        let vault = &mut ctx.accounts.vault;
        update_interest(vault)?;
        vault.reserve_factor = new_reserve_factor;
        
        emit!(ReserveFactorUpdated {
            new_reserve_factor,
        });
        
        Ok(())
    }

    pub fn withdraw_reserves(ctx: Context<WithdrawReserves>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(amount <= vault.total_reserves, ErrorCode::InsufficientReserves);
        
        vault.total_reserves -= amount;
        
        // Transfer reserves to authority
        let seeds = &[
            b"vault",
            vault.mint.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.authority_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        
        emit!(ReservesWithdrawn { amount });
        
        Ok(())
    }

    pub fn pause_vault(ctx: Context<PauseVault>) -> Result<()> {
        ctx.accounts.vault.is_paused = true;
        Ok(())
    }

    pub fn unpause_vault(ctx: Context<UnpauseVault>) -> Result<()> {
        ctx.accounts.vault.is_paused = false;
        Ok(())
    }
}

// Helper functions
fn update_interest(vault: &mut Vault) -> Result<()> {
    

    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    if current_time == vault.last_update_time {
        return Ok(());
    }
    
    let new_index = calculate_current_borrow_index(vault, current_time)?;
    let mut total_interest = 0;
    
    if vault.total_borrowed > 0 {
        let new_total_borrowed = (vault.total_borrowed * new_index) / vault.borrow_index;
        total_interest = new_total_borrowed - vault.total_borrowed;
        
        // Calculate reserves
        let reserve_amount = (total_interest * vault.reserve_factor) / constants::PRECISION;
        vault.total_reserves += reserve_amount;
        
        vault.total_borrowed = new_total_borrowed;
    }
    
    vault.borrow_index = new_index;
    vault.last_update_time = current_time;
    
    if total_interest > 0 {
        emit!(InterestAccrued {
            total_interest,
            new_index,
        });
    }
    
    Ok(())
}

fn calculate_current_borrow_index(vault: &Vault, current_time: i64) -> Result<u64> {
    if vault.total_borrowed == 0 {
        return Ok(vault.borrow_index);
    }
    
    let time_elapsed = (current_time - vault.last_update_time) as u64;
    let interest_factor = (vault.borrow_rate * time_elapsed) / SECONDS_PER_YEAR;
    Ok(vault.borrow_index + (vault.borrow_index * interest_factor) / PRECISION)
}

fn update_borrow_rate(vault: &mut Vault, token_balance: u64) -> Result<()> {
    let total_assets = get_total_assets(token_balance, vault)? + vault.total_reserves;
    
    if total_assets == 0 {
        vault.borrow_rate = BASE_RATE;
        return Ok(());
    }
    
    let utilization_rate = (vault.total_borrowed * PRECISION) / total_assets;
    
    if utilization_rate <= KINK {
        vault.borrow_rate = BASE_RATE + (utilization_rate * UTILIZATION_MULTIPLIER) / PRECISION;
    } else {
        let normal_rate = BASE_RATE + (KINK * UTILIZATION_MULTIPLIER) / PRECISION;
        let excess_utilization = utilization_rate - KINK;
        vault.borrow_rate = normal_rate + (excess_utilization * JUMP_MULTIPLIER) / PRECISION;
    }
    
    Ok(())
}

fn get_total_assets(token_balance: u64, vault: &Vault) -> Result<u64> {
    let current_total_borrowed = if vault.total_borrowed == 0 {
        0
    } else {
        let clock = Clock::get()?;
        let current_index = calculate_current_borrow_index(vault, clock.unix_timestamp)?;
        (vault.total_borrowed * current_index) / vault.borrow_index
    };
    
    Ok(token_balance + current_total_borrowed - vault.total_reserves)
}

// Account structures
#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub token_account: Pubkey,
    pub pool: Pubkey,
    pub total_borrowed: u64,
    pub borrow_index: u64,
    pub borrow_rate: u64,
    pub last_update_time: i64,
    pub reserve_factor: u64,
    pub total_reserves: u64,
    pub total_shares: u64,
    pub is_paused: bool,
    pub bump: u8,
}


#[account]
pub struct UserInfo {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares: u64,
}

#[account]
pub struct NFTUserInfo {
    pub vault: Pubkey,
    pub nft_mint: Pubkey,     // NFT mint address as unique identifier
    pub owner: Pubkey,         // Current owner of the NFT
    pub shares: u64,
    pub deposited_amount: u64, // Track original deposit
    pub last_update: i64,
}

#[account]
pub struct NFTBorrowInfo {
    pub vault: Pubkey,
    pub nft_mint: Pubkey,     // NFT mint address as unique identifier
    pub user: Pubkey,
    pub borrowed: u64,
    pub borrow_index: u64,
}

#[account]
pub struct BorrowInfo {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub borrowed: u64,
    pub borrow_index: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NFTPositionInfo {
    pub nft_mint: Pubkey,
    pub shares: u64,
    pub asset_value: u64,
    pub deposited_amount: u64,
    pub last_update: i64,
}


// Context structures
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Vault>(),
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = vault,
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Pool address for access control
    pub pool: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositWithNFT<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    // NFT accounts
    pub nft_mint: Account<'info, Mint>,
    
    #[account(
        constraint = nft_token_account.mint == nft_mint.key(),
        constraint = nft_token_account.amount == 1,
        constraint = nft_token_account.owner == user.key()
    )]
    pub nft_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + std::mem::size_of::<NFTUserInfo>(),
        seeds = [b"nft_user_info", vault.key().as_ref(), nft_mint.key().as_ref()],
        bump
    )]
    pub nft_user_info: Account<'info, NFTUserInfo>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawWithNFT<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    // NFT accounts
    pub nft_mint: Account<'info, Mint>,
    
    #[account(
        constraint = nft_token_account.mint == nft_mint.key(),
        constraint = nft_token_account.amount == 1,
        constraint = nft_token_account.owner == user.key()
    )]
    pub nft_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"nft_user_info", vault.key().as_ref(), nft_mint.key().as_ref()],
        bump
    )]
    pub nft_user_info: Account<'info, NFTUserInfo>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferPositionToNFT<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub vault: Account<'info, Vault>,
    
    // Source NFT
    pub source_nft_mint: Account<'info, Mint>,
    #[account(
        constraint = source_nft_token_account.mint == source_nft_mint.key(),
        constraint = source_nft_token_account.amount == 1,
        constraint = source_nft_token_account.owner == user.key()
    )]
    pub source_nft_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"nft_user_info", vault.key().as_ref(), source_nft_mint.key().as_ref()],
        bump
    )]
    pub source_nft_user_info: Account<'info, NFTUserInfo>,
    
    // Target NFT
    pub target_nft_mint: Account<'info, Mint>,
    #[account(
        constraint = target_nft_token_account.mint == target_nft_mint.key(),
        constraint = target_nft_token_account.amount == 1
    )]
    pub target_nft_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + std::mem::size_of::<NFTUserInfo>(),
        seeds = [b"nft_user_info", vault.key().as_ref(), target_nft_mint.key().as_ref()],
        bump
    )]
    pub target_nft_user_info: Account<'info, NFTUserInfo>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetNFTPosition<'info> {
    pub vault: Account<'info, Vault>,
    pub nft_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"nft_user_info", vault.key().as_ref(), nft_mint.key().as_ref()],
        bump
    )]
    pub nft_user_info: Account<'info, NFTUserInfo>,
    pub token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct BorrowWithNFT<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// CHECK: Pool signer for access control
    pub pool: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    // NFT accounts
    pub nft_mint: Account<'info, Mint>,
    
    #[account(
        constraint = nft_token_account.mint == nft_mint.key(),
        constraint = nft_token_account.amount == 1,
        constraint = nft_token_account.owner == user.key()
    )]
    pub nft_token_account: Account<'info, TokenAccount>,
    
    #[account(
        seeds = [b"nft_user_info", vault.key().as_ref(), nft_mint.key().as_ref()],
        bump
    )]
    pub nft_user_info: Account<'info, NFTUserInfo>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + std::mem::size_of::<NFTBorrowInfo>(),
        seeds = [b"nft_borrow_info", vault.key().as_ref(), nft_mint.key().as_ref()],
        bump
    )]
    pub nft_borrow_info: Account<'info, NFTBorrowInfo>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + std::mem::size_of::<UserInfo>(),
        seeds = [b"user_info", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_info: Account<'info, UserInfo>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        mut,
        seeds = [b"user_info", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_info: Account<'info, UserInfo>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// CHECK: Pool signer for access control
    pub pool: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + std::mem::size_of::<BorrowInfo>(),
        seeds = [b"borrow_info", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_borrow: Account<'info, BorrowInfo>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// CHECK: Pool signer for access control
    pub pool: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        mut,
        seeds = [b"borrow_info", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_borrow: Account<'info, BorrowInfo>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetReserveFactor<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawReserves<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        associated_token::mint = vault.mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        address = vault.token_account
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PauseVault<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnpauseVault<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"vault", vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    
    pub authority: Signer<'info>,
}

// Events

#[event]
pub struct NFTDepositEvent {
    pub user: Pubkey,
    pub nft_mint: Pubkey,
    pub amount: u64,
    pub shares: u64,
}

#[event]
pub struct NFTWithdrawEvent {
    pub user: Pubkey,
    pub nft_mint: Pubkey,
    pub shares: u64,
    pub amount: u64,
}

#[event]
pub struct NFTBorrowEvent {
    pub user: Pubkey,
    pub nft_mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PositionTransferredEvent {
    pub from_nft: Pubkey,
    pub to_nft: Pubkey,
    pub shares: u64,
    pub user: Pubkey,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub shares: u64,
    pub amount: u64,
}

#[event]
pub struct BorrowEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RepayEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct InterestAccrued {
    pub total_interest: u64,
    pub new_index: u64,
}

#[event]
pub struct ReserveFactorUpdated {
    pub new_reserve_factor: u64,
}

#[event]
pub struct ReservesWithdrawn {
    pub amount: u64,
}

// Error codes
#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("No debt to repay")]
    NoDebtToRepay,
    #[msg("Reserve factor too high")]
    ReserveFactorTooHigh,
    #[msg("Insufficient reserves")]
    InsufficientReserves,
    #[msg("Unauthorized pool")]
    UnauthorizedPool,
    #[msg("Invalid NFT ownership")]
    InvalidNFTOwnership,
    #[msg("Invalid NFT user info")]
    InvalidNFTUserInfo,
    #[msg("Insufficient collateral")]
    InsufficientCollateral,
}