use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("A7nB9xkdLQTM731sjHPTfwP2KmaqxnfyqPJ4KZyDwR3e");

#[program]
pub mod simple_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.asset_mint = ctx.accounts.asset_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
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
        space = 8 + 32 + 32 + 32 + 1,
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
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    
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
}