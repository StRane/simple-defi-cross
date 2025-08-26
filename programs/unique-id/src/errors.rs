
use anchor_lang::prelude::*;

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