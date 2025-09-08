use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        create_metadata_accounts_v3,
        mpl_token_metadata::types::{Creator, DataV2},
        CreateMetadataAccountsV3, Metadata,
    },
    token::{mint_to, Mint, MintTo, Token, TokenAccount},
};
use solana_program::{
    hash::hash,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

declare_id!("5XdsDEXPiHndfBkrvJKjsFZy3Zf95bUZLRZQvJ4W6Bpa");

// ================================
// CONSTANTS
// ================================

// Seeds for PDA derivation
pub const COLLECTION_SEED: &[u8] = b"collection";
pub const USER_STATE_SEED: &[u8] = b"user_state";

// Maximum sizes for collection vectors
pub const MAX_COLLECTION_SIZE: usize = 50;

// Chain IDs
pub const SOLANA_CHAIN_ID: u64 = 1; // Solana mainnet chain ID for consistency with Ethereum

// Wormhole constants
pub const WORMHOLE_CONSISTENCY_LEVEL: u8 = 1; // Same as Ethereum contract

// ================================
// ERRORS
// ================================

#[error_code]
pub enum ErrorCode {
    #[msg("Unique ID already exists")]
    UniqueIdAlreadyExists,
    
    #[msg("Not the token owner")]
    NotTokenOwner,
    
    #[msg("Invalid sequence data")]
    InvalidSequenceData,
    
    #[msg("Mint not found")]
    MintNotFound,
    
    #[msg("Unique ID not found")]
    UniqueIdNotFound,
    
    #[msg("Token ID not found")]
    TokenIdNotFound,
}

// ================================
// EVENTS
// ================================

#[event]
pub struct NftMinted {
    pub user: Pubkey,
    pub token_id: u64,
    pub unique_id: [u8; 32],
    pub nonce: u64,
}

#[event]
pub struct CrossChainMintRequested {
    pub sender: Pubkey,
    pub mint: Pubkey,
    pub unique_id: [u8; 32],
    pub target_chain_id: u16,
    pub sequence: u64,
}

// ================================
// STATE STRUCTS
// ================================

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

// ================================
// COLLECTION IMPLEMENTATION
// ================================

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

// ================================
// ACCOUNT VALIDATION STRUCTS
// ================================

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
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

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
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub token_account: Account<'info, TokenAccount>,

    /// CHECK: Metadata account for Metaplex
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RequestCrossChainMint<'info> {
    #[account(mut, seeds = [COLLECTION_SEED], bump = collection.bump)]
    pub collection: Account<'info, Collection>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        constraint = token_account.mint == mint.key(),
        constraint = token_account.owner == user.key(),
    )]
    pub token_account: Account<'info, TokenAccount>,

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

    pub wormhole_program: Program<'info, WormholeProgram>,
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

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

// ================================
// WORMHOLE STRUCTS
// ================================

#[derive(Accounts)]
pub struct PublishMessage<'info> {
    /// CHECK: Wormhole bridge configuration account
    pub bridge: AccountInfo<'info>,
    /// CHECK: Wormhole message account to be created
    pub message: AccountInfo<'info>,
    /// CHECK: Wormhole emitter authority account
    pub emitter: AccountInfo<'info>,
    /// CHECK: Wormhole sequence tracker account
    pub sequence: AccountInfo<'info>,
    /// CHECK: Transaction fee payer
    pub payer: AccountInfo<'info>,
    /// CHECK: Wormhole fee collector account
    pub fee_collector: AccountInfo<'info>,
    /// CHECK: Clock sysvar for timestamp
    pub clock: AccountInfo<'info>,
    /// CHECK: System program for account creation
    pub system_program: AccountInfo<'info>,
    /// CHECK: Rent sysvar for account initialization
    pub rent: AccountInfo<'info>,
}

#[derive(Clone)]
pub struct WormholeProgram;

