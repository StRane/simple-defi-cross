pub const BASE_RATE: u64 = 20_000_000;
pub const UTILIZATION_MULTIPLIER: u64 = 180_000_000;
pub const KINK: u64 = 800_000_000;
pub const JUMP_MULTIPLIER: u64 = 1_090_000_000;

pub const INITIAL_BORROW_INDEX: u64 = 1_000_000_000;
pub const MAX_RESERVE_FACTOR: u64 = 500_000_000;
pub const PRECISION: u64 = 1_000_000_000;
pub const VAULT_SEED: &[u8] = b"vault_v2";
pub const USER_SHARES_SEED: &[u8] = b"user_shares_v2";
pub const USER_INFO_SEED: &[u8] = b"user_info_v2";
pub const LOCKED_YIELD_MULTIPLIER: u64 = 50_000_000;
pub const SCALE: u64 = 1_000_000;
pub const SCALE_U128: u128 = 1_000_000;
pub const MAX_EXTENSION_RATIO: u64 = 1_000_000;
pub const MIN_EXTENSION_RATIO: u64 = 100_000;
pub const EARLY_WITHDRAWAL_PENALTY: u64 = 100_000;  // 0.10
    
pub const SECONDS_PER_DAY: i64 = 86400;
pub const SECONDS_PER_YEAR: i64 = 365 * 86400;

pub const MIN_HOLD_TIME: i64 = 7 * 86400;