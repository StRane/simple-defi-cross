use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use solana_program::program_option::COption;
use unique_low::Collection;
pub mod constants;
use constants::*;

declare_id!("4g14aJ5JEN3og3RTjrMJFuTJbYFqQ8GrcyuoS36xCnQL");

#[program]
pub mod simple_vault {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        nft_collection_address: Pubkey, // <- Use collection address instead of specific mint
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;

        vault.owner = ctx.accounts.owner.key();
        vault.asset_mint = ctx.accounts.asset_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        //-----------------
        vault.total_borrowed = 0;
        vault.borrow_index = constants::INITIAL_BORROW_INDEX;
        vault.borrow_rate = BASE_RATE;
        vault.last_update_time = clock.unix_timestamp;
        vault.total_reserves = 0;
        vault.total_shares = 0;
        //-----------------
        vault.nft_collection_address = nft_collection_address; // collection PDA
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let total_assets = ctx.accounts.vault_token_account.amount;
        msg!("Before token transfer");
        msg!("Withdraw amount {:?}", amount);
        msg!("Vault total shares {:?}", vault.total_shares);
        msg!("Pre deposit assets{:?}", ctx.accounts.vault_token_account.amount);

        // Transfer assets from user to vault first
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_asset_token.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Get total assets AFTER the transfer


        // Standard ERC4626 share calculation
        let shares_to_mint = if vault.total_shares == 0 {
            // First deposit gets 1:1 shares
            amount
        } else {
            if total_assets == 0 {
                amount // Fallback to 1:1 if somehow no assets
            } else {
                msg!("After token transfer");
                msg!("Withdraw amount {:?}", amount);
                msg!("Vault total shares {:?}", vault.total_shares);
                msg!("Pre deposit assets{:?}", total_assets);

                ((amount as u128) * (vault.total_shares as u128) / (total_assets as u128))
                    as u64
            }
        };

        // Mint shares to user
        let asset_mint_key = ctx.accounts.asset_mint.key();
        let seeds: &[&[u8]] = &[
            VAULT_SEED.as_ref(),
            asset_mint_key.as_ref(),
            vault.owner.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];

        // Update user info
        let nft_user_info = &mut ctx.accounts.nft_info;
        nft_user_info.vault = vault.key();
        nft_user_info.nft_mint = ctx.accounts.user_nft_mint.key();
        nft_user_info.owner = ctx.accounts.user_nft_token.key();
        nft_user_info.shares += shares_to_mint;
        nft_user_info.last_update = Clock::get()?.unix_timestamp;

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_token.to_account_info(),
                    authority: vault.to_account_info(),
                },
                signer,
            ),
            shares_to_mint,
        )?;

        vault.total_shares += shares_to_mint;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, ErrorCode::InvalidAmount);

        let user_info = &mut ctx.accounts.nft_info;

        require!(user_info.shares >= shares, ErrorCode::InsufficientShares);

        let vault = &mut ctx.accounts.vault;

        // Get vault balance
        let total_assets = ctx.accounts.vault_token_account.amount;

        // Calculate withdrawal
        let assets_to_withdraw =
            ((shares as u128) * (total_assets as u128) / (vault.total_shares as u128)) as u64;

        require!(
            total_assets >= assets_to_withdraw,
            ErrorCode::InsufficientLiquidity // This is line 122 that's failing
        );

        // Burn shares first
        let burn_accounts = Burn {
            mint: ctx.accounts.share_mint.to_account_info(),
            from: ctx.accounts.user_share_token.to_account_info(),
            authority: ctx.accounts.user_share_pda.to_account_info(),
        };

        let user_nft_mint_key = ctx.accounts.user_nft_mint.key();
        let seeds: &[&[u8]] = &[
            USER_SHARES_SEED.as_ref(),
            user_nft_mint_key.as_ref(),
            &[ctx.bumps.user_share_pda],
        ];
        let signer = &[&seeds[..]];

        let burn_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            burn_accounts,
            signer,
        );
        token::burn(burn_ctx, shares)?;

        // Update accounting
        user_info.shares -= shares;
        vault.total_shares -= shares;

        // Transfer assets to user
        let asset_mint_key = ctx.accounts.asset_mint.key();
        let vault_seeds: &[&[u8]] = &[
            VAULT_SEED.as_ref(),
            asset_mint_key.as_ref(),
            vault.owner.as_ref(),
            &[vault.bump],
        ];
        let vault_signer = &[&vault_seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_asset_token.to_account_info(),
            authority: vault.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            vault_signer,
        );
        token::transfer(cpi_ctx, assets_to_withdraw)?;

        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            shares,
            amount: assets_to_withdraw,
        });

        Ok(())
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        // Vault will be automatically closed and lamports returned to authority
        Ok(())
    }
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub asset_mint: Pubkey,
    pub share_mint: Pubkey,
    pub nft_collection_address: Pubkey,
    //
    pub total_borrowed: u64,
    pub borrow_index: u64,
    pub borrow_rate: u64,
    pub last_update_time: i64,
    pub reserve_factor: u64,
    pub total_reserves: u64,
    pub total_shares: u64,
    //
    pub bump: u8,
}