impl anchor_lang::Id for WormholeProgram {
    fn id() -> Pubkey {
        // Wormhole program ID on Solana mainnet
        "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
            .parse()
            .unwrap()
    }
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum WormholeInstruction {
    PostMessage {
        nonce: u32,
        payload: Vec<u8>,
        consistency_level: u8,
    },
}

// ================================
// MAIN PROGRAM
// ================================

#[program]
pub mod unique_low {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        name: String,
        symbol: String,
        base_uri: String,
        wormhole_program_id: Pubkey,
    ) -> Result<()> {
        let collection = &mut ctx.accounts.collection;
        collection.authority = ctx.accounts.authority.key();
        collection.name = name;
        collection.symbol = symbol;
        collection.base_uri = base_uri;
        collection.total_supply = 0;
        collection.wormhole_program_id = wormhole_program_id;
        collection.bump = ctx.bumps.collection;
        Ok(())
    }

    pub fn mint_nft(ctx: Context<MintNft>) -> Result<()> {
        let collection = &mut ctx.accounts.collection;
        let user_state = &mut ctx.accounts.user_state;

        // Generate unique ID
        let chain_id = 1u64;
        let unique_id = generate_unique_id(chain_id, &ctx.accounts.user.key(), user_state.nonce)?;

        // Check if unique ID already exists
        require!(
            !collection.unique_id_exists(unique_id),
            ErrorCode::UniqueIdAlreadyExists
        );

        // Increment counters
        collection.total_supply += 1;
        user_state.nonce += 1;

        let token_id = collection.total_supply;

        // Store mappings
        collection.add_unique_id_mapping(unique_id, token_id);
        collection.mint_to_unique_id.push(MintToUniqueId {
            mint: ctx.accounts.mint.key(),
            unique_id,
        });

        let collection_seeds = &[COLLECTION_SEED, &[collection.bump]];
        let signer = &[&collection_seeds[..]];

        // Create mint account with 1 token supply
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: collection.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        mint_to(cpi_ctx, 1)?;

        // NO METADATA CREATION - just emit the event

        emit!(NftMinted {
            user: ctx.accounts.user.key(),
            token_id,
            unique_id,
            nonce: user_state.nonce - 1,
        });

        Ok(())
    }

    pub fn request_cross_chain_mint(
        ctx: Context<RequestCrossChainMint>,
        nonce: u32,
        target_chain_id: u16,
        recipient: [u8; 32], // 32-byte recipient address for Ethereum
    ) -> Result<()> {
        let collection = &mut ctx.accounts.collection;

        // Verify token ownership by checking token account
        require!(
            ctx.accounts.token_account.amount == 1,
            ErrorCode::NotTokenOwner
        );
        require!(
            ctx.accounts.token_account.owner == ctx.accounts.user.key(),
            ErrorCode::NotTokenOwner
        );

        // Get unique_id from mint account (derive from collection mappings)
        let unique_id = collection.get_unique_id_by_mint(&ctx.accounts.mint.key())?;

        // Create payload for Wormhole (same format as Ethereum)
        // abi.encode(recipient, uniqueId, targetChainId)
        let mut payload = Vec::new();
        payload.extend_from_slice(&recipient); // 32 bytes
        payload.extend_from_slice(&unique_id); // 32 bytes
        payload.extend_from_slice(&target_chain_id.to_be_bytes()); // 2 bytes

        // Call Wormhole to publish message
        let wormhole_accounts = PublishMessage {
            bridge: ctx.accounts.wormhole_bridge.to_account_info(),
            message: ctx.accounts.wormhole_message.to_account_info(),
            emitter: ctx.accounts.wormhole_emitter.to_account_info(),
            sequence: ctx.accounts.wormhole_sequence.to_account_info(),
            payer: ctx.accounts.user.to_account_info(),
            fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
            clock: ctx.accounts.clock.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };

        let collection_key = collection.key();
        let collection_bump = collection.bump;
        // Use program as emitter authority
        let collection_seeds = &[COLLECTION_SEED, collection_key.as_ref(), &[collection_bump]];
        let signer = &[&collection_seeds[..]];

        let wormhole_ctx = CpiContext::new_with_signer(
            ctx.accounts.wormhole_program.to_account_info(),
            wormhole_accounts,
            signer,
        );

        // Consistency level 1 (same as Ethereum contract)
        let consistency_level = 1u8;

        // This would call Wormhole's publish_message
        // Note: Actual Wormhole integration requires specific account setup
        publish_message(wormhole_ctx, nonce, payload, consistency_level)?;

        // Mark as cross-chain in collection state
        collection.mark_cross_chain(unique_id);

        // Get sequence number from Wormhole (would be returned from actual call)
        let sequence_account_data = ctx.accounts.wormhole_sequence.try_borrow_data()?;
        let sequence = u64::from_le_bytes(
            sequence_account_data[0..8]
                .try_into()
                .map_err(|_| error!(ErrorCode::InvalidSequenceData))?,
        );

        emit!(CrossChainMintRequested {
            sender: ctx.accounts.user.key(),
            mint: ctx.accounts.mint.key(),
            unique_id,
            target_chain_id,
            sequence,
        });

        Ok(())
    }

