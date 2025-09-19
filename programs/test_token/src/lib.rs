use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("BSCgQLPHjjvoH6qbG59dyxUTfcK6jAqFDdPk6MNN7sEz");
#[program]
pub mod test_token {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Store the bump so we can sign later
        ctx.accounts.mint_auth.bump = ctx.bumps.mint_auth;

        Ok(())
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        // Anyone can call this → mint freely
        let seeds: &[&[&[u8]]] = &[&[b"mint_auth_v2", &[ctx.accounts.mint_auth.bump]]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                    authority: ctx.accounts.mint_auth.to_account_info(),
                },
                seeds,
            ),
            amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Create the token mint
    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = mint_auth,
        mint::freeze_authority = mint_auth
    )]
    pub mint: Account<'info, Mint>,

    /// PDA that acts as mint authority
    #[account(
        init,         
        payer = payer,
        space = 8 + std::mem::size_of::<MintAuthorityPda>(),
        seeds = [b"mint_auth_v2"],
        bump
    )]
    pub mint_auth: Account<'info, MintAuthorityPda>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    /// Anyone can call this
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = caller
    )]
    pub recipient: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"mint_auth_v2"],
        bump = mint_auth.bump
    )]
    pub mint_auth: Account<'info, MintAuthorityPda>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct MintAuthorityPda {
    pub bump: u8,
}
