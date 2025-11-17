import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { TestToken } from '@/types/test_token';
import { useNetworkStore } from './networkStore';


export interface TokenInfo {
    mint: PublicKey;
    mintAuthority: PublicKey;
    balance: number;
    decimals: number;
    supply: string;
}

export interface UserToken {
    mint: PublicKey;
    balance: number;
    account: PublicKey;
    decimals: number;
}

export interface TokenState {
    // Program state
    program: Program<TestToken> | null;
    mintAuthPda: PublicKey | null;
    isInitialized: boolean;

    // Token data
    tokenInfo: TokenInfo | null;
    userTokens: UserToken[];
    selectedToken: PublicKey | null;

    // UI state
    loading: boolean;
    error: string | null;

    // Network dependency tracking
    lastNetworkHash: string | null;
}

export interface TokenStore extends TokenState {
    // Program actions
    setProgram: (program: Program<TestToken> | null) => void;
    setMintAuthPda: (mintAuthPda: PublicKey | null) => void;
    setIsInitialized: (initialized: boolean) => void;

    // Token data actions
    setTokenInfo: (tokenInfo: TokenInfo | null) => void;
    setUserTokens: (tokens: UserToken[]) => void;
    addUserToken: (token: UserToken) => void;
    updateUserTokenBalance: (mint: PublicKey, balance: number) => void;
    setSelectedToken: (token: PublicKey | null) => void;

    // UI actions
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;

    // Network synchronization
    syncWithNetwork: () => void;
    reset: () => void;

    // Computed getters
    getTokenByMint: (mint: PublicKey) => UserToken | null;
    getTotalTokensValue: () => number;
    hasTokens: () => boolean;
}

const initialState: TokenState = {
    program: null,
    mintAuthPda: null,
    isInitialized: false,
    tokenInfo: null,
    userTokens: [],
    selectedToken: null,
    loading: false,
    error: null,
    lastNetworkHash: null,
};

export const useTokenStore = create<TokenStore>()(
    devtools(
        immer((set, get) => ({
            ...initialState,

            // Program actions
            setProgram: (program) => set((state) => {
                state.program = program;
                state.isInitialized = !!program;

            }),

            setMintAuthPda: (mintAuthPda) => set((state) => {

                state.mintAuthPda = mintAuthPda;

            }),

            setIsInitialized: (initialized) => set((state) => {
                state.isInitialized = initialized;
            }),

            // Token data actions
            setTokenInfo: (tokenInfo) => set((state) => {
                state.tokenInfo = tokenInfo;

            }),

            setUserTokens: (tokens) => set((state) => {
                state.userTokens = tokens;

            }),

            addUserToken: (token) => set((state) => {
                const existingIndex = state.userTokens.findIndex(t =>
                    t.mint.toBase58() === token.mint.toBase58()
                );

                if (existingIndex >= 0) {
                    // Update existing token
                    state.userTokens[existingIndex] = token;
                } else {
                    // Add new token
                    state.userTokens.push(token);
                }

            }),

            updateUserTokenBalance: (mint, balance) => set((state) => {
                const token = state.userTokens.find(t => t.mint.equals(mint));
                if (token) {
                    token.balance = balance;

                }
            }),

            setSelectedToken: (token) => set((state) => {
                state.selectedToken = token;

            }),

            // UI actions
            setLoading: (loading) => set((state) => {
                state.loading = loading;
            }),

            setError: (error) => set((state) => {
                state.error = error;
                if (error) {
                    console.error('[TokenStore] Error set:', error);
                }
            }),

            // Network synchronization
            syncWithNetwork: () => set((state) => {
                const networkState = useNetworkStore.getState();
                const networkHash = `${networkState.currentNetwork}-${networkState.isReady}-${!!networkState.connection}`;


                // Check if network state changed
                if (state.lastNetworkHash !== networkHash) {
                    state.lastNetworkHash = networkHash;

                    if (!networkState.isReady || !networkState.isSolanaNetwork) {
                        // Network not ready or not Solana - clear program state

                        state.program = null;
                        state.mintAuthPda = null;
                        state.isInitialized = false;
                        state.tokenInfo = null;
                        state.userTokens = [];
                        state.selectedToken = null;
                        state.error = null;
                    } else {
                        // Network is ready - clear error and prepare for program initialization

                        state.error = null;
                        // Note: Program initialization happens in the hook, not here
                    }
                }
            }),

            reset: () => set((state) => {

                Object.assign(state, initialState);
            }),

            // Computed getters
            getTokenByMint: (mint) => {
                const state = get();
                return state.userTokens.find(token => token.mint.equals(mint)) || null;
            },

            getTotalTokensValue: () => {
                const state = get();
                return state.userTokens.reduce((total, token) => total + token.balance, 0);
            },

            hasTokens: () => {
                const state = get();
                return state.userTokens.length > 0;
            },
        })),
        { name: 'token-store' }
    )
);



// Selectors
export const selectTokenState = (state: TokenStore) => ({
    program: state.program,
    mintAuthPda: state.mintAuthPda,
    isInitialized: state.isInitialized,
    loading: state.loading,
    error: state.error,
});

export const selectTokenData = (state: TokenStore) => ({
    tokenInfo: state.tokenInfo,
    userTokens: state.userTokens,
    selectedToken: state.selectedToken,
});

export const selectTokenProgram = (state: TokenStore) => state.program;
export const selectMintAuthPda = (state: TokenStore) => state.mintAuthPda;
export const selectUserTokens = (state: TokenStore) => state.userTokens;
export const selectTokenLoading = (state: TokenStore) => state.loading;
export const selectTokenError = (state: TokenStore) => state.error;