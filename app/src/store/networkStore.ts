import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { Connection } from '@solana/web3.js';

const CONFIG = {
    RPC_ENDPOINTS: {
        'solana-testnet': 'https://api.testnet.solana.com',
        'solana-devnet': 'https://api.devnet.solana.com',
        'solana-mainnet': 'https://api.mainnet-beta.solana.com',
        'solana-localnet': 'http://localhost:8899',
        'Solana Local': 'http://localhost:8899',
    },
};

export interface NetworkState {
    currentNetwork: string | null;
    connection: Connection | null;
    isSolanaNetwork: boolean;
    isReady: boolean;
    error: string | null;
}

export interface NetworkStore extends NetworkState {
    // Actions
    syncNetworkFromAppKit: (networkName: string | null, caipNetworkId: string | null) => void;
    setConnection: (connection: Connection | null) => void;
    setCurrentNetwork: (network: string | null) => void;
    setError: (error: string | null) => void;
    reset: () => void;

    // Computed getters
    getRpcUrl: () => string;
    isConnected: () => boolean;
}

const initialState: NetworkState = {
    currentNetwork: null,
    connection: null,
    isSolanaNetwork: false,
    isReady: false,
    error: null,
};

export const useNetworkStore = create<NetworkStore>()(
    devtools(
        persist(
            immer((set, get) => ({
                ...initialState,

                // Main sync method - called by hooks when AppKit network changes
                syncNetworkFromAppKit: (networkName, caipNetworkId) => set((state) => {


                    const isSolanaNetwork = caipNetworkId ? (
                        caipNetworkId.includes('solana:') ||
                        caipNetworkId.startsWith('4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z') ||
                        caipNetworkId.startsWith('EtWTRABZaYq6iMfeYKouRu166VU2xqa1') ||
                        caipNetworkId.startsWith('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') ||
                        caipNetworkId.startsWith('8E9rvCKLFQia2Y35HXjjpWzj8weVo44K') ||
                        (networkName?.toLowerCase().includes('solana') || false)
                    ) : (networkName?.toLowerCase().includes('solana') || false);

                    // Update Solana detection
                    state.isSolanaNetwork = isSolanaNetwork;
                    state.error = null;

                    if (isSolanaNetwork && networkName) {
                        // Always update the current network
                        state.currentNetwork = networkName;

                        // Check if we need to create a new connection
                        if (!state.connection) {


                            try {
                                const rpcUrl = CONFIG.RPC_ENDPOINTS[networkName as keyof typeof CONFIG.RPC_ENDPOINTS]
                                    || CONFIG.RPC_ENDPOINTS['solana-testnet'];


                                const newConnection = new Connection(rpcUrl, 'confirmed');

                                // Use the setConnection method instead of direct assignment
                                state.connection = newConnection;
                                state.isReady = true;


                            } catch (err) {

                                state.error = `Failed to connect to ${networkName}: ${(err as Error).message}`;
                                state.connection = null;
                                state.isReady = false;
                            }
                        }

                    } else {
                        // Not on Solana network or no network - clear everything

                        state.currentNetwork = null;
                        state.connection = null;
                        state.isReady = false;

                        if (!isSolanaNetwork && networkName) {
                            state.error = `Unsupported network: ${networkName}`;
                        }
                    }

                }),

                setConnection: (connection) => set((state) => {

                    state.connection = connection;
                    state.isReady = !!connection;
                }),

                setCurrentNetwork: (network) => set((state) => {
                    state.currentNetwork = network;
                    if (!network) {
                        state.connection = null;
                        state.isReady = false;
                    }
                }),

                setError: (error) => set((state) => {
                    state.error = error;
                }),

                reset: () => set((state) => {


                    Object.assign(state, initialState);

                }),

                // Computed getters
                getRpcUrl: () => {
                    const state = get();
                    if (!state.currentNetwork) return CONFIG.RPC_ENDPOINTS['solana-testnet'];
                    return CONFIG.RPC_ENDPOINTS[state.currentNetwork as keyof typeof CONFIG.RPC_ENDPOINTS]
                        || CONFIG.RPC_ENDPOINTS['solana-testnet'];
                },

                isConnected: () => {
                    const state = get();
                    return state.isSolanaNetwork && !!state.connection && state.isReady;
                },
            })),
            {
                name: 'network-store',
                partialize: (state) => ({
                    // Only persist network preference, not connection objects
                    currentNetwork: state.currentNetwork,
                }),
            }
        ),
        { name: 'network-store' }
    )
);

// Selectors
export const selectNetworkState = (state: NetworkStore) => ({
    currentNetwork: state.currentNetwork,
    connection: state.connection,
    isSolanaNetwork: state.isSolanaNetwork,
    isReady: state.isReady,
    error: state.error,
});

export const selectConnection = (state: NetworkStore) => state.connection;
export const selectCurrentNetwork = (state: NetworkStore) => state.currentNetwork;
export const selectIsSolanaNetwork = (state: NetworkStore) => state.isSolanaNetwork;
export const selectIsNetworkReady = (state: NetworkStore) => state.isReady;
export const selectNetworkError = (state: NetworkStore) => state.error;