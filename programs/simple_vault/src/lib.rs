use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use unique_low::Collection;
use solana_program::program_option::COption;


declare_id!("6szSVnHy2GrCi6y7aQxJfQG9WpVkTgdB6kDXixepvdoW");

#[program]
pub mod simple_vault {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        nft_collection_address: Pubkey, // <- Use collection address instead of specific mint
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.asset_mint = ctx.accounts.asset_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.nft_collection_address = nft_collection_address; // <- store collection PDA
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // The identity check is enforced by the custom constraint in Deposit accounts
        
        // Transfer assets from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_asset_token.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Mint shares to user
        let asset_mint_key = ctx.accounts.asset_mint.key();
        let seeds: &[&[u8]] = &[
            b"vault".as_ref(),
            asset_mint_key.as_ref(),
            ctx.accounts.vault.owner.as_ref(),
            &[ctx.accounts.vault.bump],
        ];
        let signer = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        Ok(())
    }
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub asset_mint: Pubkey,
    pub share_mint: Pubkey,
    pub nft_collection_address: Pubkey, // <- Collection PDA instead of specific mint
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub asset_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 32 + 32 + 1, // same size
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

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user
    )]
    pub user_share_token: Account<'info, TokenAccount>,

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
}