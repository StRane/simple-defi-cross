use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::constants::*;
use crate::errors::ErrorCode;

impl Collection {
    pub fn unique_id_exists(&self, unique_id: [u8; 32]) -> bool {
        self.unique_id_to_token_id
            .iter()
            .any(|mapping| mapping.unique_id == unique_id)
    }

    pub fn add_unique_id_mapping(&mut self, unique_id: [u8; 32], token_id: u64) {
        self.unique_id_to_token_id.push(UniqueIdToTokenId {
            unique_id,
            token_id,
        });
        
        self.token_id_to_unique_id.push(TokenIdToUniqueId {
            token_id,
            unique_id,
        });
    }

    pub fn get_unique_id_by_mint(&self, mint: &Pubkey) -> Result<[u8; 32]> {
        self.mint_to_unique_id
            .iter()
            .find(|mapping| mapping.mint == *mint)
            .map(|mapping| mapping.unique_id)
            .ok_or(error!(ErrorCode::MintNotFound))
    }

    pub fn mark_cross_chain(&mut self, unique_id: [u8; 32]) {
        if !self.cross_chain_unique_ids.contains(&unique_id) {
            self.cross_chain_unique_ids.push(unique_id);
        }
    }

    pub fn get_token_id_by_unique_id(&self, unique_id: [u8; 32]) -> Result<u64> {
        self.unique_id_to_token_id
            .iter()
            .find(|mapping| mapping.unique_id == unique_id)
            .map(|mapping| mapping.token_id)
            .ok_or(error!(ErrorCode::UniqueIdNotFound))
    }

    pub fn get_unique_id_by_token_id(&self, token_id: u64) -> Result<[u8; 32]> {
        self.token_id_to_unique_id
            .iter()
            .find(|mapping| mapping.token_id == token_id)
            .map(|mapping| mapping.unique_id)
            .ok_or(error!(ErrorCode::TokenIdNotFound))
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Collection::INIT_SPACE,
        seeds = [COLLECTION_SEED],
        bump
    )]
    pub collection: Account<'info, Collection>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// Version WITHOUT metadata for testing
#[derive(Accounts)]
pub struct MintNft<'info> {
    #[account(mut, seeds = [COLLECTION_SEED], bump = collection.bump)]
    pub collection: Account<'info, Collection>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::INIT_SPACE,
        seeds = [USER_STATE_SEED, user.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        init,
        payer = user,
        mint::decimals = 0,
        mint::authority = collection,
        mint::freeze_authority = collection,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// Optional: Keep a separate struct for minting with metadata later
#[derive(Accounts)]
pub struct MintNftWithMetadata<'info> {
    #[account(mut, seeds = [COLLECTION_SEED], bump = collection.bump)]
    pub collection: Account<'info, Collection>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::INIT_SPACE,
        seeds = [USER_STATE_SEED, user.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        init,
        payer = user,
        mint::decimals = 0,
        mint::authority = collection,
        mint::freeze_authority = collection,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Metadata account for Metaplex
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, anchor_spl::metadata::Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RequestCrossChainMint<'info> {
    #[account(mut, seeds = [COLLECTION_SEED], bump = collection.bump)]
    pub collection: Account<'info, Collection>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = token_account.mint == mint.key(),
        constraint = token_account.owner == user.key(),
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Wormhole bridge account
    pub wormhole_bridge: UncheckedAccount<'info>,
    /// CHECK: Wormhole message account  
    #[account(mut)]
    pub wormhole_message: UncheckedAccount<'info>,
    /// CHECK: Wormhole emitter account
    pub wormhole_emitter: UncheckedAccount<'info>,
    /// CHECK: Wormhole sequence account
    #[account(mut)]
    pub wormhole_sequence: UncheckedAccount<'info>,
    /// CHECK: Wormhole fee collector
    #[account(mut)]
    pub wormhole_fee_collector: UncheckedAccount<'info>,

    pub wormhole_program: Program<'info, crate::WormholeProgram>,
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// Your other small account structs
#[derive(Accounts)]
pub struct GetNonce<'info> {
    pub user_state: Account<'info, UserState>,
}

#[derive(Accounts)]
pub struct CheckUniqueId<'info> {
    pub collection: Account<'info, Collection>,
}

#[derive(Accounts)]
pub struct GetTokenByUniqueId<'info> {
    pub collection: Account<'info, Collection>,
}

#[derive(Accounts)]
pub struct GetUniqueIdByToken<'info> {
    pub collection: Account<'info, Collection>,
}

#[derive(Accounts)]
pub struct GetTotalSupply<'info> {
    pub collection: Account<'info, Collection>,
}

// Keep your state structs as-is
#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UniqueIdToTokenId {
    pub unique_id: [u8; 32],
    pub token_id: u64,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenIdToUniqueId {
    pub token_id: u64,
    pub unique_id: [u8; 32],
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MintToUniqueId {
    pub mint: Pubkey,
    pub unique_id: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct Collection {
    pub authority: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(8)]
    pub symbol: String,
    #[max_len(200)]
    pub base_uri: String,
    pub total_supply: u64,
    pub wormhole_program_id: Pubkey,
    pub bump: u8,

    #[max_len(MAX_COLLECTION_SIZE)]
    pub unique_id_to_token_id: Vec<UniqueIdToTokenId>,
    #[max_len(MAX_COLLECTION_SIZE)]
    pub token_id_to_unique_id: Vec<TokenIdToUniqueId>,
    #[max_len(MAX_COLLECTION_SIZE)]
    pub mint_to_unique_id: Vec<MintToUniqueId>,
    #[max_len(MAX_COLLECTION_SIZE)]
    pub cross_chain_unique_ids: Vec<[u8; 32]>,
}

#[account]
#[derive(InitSpace)]
pub struct UserState {
    pub nonce: u64,
}