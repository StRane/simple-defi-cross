use anchor_lang::prelude::*;

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