fn get_total_assets(token_balance: u64, _vault: &Vault) -> Result<u64> {
    Ok(token_balance)
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub asset_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 *4 + 8*7 + 1,
        seeds = [VAULT_SEED, asset_mint.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = owner,
        mint::decimals = asset_mint.decimals,
        mint::authority = vault,
        mint::freeze_authority = vault,
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = asset_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct UserInfo {
    pub vault: Pubkey,
    pub nft_mint: Pubkey, // NFT mint address as unique identifier
    pub owner: Pubkey,    // Current owner of the NFT
    pub shares: u64,
    pub last_update: i64,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,

    /// The NFT collection account (PDA from your NFT program)
    pub nft_collection: Account<'info, Collection>,

    /// ✅ Must own at least 1 NFT where the mint authority is the collection
    #[account(
        constraint = user_nft_token.owner == user.key(),
        constraint = user_nft_token.amount > 0,
        constraint = user_nft_mint.mint_authority == COption::Some(vault.nft_collection_address), // ← Key check!
    )]
    pub user_nft_token: Account<'info, TokenAccount>,

    #[account(
        constraint = user_nft_token.mint == user_nft_mint.key(),
    )]
    pub user_nft_mint: Account<'info, Mint>,

    #[account(mut)]
    pub asset_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = asset_mint,
        associated_token::authority = user
    )]
    pub user_asset_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub share_mint: Account<'info, Mint>,

    /// CHECK: This PDA is derived deterministically from user_nft_mint and used as authority for user_share_token.
    /// It's safe because: 1) Seeds are deterministic, 2) Only used as token account authority, 3) No data stored in this account
    #[account(
    seeds = [USER_SHARES_SEED, user_nft_mint.key().as_ref()],
    bump
    )]
    pub user_share_pda: AccountInfo<'info>,

    #[account(
    init_if_needed,
    payer = user,
    associated_token::mint = share_mint,
    associated_token::authority = user_share_pda
)]
    pub user_share_token: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + std::mem::size_of::<UserInfo>(),
        seeds = [USER_INFO_SEED, user_nft_mint.key().as_ref(), user_share_token.key().as_ref()],
        bump
    )]
    pub nft_info: Account<'info, UserInfo>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(shares: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,

    /// The NFT collection account (PDA from your NFT program)
    pub nft_collection: Account<'info, Collection>,

    /// ✅ Must own at least 1 NFT where the mint authority is the collection
    #[account(
        constraint = user_nft_token.owner == user.key(),
        constraint = user_nft_token.amount > 0,
        constraint = user_nft_mint.mint_authority == COption::Some(vault.nft_collection_address), // ← Key check!
    )]
    pub user_nft_token: Account<'info, TokenAccount>,

    #[account(
        constraint = user_nft_token.mint == user_nft_mint.key(),
    )]
    pub user_nft_mint: Account<'info, Mint>,

    #[account(mut)]
    pub asset_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = asset_mint,
        associated_token::authority = user
    )]
    pub user_asset_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub share_mint: Account<'info, Mint>,

    /// CHECK: This PDA is derived deterministically from user_nft_mint and used as authority for user_share_token.
    /// It's safe because: 1) Seeds are deterministic, 2) Only used as token account authority, 3) No data stored in this account
    #[account(
    seeds = [USER_SHARES_SEED, user_nft_mint.key().as_ref()],
    bump
    )]
    pub user_share_pda: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user_share_pda
    )]
    pub user_share_token: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + std::mem::size_of::<UserInfo>(),
        seeds = [USER_INFO_SEED, user_nft_mint.key().as_ref(), user_share_token.key().as_ref()],
        bump
    )]
    pub nft_info: Account<'info, UserInfo>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [VAULT_SEED, asset_mint.key().as_ref(), authority.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub asset_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid deposit amount")]
    InvalidAmount,

    #[msg("NFT does not belong to required collection")]
    InvalidNftCollection,

    #[msg("Insufficent shares")]
    InsufficientShares,

    #[msg("Insufficent reserves")]
    InsufficientLiquidity,

    #[msg("Mathematical overflow")]
    MathOverflow,
}

#[event]
pub struct InterestAccrued {
    pub total_interest: u64,
    pub new_index: u64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub shares: u64,
    pub amount: u64,
}
