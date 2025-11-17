import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { UniqueLow } from '@/types/unique_low';
import { useNetworkStore } from './networkStore';

import { CONFIG } from '@/config/programs';

export interface Collection {
    authority: PublicKey;
    name: string;
    symbol: string;
    baseUri: string;
    totalSupply: any; // BN from anchor, but we'll convert to number in store
    wormholeProgramId: PublicKey;
    uniqueIdToTokenId: Array<{ uniqueId: number[], tokenId: any }>; // tokenId is BN
    tokenIdToUniqueId: Array<{ tokenId: any, uniqueId: number[] }>; // tokenId is BN  
    mintToUniqueId: Array<{ mint: PublicKey, uniqueId: number[] }>;
}

export interface UserState {
    user: PublicKey;
    nonce: number;
}

export interface MintedNFT {
    mint: PublicKey;
    tokenAccount: PublicKey;
    tokenId: number;
    uniqueId: number[];
    txSignature: string;
}

export interface UniqueIdState {
    // Program state
    program: Program<UniqueLow> | null;
    isInitialized: boolean;

    // Collection data
    collection: Collection | null;
    userState: UserState | null;
    isCollectionInitialized: boolean;

    // NFT data
    userNFTs: MintedNFT[];
    totalSupply: number;
    userNonce: number;

    // UI state
    loading: boolean;
    error: string | null;

    // Network dependency tracking
    lastNetworkHash: string | null;
}

export interface UniqueIdStore extends UniqueIdState {
    // Program actions
    setProgram: (program: Program<UniqueLow> | null) => void;
    setIsInitialized: (initialized: boolean) => void;

    // Collection data actions
    setCollection: (collection: Collection | null) => void;
    setUserState: (userState: UserState | null) => void;
    setIsCollectionInitialized: (initialized: boolean) => void;

    // NFT data actions
    setUserNFTs: (nfts: MintedNFT[]) => void;
    addMintedNFT: (nft: MintedNFT) => void;
    setTotalSupply: (supply: number) => void;
    setUserNonce: (nonce: number) => void;

    // UI actions
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;

    // Network synchronization
    syncWithNetwork: () => void;
    reset: () => void;

    // Computed getters
    getNFTByMint: (mint: PublicKey) => MintedNFT | null;
    getNFTByTokenId: (tokenId: number) => MintedNFT | null;
    getUniqueIdByMint: (mint: PublicKey) => number[] | null;
    getTokenIdByUniqueId: (uniqueId: number[]) => number | null;
    hasNFTs: () => boolean;
    getCollectionPda: () => PublicKey;
}

const initialState: UniqueIdState = {
    program: null,
    isInitialized: false,
    collection: null,
    userState: null,
    isCollectionInitialized: false,
    userNFTs: [],
    totalSupply: 0,
    userNonce: 0,
    loading: false,
    error: null,
    lastNetworkHash: null,
};

export const useUniqueIdStore = create<UniqueIdStore>()(
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

            // Collection data actions
            setCollection: (collection) => set((state) => {

                state.collection = collection;
                if (collection) {
                    state.totalSupply = collection.totalSupply;
                    state.isCollectionInitialized = true;

                } else {
                    state.isCollectionInitialized = false;

                }

            }),

            setUserState: (userState) => set((state) => {

                state.userState = userState;
                if (userState) {
                    state.userNonce = userState.nonce;

                }
            }),

            setIsCollectionInitialized: (initialized) => set((state) => {
                state.isCollectionInitialized = initialized;
            }),

            // NFT data actions
            setUserNFTs: (nfts) => set((state) => {
                state.userNFTs = nfts;
            }),

            addMintedNFT: (nft) => set((state) => {


                const existingIndex = state.userNFTs.findIndex(n =>
                    n.mint.toBase58() === nft.mint.toBase58()
                );

                if (existingIndex >= 0) {

                    state.userNFTs[existingIndex] = nft;
                } else {

                    state.userNFTs.push(nft);
                }


            }),

            setTotalSupply: (supply) => set((state) => {

                state.totalSupply = supply;
            }),

            setUserNonce: (nonce) => set((state) => {

                state.userNonce = nonce;
            }),

            // UI actions
            setLoading: (loading) => set((state) => {

                state.loading = loading;
            }),

            setError: (error) => set((state) => {


                state.error = error;
                if (error) {
                    console.error('[UniqueIdStore] Error details:', error);
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

                        const clearedState = {
                            program: null,
                            isInitialized: false,
                            collection: null,
                            userState: null,
                            isCollectionInitialized: false,
                            userNFTs: [],
                            totalSupply: 0,
                            userNonce: 0,
                            error: null
                        };

                        Object.assign(state, clearedState);

                    } else {
                        // Network is ready - clear error and prepare for program initialization
                        state.error = null;

                    }
                }



            }),

            reset: () => set((state) => {



                Object.assign(state, initialState);


            }),

            // Computed getters
            getNFTByMint: (mint) => {
                const state = get();


                const nft = state.userNFTs.find(nft => nft.mint.equals(mint)) || null;

                return nft;
            },

            getNFTByTokenId: (tokenId) => {
                const state = get();


                const nft = state.userNFTs.find(nft => nft.tokenId === tokenId) || null;

                return nft;
            },

            getUniqueIdByMint: (mint) => {
                const state = get();


                if (!state.collection) {

                    return null;
                }

                const mapping = state.collection.mintToUniqueId.find(
                    m => m.mint.toBase58() === mint.toBase58()
                );

                const result = mapping?.uniqueId || null;

                return result;
            },

            getTokenIdByUniqueId: (uniqueId) => {
                const state = get();


                if (!state.collection) {

                    return null;
                }

                const mapping = state.collection.uniqueIdToTokenId.find(
                    m => JSON.stringify(m.uniqueId) === JSON.stringify(uniqueId)
                );

                const result = mapping?.tokenId || null;

                return result;
            },

            hasNFTs: () => {
                const state = get();
                const hasNFTs = state.userNFTs.length > 0;

                return hasNFTs;
            },

            getCollectionPda: () => {

                return CONFIG.COLLECTION_PDA;
            },
        })),
        { name: 'uniqueid-store' }
    )
);

// Auto-sync with network store changes

useNetworkStore.subscribe(
    () => {
        useUniqueIdStore.getState().syncWithNetwork();
    }
);

// Selectors
export const selectUniqueIdState = (state: UniqueIdStore) => ({
    program: state.program,
    isInitialized: state.isInitialized,
    isCollectionInitialized: state.isCollectionInitialized,
    loading: state.loading,
    error: state.error,
});

export const selectCollectionData = (state: UniqueIdStore) => ({
    collection: state.collection,
    userState: state.userState,
    totalSupply: state.totalSupply,
    userNonce: state.userNonce,
});

export const selectNFTData = (state: UniqueIdStore) => ({
    userNFTs: state.userNFTs,
});

export const selectUniqueIdProgram = (state: UniqueIdStore) => state.program;
export const selectCollection = (state: UniqueIdStore) => state.collection;
export const selectUserNFTs = (state: UniqueIdStore) => state.userNFTs;
export const selectUniqueIdLoading = (state: UniqueIdStore) => state.loading;
export const selectUniqueIdError = (state: UniqueIdStore) => state.error;
export const selectCollectionPda = () => CONFIG.COLLECTION_PDA;