    pub fn get_nonce(ctx: Context<GetNonce>) -> Result<u64> {
        Ok(ctx.accounts.user_state.nonce)
    }

    pub fn unique_id_exists(ctx: Context<CheckUniqueId>, unique_id: [u8; 32]) -> Result<bool> {
        Ok(ctx.accounts.collection.unique_id_exists(unique_id))
    }

    pub fn get_token_id_by_unique_id(
        ctx: Context<GetTokenByUniqueId>,
        unique_id: [u8; 32],
    ) -> Result<u64> {
        ctx.accounts.collection.get_token_id_by_unique_id(unique_id)
    }

    pub fn get_unique_id_by_token_id(
        ctx: Context<GetUniqueIdByToken>,
        token_id: u64,
    ) -> Result<[u8; 32]> {
        ctx.accounts.collection.get_unique_id_by_token_id(token_id)
    }

    pub fn total_supply(ctx: Context<GetTotalSupply>) -> Result<u64> {
        Ok(ctx.accounts.collection.total_supply)
    }
}

// ================================
// UTILITY FUNCTIONS
// ================================

// Same unique ID generation as Ethereum: keccak256(chainId, wallet, nonce)
fn generate_unique_id(chain_id: u64, wallet: &Pubkey, nonce: u64) -> Result<[u8; 32]> {
    let mut data = Vec::new();
    data.extend_from_slice(&chain_id.to_be_bytes()); // Big endian like Solidity
    data.extend_from_slice(&wallet.to_bytes());
    data.extend_from_slice(&nonce.to_be_bytes());
    Ok(hash(&data).to_bytes())
}

// Placeholder for Wormhole CPI call
fn publish_message<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, PublishMessage<'info>>,
    nonce: u32,
    payload: Vec<u8>,
    consistency_level: u8,
) -> Result<()> {
    let ix = Instruction {
        program_id: WormholeProgram::id(), // wormhole core bridge ID
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.bridge.key(), false),
            AccountMeta::new(ctx.accounts.message.key(), false),
            AccountMeta::new_readonly(ctx.accounts.emitter.key(), false),
            AccountMeta::new(ctx.accounts.sequence.key(), false),
            AccountMeta::new(ctx.accounts.payer.key(), true),
            AccountMeta::new(ctx.accounts.fee_collector.key(), false),
            AccountMeta::new_readonly(ctx.accounts.clock.key(), false),
            AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        ],
        data: WormholeInstruction::PostMessage {
            nonce,
            payload,
            consistency_level,
        }
        .try_to_vec()?,
    };

    invoke_signed(
        &ix,
        &[
            ctx.accounts.bridge.clone(),
            ctx.accounts.message.clone(),
            ctx.accounts.emitter.clone(),
            ctx.accounts.sequence.clone(),
            ctx.accounts.payer.clone(),
            ctx.accounts.fee_collector.clone(),
            ctx.accounts.clock.clone(),
            ctx.accounts.rent.clone(),
            ctx.accounts.system_program.clone(),
        ],
        ctx.signer_seeds,
    )?;

    Ok(())
}