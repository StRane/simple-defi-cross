use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use solana_program::program_option::COption;
use unique_low::Collection;
pub mod constants;
use constants::*;

declare_id!("6szSVnHy2GrCi6y7aQxJfQG9WpVkTgdB6kDXixepvdoW");

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
        // The identity check is enforced by the custom constraint in Deposit accounts
        update_interest(&mut ctx.accounts.vault)?;
        let vault = &ctx.accounts.vault;

        // Transfer assets from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_asset_token.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        let total_assets = get_total_assets(ctx.accounts.user_asset_token.amount, &vault)?;

        let shares_to_mint = if vault.total_shares == 0 {
            amount
        } else {
            (amount * vault.total_shares) / total_assets
        };

        // Mint shares to user
        let asset_mint_key = ctx.accounts.asset_mint.key();

        let seeds: &[&[u8]] = &[
            b"vault".as_ref(),
            asset_mint_key.as_ref(),
            vault.owner.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];

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

        let nft_user_info = &mut ctx.accounts.nft_info;
        nft_user_info.vault = vault.key();
        nft_user_info.nft_mint = ctx.accounts.nft_collection.key();
        nft_user_info.owner = ctx.accounts.user_nft_token.key();
        nft_user_info.shares += shares_to_mint;
        nft_user_info.last_update = Clock::get()?.unix_timestamp;

        ctx.accounts.vault.total_shares += shares_to_mint;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, ErrorCode::InvalidAmount);

        update_interest(&mut ctx.accounts.vault)?;

        let user_info = &mut ctx.accounts.nft_info;

        require!(user_info.shares >= shares, ErrorCode::InsufficientShares);

        // let total_assets = get_total_assets(ctx.accounts.token_account.amount, vault)?;
        let assets_to_withdraw = ((shares as u128) * (ctx.accounts.vault.total_reserves as u128))
            / (ctx.accounts.vault.total_shares as u128);

        let assets_to_withdraw = assets_to_withdraw as u64;

        // let available_liquidity = ctx.accounts.user_share_token.amount - vault.total_reserves;
        require!(
            ctx.accounts.vault.total_reserves >= assets_to_withdraw,
            ErrorCode::InsufficientLiquidity
        );
         let vault = &mut ctx.accounts.vault;


        let burn_accounts = Burn {
            mint: ctx.accounts.share_mint.to_account_info(),
            from: ctx.accounts.user_share_token.to_account_info(),
            authority: ctx.accounts.user_share_pda.to_account_info(),
        };
        let user_nft_mint_key = ctx.accounts.user_nft_mint.key();

        
        let seeds: &[&[u8]] = &[
            b"user_shares".as_ref(),
            user_nft_mint_key.as_ref(),
            &[ctx.bumps.user_share_pda], // You'll need to add this to your struct
        ];
        let signer = &[&seeds[..]];

        let burn_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            burn_accounts,
            signer,
        );
        token::burn(burn_ctx, shares)?;
       

        // Update user shares
        user_info.shares -= shares;
        vault.total_shares -= shares;

        let asset_mint_key = ctx.accounts.asset_mint.key();
        let vault_seeds: &[&[u8]] = &[
            b"vault".as_ref(),
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
            vault_signer, // Add the signer here
        );
        token::transfer(cpi_ctx, assets_to_withdraw)?;

        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            shares,
            amount: assets_to_withdraw,
        });

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

// impl Vault {
//     pub fn signer_seeds(&self) -> Vec<Vec<u8>> {
//         vec![
//             vec![
//                 b"vault".to_vec(),
//                 self.asset_mint.to_bytes().to_vec(),
//                 self.owner.to_bytes().to_vec(),
//                 vec![self.bump],
//             ].concat()
//         ]
//     }
// }

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

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub asset_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 *4 + 8*7 + 1,
        seeds = [b"vault", asset_mint.key().as_ref(), owner.key().as_ref()],
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
    seeds = [b"user_shares", user_nft_mint.key().as_ref()],
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
        seeds = [b"vault", user_nft_token.key().as_ref(), user_share_token.key().as_ref()],
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
    seeds = [b"user_shares", user_nft_mint.key().as_ref()],
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
        seeds = [b"vault", user_nft_token.key().as_ref(), user_share_token.key().as_ref()],
        bump
    )]
    pub nft_info: Account<'info, UserInfo>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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
