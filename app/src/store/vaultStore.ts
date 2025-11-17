import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { SimpleVault } from '@/types/simple_vault';
import { useNetworkStore } from './networkStore';
import { BN } from '@coral-xyz/anchor';
import { CONFIG, VaultUtils } from '@/config/programs';

export interface VaultData {
    owner: PublicKey;
    assetMint: PublicKey;
    shareMint: PublicKey;
    nftCollectionAddress: PublicKey;
    lastUpdateTime: BN;
    reserveFactor: BN;
    totalReserves: BN;
    totalShares: BN;
    totalLockedShares: BN;
    totalUnlockedShares: BN;
    bump: number;
}
export type LockTier = {
  unlocked: Record<string, never>;
} | {
  short: Record<string, never>;
} | {
  long: Record<string, never>;
} | {
  veryLong: Record<string, never>;
};

export interface UserPosition {
    user: PublicKey;
    nftMint: PublicKey;
    depositAmount: BN;
    shares: BN;      
    lockedUntil: BN;     
    lockTier: LockTier;    
    depositTime: BN;
}

export const getLockTierName = (tier: LockTier): string => {
  if ('unlocked' in tier) return "Unlocked";
  if ('short' in tier) return "Short (30 days)";
  if ('long' in tier) return "Long (6 months)";
  if ('veryLong' in tier) return "VeryLong (12 months)";
  return "Unknown";
};

export const isLocked = (lockedUntil: BN): boolean => {
  return lockedUntil.toNumber() > Date.now() / 1000;
};

export const getTimeRemaining = (lockedUntil: BN): string => {
  const remaining = lockedUntil.toNumber() - Date.now() / 1000;
  if (remaining <= 0) return "Unlocked";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export interface VaultState {
    // Program state
    program: Program<SimpleVault> | null;
    isInitialized: boolean;

    // Vault data
    vault: VaultData | null;

    // User position state (separated)
    selectedNFTPosition: UserPosition | null;
    allUserPositions: UserPosition[];
    userPositionLoading: boolean;

    // UI state
    loading: boolean;
    error: string | null;

    // Network dependency tracking
    lastNetworkHash: string | null;
}

export interface VaultStore extends VaultState {
    // Program actions
    setProgram: (program: Program<SimpleVault> | null) => void;
    setIsInitialized: (initialized: boolean) => void;

    // Vault data actions
    setVault: (vault: VaultData | null) => void;

    // User position actions (separated)
    updateUserPositionForNFT: (nftMint: PublicKey, position: UserPosition | null) => void;
    setUserPositionLoading: (loading: boolean) => void;
    clearUserPositions: () => void;

    // UI actions
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;

    // Network synchronization (ONLY syncs network state, NO data loading)
    syncWithNetwork: () => void;
    reset: () => void;

    // Computed getters
    getPositionByNFT: (nftMint: PublicKey) => UserPosition | null;
    getTotalDeposited: () => number;
    getTotalShares: () => number;
    hasPositions: () => boolean;
    getVaultConfig: () => typeof CONFIG;
}

const initialState: VaultState = {
    program: null,
    isInitialized: false,
    vault: null,
    selectedNFTPosition: null,
    allUserPositions: [],
    userPositionLoading: false,
    loading: false,
    error: null,
    lastNetworkHash: null,
};

export const useVaultStore = create<VaultStore>()(
    devtools(
        immer((set, get) => ({
            ...initialState,

            // Program actions
            setProgram: (program) => set((state) => {
                state.program = program;
                state.isInitialized = !!program;
            }),

            setIsInitialized: (initialized) => set((state) => {

                state.isInitialized = initialized;
            }),

            // Vault data actions
            setVault: (vault) => set((state) => {

                state.vault = vault;

            }),

            // User position actions (separated)
            updateUserPositionForNFT: (nftMint, position) => set((state) => {


                if (position) {
                    state.selectedNFTPosition = position;

                    // Update allUserPositions array
                    const index = state.allUserPositions.findIndex(p =>
                        p.nftMint.equals(nftMint)
                    );
                    if (index >= 0) {
                        state.allUserPositions[index] = position;
                    } else {
                        state.allUserPositions.push(position);
                    }
                } else {
                    state.selectedNFTPosition = null;
                    state.allUserPositions = state.allUserPositions.filter(p =>
                        !p.nftMint.equals(nftMint)
                    );
                }


            }),

            setUserPositionLoading: (loading) => set((state) => {
 
                state.userPositionLoading = loading;
            }),

            clearUserPositions: () => set((state) => {

                state.selectedNFTPosition = null;
                state.allUserPositions = [];
                state.userPositionLoading = false;

            }),

            // UI actions
            setLoading: (loading) => set((state) => {
                state.loading = loading;
            }),

            setError: (error) => set((state) => {
                state.error = error;
                if (error) {
                    console.error('[VaultStore] Error details:', error);
                }
            }),

            // Network synchronization (ONLY syncs network state, NO data loading)
            syncWithNetwork: () => set((state) => {

                const networkState = useNetworkStore.getState();
                const networkHash = `${networkState.currentNetwork}-${networkState.isReady}-${!!networkState.connection}`;


                // Only update hash and reset data if network actually changed
                if (state.lastNetworkHash !== networkHash) {
                    state.lastNetworkHash = networkHash;

                    // Reset data when network changes, but DON'T trigger loading
                    state.vault = null;
                    state.program = null;
                    state.selectedNFTPosition = null;
                    state.allUserPositions = [];
                    state.userPositionLoading = false;
                    state.loading = false;
                    state.error = null;

                }

            }),

            reset: () => set((state) => {
                Object.assign(state, initialState);
            }),

            // Computed getters
            getPositionByNFT: (nftMint) => {
                const state = get();
                const position = state.allUserPositions.find(p => p.nftMint.equals(nftMint));
                return position || null;
            },

            getTotalDeposited: () => {
                const state = get();
                const total = state.allUserPositions.reduce((total, position) => total + position.depositAmount.toNumber(), 0);
                return total;
            },

            getTotalShares: () => {
                const state = get();
                const total = state.allUserPositions.reduce((total, position) => total + position.shares.toNumber(), 0);

                return total;
            },

            hasPositions: () => {
                const state = get();
                const hasPositions = state.allUserPositions.length > 0;

                return hasPositions;
            },

            getVaultConfig: () => {
                return CONFIG;
            },
        })),
        { name: 'vault-store' }
    )
);

// Auto-sync with network store changes (ONLY network sync, NO data loading)

useNetworkStore.subscribe(
    () => {
       useVaultStore.getState().syncWithNetwork(); // ONLY syncs network state   
    }
);

// Selectors
export const selectVaultState = (state: VaultStore) => ({
    program: state.program,
    isInitialized: state.isInitialized,
    loading: state.loading,
    error: state.error,
});

export const selectVaultData = (state: VaultStore) => ({
    vault: state.vault,
    selectedNFTPosition: state.selectedNFTPosition,
    allUserPositions: state.allUserPositions,
    userPositionLoading: state.userPositionLoading,
});


export const selectVaultProgram = (state: VaultStore) => state.program;
export const selectVault = (state: VaultStore) => state.vault;
export const selectUserPositions = (state: VaultStore) => state.allUserPositions;
export const selectSelectedNFTPosition = (state: VaultStore) => state.selectedNFTPosition;
export const selectVaultLoading = (state: VaultStore) => state.loading;
export const selectUserPositionLoading = (state: VaultStore) => state.userPositionLoading;
export const selectVaultError = (state: VaultStore) => state.error;
export const selectVaultConfig = () => CONFIG;