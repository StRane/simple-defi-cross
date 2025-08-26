// Seeds for PDA derivation
pub const COLLECTION_SEED: &[u8] = b"collection";
pub const USER_STATE_SEED: &[u8] = b"user_state";

// Maximum sizes for collection vectors
pub const MAX_COLLECTION_SIZE: usize = 50;

// Chain IDs
pub const SOLANA_CHAIN_ID: u64 = 1; // Solana mainnet chain ID for consistency with Ethereum

// Wormhole constants
pub const WORMHOLE_CONSISTENCY_LEVEL: u8 = 1; // Same as Ethereum contract