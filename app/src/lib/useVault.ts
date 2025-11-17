import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import {
    PublicKey,
    Commitment,
} from '@solana/web3.js';
import { AnchorWallet } from '@solana/wallet-adapter-react';

import type { SimpleVault } from '@/types/simple_vault';
import IDL from '@/../../target/idl/simple_vault.json';

// Import stores
import { useNetworkStore } from '@/store/networkStore';
import { useVaultStore, type VaultData, type UserPosition } from '@/store/vaultStore';

// Import selection context
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { useTokenSelection, useNFTSelection } from '@/context/SelectionContext';

// Import new config structure
import { CONFIG, VaultUtils } from '@/config/programs';

export interface UseVaultReturn {
    // Store state (read-only)
    program: Program<SimpleVault> | null;
    vault: VaultData | null;
    selectedNFTPosition: UserPosition | null;
    allUserPositions: UserPosition[];
    loading: boolean;
    userPositionLoading: boolean;
    error: string | null;

    // Network state (read-only)
    connection: any | null;
    currentNetwork: string | null;
    isSolanaNetwork: boolean;
    isNetworkReady: boolean;

    // AppKit state (read-only)
    isConnected: boolean;
    walletAddress: string | undefined;

    // Selection state (read-only)
    selectedTokenMint: PublicKey | null;
    selectedTokenAccount: PublicKey | null;
    selectedNFT: PublicKey | null;
    hasRequiredSelections: boolean;

    // Computed values
    programId: string;
    vaultConfig: typeof CONFIG;

    // Actions only (no direct data fetching in components)
    deposit: (amount: BN, assetMint: PublicKey, userNftMint: PublicKey) => Promise<string | null>;
    withdraw: (shares: BN, assetMint: PublicKey, userNftMint: PublicKey) => Promise<string | null>;
    lock: (amount: BN, assetMint: PublicKey, userNftMint: PublicKey, tier: number) => Promise<string | null>;
    transactionState: TransactionState;

    // Store actions
    refreshVaultData: () => void;
    refreshUserPosition: () => void;
    refreshAllData: () => void;
}

export enum TransactionStatus {
    IDLE = 'idle',
    BUILDING = 'building',
    SIGNING = 'signing',
    CONFIRMING = 'confirming',
    SUCCESS = 'success',
    FAILED = 'failed'
}

export interface TransactionState {
    status: TransactionStatus;
    signature: string | null;
    error: string | null;
    message: string;
}


export const useVault = (): UseVaultReturn => {

    // AppKit hooks (wallet info only)
    const { address, isConnected } = useAppKitAccount();
    const { walletProvider } = useAppKitProvider<AnchorWallet>('solana');
    const [transactionState, setTransactionState] = useState<TransactionState>({
        status: TransactionStatus.IDLE,
        signature: null,
        error: null,
        message: ''
    });

    // Network store (read-only)
    const { connection, currentNetwork, isSolanaNetwork, isReady: isNetworkReady } = useNetworkStore();

    // Vault store (read-only)
    const {
        program,
        vault,
        selectedNFTPosition,
        allUserPositions,
        loading,
        userPositionLoading,
        error,
        setProgram,
        setVault,
        updateUserPositionForNFT,
        setUserPositionLoading,
        clearUserPositions,
        setLoading,
        setError,
    } = useVaultStore();

    // Selection context (read-only)
    const {
        selectedTokenAccount,
        selectedTokenMint,
    } = useTokenSelection();

    const { selectedNFT } = useNFTSelection();


    // Loading guards to prevent concurrent operations
    const hasInitializedProgram = useRef(false);
    const hasLoadedVaultData = useRef(false);
    const isLoadingUserPosition = useRef(false);

    // Derived state
    const hasRequiredSelections = !!(selectedTokenMint && selectedTokenAccount && selectedNFT);

    // Network change effect - resets loading flags only
    useEffect(() => {
        const unsubscribe = useNetworkStore.subscribe((state, prevState) => {
            if (state.currentNetwork !== prevState?.currentNetwork) {
                hasInitializedProgram.current = false;
                hasLoadedVaultData.current = false;
                isLoadingUserPosition.current = false;
                clearUserPositions();
            }
        });
        return unsubscribe;
    }, [clearUserPositions]);

    // Program initialization effect - ONLY sets up program
    useEffect(() => {

        const initializeProgram = async () => {
            if (hasInitializedProgram.current) {
                return;
            }

            if (!connection || !address || !walletProvider || !isNetworkReady || !isSolanaNetwork) {
                return;
            }

            try {
                hasInitializedProgram.current = true;

                const provider = new AnchorProvider(
                    connection,
                    walletProvider,
                    {
                        preflightCommitment: 'processed' as Commitment,
                        commitment: 'processed' as Commitment
                    }
                );

                const programInstance = new Program<SimpleVault>(
                    IDL as SimpleVault,
                    provider
                );

                setProgram(programInstance);

            } catch (err) {
                setError(`Program initialization failed: ${(err as Error).message}`);
                hasInitializedProgram.current = false;
            }
        };

        if (connection && address && walletProvider && isNetworkReady && isSolanaNetwork && !hasInitializedProgram.current) {
            initializeProgram();
        }

    }, [connection, address, walletProvider, isNetworkReady, isSolanaNetwork, setProgram, setError]);

    // Vault data loading effect - ONLY loads vault data when program is ready
    useEffect(() => {
        const loadVaultData = async () => {
            if (hasLoadedVaultData.current) {
                return;
            }

            if (!program || !address || !connection) {
                return;
            }

            try {
                hasLoadedVaultData.current = true;
                setLoading(true);

                // Use derived vault PDA instead of hardcoded

                const [vaultPda] = VaultUtils.getVaultPDA();


                const vaultAccount = await program.account.vault.fetchNullable(vaultPda);

                if (vaultAccount) {
                    setVault(vaultAccount);
                } else {
                    setVault(null);
                }

            } catch (err) {
                setError(`Failed to load vault data: ${(err as Error).message}`);
                hasLoadedVaultData.current = false;
            } finally {
                setLoading(false);
            }
        };

        if (program && address && connection && !hasLoadedVaultData.current && !loading) {
            loadVaultData();
        }

    }, [program, address, connection, setVault, setLoading, setError, loading]);

    // User position loading effect - ONLY loads when NFT selection changes
    useEffect(() => {
        const loadUserPosition = async (nftMint: PublicKey) => {
            if (isLoadingUserPosition.current) {
                console.log('[useVault] User position loading already in progress, skipping');
                return;
            }

            if (!vault || !address || !program || !connection) {
                console.log('[useVault] Missing requirements for user position loading');
                return;
            }

            try {
                isLoadingUserPosition.current = true;
                setUserPositionLoading(true);

                const userPublicKey = new PublicKey(address);

                // Use derived accounts from VaultUtils
                const derivedAccounts = VaultUtils.getDerivedAccountsForUser(userPublicKey, nftMint);

                console.log('[useVault] Derived accounts for user position:', {
                    userInfoPda: derivedAccounts.userInfoPda.toBase58(),
                    userShareTokenAccount: derivedAccounts.userShareTokenAccount.toBase58(),
                    userNftTokenAccount: derivedAccounts.userNftTokenAccount.toBase58()
                });

                // Fetch the UserInfo account using derived PDA
                const userInfo = await program.account.userInfo.fetchNullable(derivedAccounts.userInfoPda);

                if (userInfo) {
                    // Calculate deposit amount based on current vault state
                    let depositAmount = Number(userInfo.shares);
                    
                    if (vault.totalShares.toNumber() > 0) {
                        try {
                            const totalAssets = await connection.getTokenAccountBalance(
                                derivedAccounts.vaultTokenAccount
                            );
                            const vaultBalance = Number(totalAssets.value.uiAmount || 0);

                            if (vaultBalance > 0) {
                                depositAmount = (Number(userInfo.shares) * vaultBalance) / Number(vault.totalShares);
                            }
                        } catch (err) {
                            console.warn('[useVault] Could not fetch vault balance for calculation:', err);
                        }
                    }

                    const currentPosition: UserPosition = {
                        user: userPublicKey,
                        nftMint: nftMint,
                        depositAmount,
                        shareAmount: Number(userInfo.shares),
                        timestamp: userInfo.depositTime.toNumber() * 1000
                    };

                    updateUserPositionForNFT(nftMint, currentPosition);
                } else {
                    updateUserPositionForNFT(nftMint, null);
                }

            } catch (err) {
                console.error('[useVault] Error loading position for selected NFT:', err);
                updateUserPositionForNFT(nftMint, null);
            } finally {
                isLoadingUserPosition.current = false;
                setUserPositionLoading(false);
            }
        };

        if (selectedNFT && vault && program && address && connection && !userPositionLoading) {
            loadUserPosition(selectedNFT);
        } else if (!selectedNFT) {
            console.log('[useVault] No NFT selected - clearing user positions');
            clearUserPositions();
        }

    }, [selectedNFT, vault, program, address, connection, updateUserPositionForNFT, setUserPositionLoading, clearUserPositions]);

    // Action functions
    const refreshVaultData = useCallback(() => {
        if (program && address && connection) {
            hasLoadedVaultData.current = false;

        }
    }, [program, address, connection]);

    const refreshUserPosition = useCallback(() => {
        if (selectedNFT && vault && program && address && connection) {
            isLoadingUserPosition.current = false;

        }
    }, [selectedNFT, vault, program, address, connection]);

    const refreshAllData = useCallback(() => {
        hasLoadedVaultData.current = false;
        isLoadingUserPosition.current = false;

    }, []);


    // Transaction functions using new config structure
    const deposit = useCallback(async (
        amount: BN,
        assetMint: PublicKey,
        userNftMint: PublicKey
    ): Promise<string | null> => {
        console.log('[useVault] === DEPOSIT START ===');
        console.log('[useVault] Deposit parameters:', {
            amount: amount.toString(),
            assetMint: assetMint.toBase58(),
            userNftMint: userNftMint.toBase58()
        });

        if (!program || !address || !connection) {
            const error = 'Missing program, address, or connection for deposit';
            console.error('[useVault] Deposit failed:', error);

            setTransactionState({
                status: TransactionStatus.FAILED,
                signature: null,
                error: 'Connection error',
                message: 'Wallet not connected or program not loaded'
            });

            return null;
        }

        try {
            // Reset state and start building
            setTransactionState({
                status: TransactionStatus.BUILDING,
                signature: null,
                error: null,
                message: 'Building transaction and deriving accounts...'
            });

            setLoading(true);

            const userWallet = new PublicKey(address);

            // Use VaultUtils to derive all accounts - no more hardcoded values!
            const accounts = VaultUtils.getDerivedAccountsForUser(userWallet, userNftMint);


            // Update state to signing
            setTransactionState({
                status: TransactionStatus.SIGNING,
                signature: null,
                error: null,
                message: 'Please sign the transaction in your wallet...'
            });


            // Execute transaction with derived accounts
            const tx = await program.methods
                .deposit(amount)
                .accounts({
                    user: userWallet,
                    vault: accounts.vaultPda,
                    nftCollection: accounts.collectionPda,
                    userNftToken: accounts.userNftTokenAccount,
                    userNftMint: userNftMint,
                    assetMint: assetMint,
                    vaultTokenAccount: accounts.vaultTokenAccount,
                    shareMint: CONFIG.SHARE_MINT,
                })
                .rpc();

            // Update state to confirming
            setTransactionState({
                status: TransactionStatus.CONFIRMING,
                signature: tx,
                error: null,
                message: 'Transaction sent, waiting for network confirmation...'
            });


            // Wait for confirmation
            try {
                const confirmation = await connection.confirmTransaction(tx, 'confirmed');

                if (confirmation.value.err) {
                    throw new Error(`Transaction failed during confirmation: ${confirmation.value.err}`);
                }

                // Success state
                setTransactionState({
                    status: TransactionStatus.SUCCESS,
                    signature: tx,
                    error: null,
                    message: 'Deposit successful! Transaction confirmed on network.'
                });

                console.log('[useVault] Transaction confirmed successfully');

                // Schedule data refresh and final success message
                setTimeout(() => {
                    refreshAllData();
                    setTransactionState({
                        status: TransactionStatus.SUCCESS,
                        signature: tx,
                        error: null,
                        message: 'Balances updated successfully!'
                    });

                    // Reset to idle after showing success
                    setTimeout(() => {
                        setTransactionState({
                            status: TransactionStatus.IDLE,
                            signature: null,
                            error: null,
                            message: ''
                        });
                    }, 3000);
                }, 1000);

                return tx;

            } catch (confirmError) {


                setTransactionState({
                    status: TransactionStatus.FAILED,
                    signature: tx,
                    error: `Confirmation failed: ${(confirmError as Error).message}`,
                    message: 'Transaction was sent but network confirmation failed. Check the transaction status manually.'
                });

                // Reset to idle after showing error
                setTimeout(() => {
                    setTransactionState({
                        status: TransactionStatus.IDLE,
                        signature: null,
                        error: null,
                        message: ''
                    });
                }, 5000);

                return null;
            }

        } catch (err) {
            console.error('[useVault] Deposit error:', err);

            let errorMessage = 'Transaction failed';
            let userMessage = 'An unexpected error occurred';

            if (err instanceof Error) {
                if (err.message.includes('User rejected') || err.message.includes('rejected')) {
                    errorMessage = 'Transaction cancelled';
                    userMessage = 'Transaction was cancelled by user';
                } else if (err.message.includes('already been processed')) {
                    errorMessage = 'Duplicate transaction';
                    userMessage = 'This transaction has already been processed';
                } else if (err.message.includes('insufficient funds')) {
                    errorMessage = 'Insufficient funds';
                    userMessage = 'Insufficient funds to complete the transaction';
                } else if (err.message.includes('overflow')) {
                    errorMessage = 'Amount too large';
                    userMessage = 'Transaction amount causes mathematical overflow. Try a smaller amount.';
                } else {
                    errorMessage = err.message;
                    userMessage = `Transaction failed: ${err.message}`;
                }
            }

            setTransactionState({
                status: TransactionStatus.FAILED,
                signature: null,
                error: errorMessage,
                message: userMessage
            });

            // Reset to idle after showing error
            setTimeout(() => {
                setTransactionState({
                    status: TransactionStatus.IDLE,
                    signature: null,
                    error: null,
                    message: ''
                });
            }, 5000);

            console.log('[useVault] === DEPOSIT END (ERROR) ===');
            return null;
        } finally {
            setLoading(false);
        }
    }, [program, address, connection, selectedTokenAccount, setLoading, refreshAllData]);

    const withdraw = useCallback(async (
        shares: BN,
        assetMint: PublicKey,
        userNftMint: PublicKey
    ): Promise<string | null> => {
        console.log('[useVault] === WITHDRAW START ===');
        console.log('[useVault] Withdraw parameters:', {
            shares: shares.toString(),
            assetMint: assetMint.toBase58(),
            userNftMint: userNftMint.toBase58()
        });

        if (!program || !address || !connection) {
            const error = 'Missing program, address, or connection for withdraw';
            console.error('[useVault] Withdraw failed:', error);

            setTransactionState({
                status: TransactionStatus.FAILED,
                signature: null,
                error: 'Connection error',
                message: 'Wallet not connected or program not loaded'
            });

            return null;
        }

        try {
            // Reset state and start building
            setTransactionState({
                status: TransactionStatus.BUILDING,
                signature: null,
                error: null,
                message: 'Building withdraw transaction and deriving accounts...'
            });

            setLoading(true);

            const userWallet = new PublicKey(address);

            // Use VaultUtils to derive all accounts - same as deposit!
            const accounts = VaultUtils.getDerivedAccountsForUser(userWallet, userNftMint);


            // Validate user has enough shares
            try {
                const shareTokenInfo = await connection.getTokenAccountBalance(accounts.userShareTokenAccount);
                const availableShares = new BN(shareTokenInfo.value.amount);

                if (availableShares.lt(shares)) {
                    throw new Error(`Insufficient shares. Available: ${availableShares.toString()}, Requested: ${shares.toString()}`);
                }
            } catch (err) {
                throw new Error(`Cannot validate share balance: ${(err as Error).message}`);
            }

            // Update state to signing
            setTransactionState({
                status: TransactionStatus.SIGNING,
                signature: null,
                error: null,
                message: 'Please sign the withdraw transaction in your wallet...'
            });


            // Execute withdraw transaction with derived accounts
            const tx = await program.methods
                .withdraw(shares)
                .accounts({
                    user: userWallet,
                    vault: accounts.vaultPda,
                    nftCollection: accounts.collectionPda,
                    userNftToken: accounts.userNftTokenAccount,
                    userNftMint: userNftMint,
                    assetMint: assetMint,
                    vaultTokenAccount: accounts.vaultTokenAccount,
                    shareMint: CONFIG.SHARE_MINT,
                })
                .rpc();


            // Update state to confirming
            setTransactionState({
                status: TransactionStatus.CONFIRMING,
                signature: tx,
                error: null,
                message: 'Transaction sent! Waiting for confirmation...'
            });

            // Wait for confirmation
            await connection.confirmTransaction(tx, 'confirmed');



            // Update state to success
            setTransactionState({
                status: TransactionStatus.SUCCESS,
                signature: tx,
                error: null,
                message: 'Withdraw completed successfully!'
            });


            refreshAllData();

            return tx;

        } catch (err) {
            const error = `Withdraw failed: ${(err as Error).message}`;
            console.error('[useVault] Withdraw error:', err);

            setTransactionState({
                status: TransactionStatus.FAILED,
                signature: null,
                error: error,
                message: 'Withdraw transaction failed'
            });

            setError(error);
            console.log('[useVault] === WITHDRAW END (ERROR) ===');
            return null;
        } finally {
            setLoading(false);
        }
    }, [program, address, connection, selectedTokenAccount, setError, setLoading, refreshAllData]);


    const lock = useCallback(
        async (
            amount: BN,
            assetMint: PublicKey,
            userNftMint: PublicKey,
            tier: number
        ): Promise<string | null> => {
            if (!program || !address || !connection) {
                setError("Program not initialized");
                return null;
            }

            try {
                setTransactionState({
                    status: TransactionStatus.BUILDING,
                    signature: null,
                    error: null,
                    message: "Building lock transaction...",
                });

                const userPublicKey = new PublicKey(address);

                // Derive user's NFT token account
                const userNftTokenAccount = await getAssociatedTokenAddress(
                    userNftMint,
                    userPublicKey
                );



                setTransactionState({
                    status: TransactionStatus.SIGNING,
                    signature: null,
                    error: null,
                    message: "Please sign the transaction in your wallet...",
                });


                const [vaultPda] = VaultUtils.getVaultPDA();

                const vaultTokenAccount = VaultUtils.getVaultTokenAccount();

                const tx = await program.methods
                    .lock(amount, tier)
                    .accounts({
                        user: userPublicKey,
                        vault: vaultPda,
                        nftCollection: CONFIG.COLLECTION_PDA,
                        userNftToken: userNftTokenAccount,
                        userNftMint: userNftMint,
                        assetMint: assetMint,
                        vaultTokenAccount: vaultTokenAccount,
                        shareMint: CONFIG.SHARE_MINT,
                    })
                    .rpc();

                setTransactionState({
                    status: TransactionStatus.CONFIRMING,
                    signature: tx,
                    error: null,
                    message: "Confirming transaction...",
                });

                await connection.confirmTransaction(tx);

                setTransactionState({
                    status: TransactionStatus.SUCCESS,
                    signature: tx,
                    error: null,
                    message: "Lock successful!",
                });

                // Refresh vault and user data
                const vaultStore = useVaultStore.getState();
                await vaultStore.reset;

                return tx;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Lock failed";
                setTransactionState({
                    status: TransactionStatus.FAILED,
                    signature: null,
                    error: errorMessage,
                    message: errorMessage,
                });
                setError(errorMessage);
                return null;
            }
        },
        [program, address, connection]
    );
    return {
        // Store state (read-only)
        program,
        vault,
        selectedNFTPosition,
        allUserPositions,
        loading,
        userPositionLoading,
        error,

        // Network state (read-only)
        connection,
        currentNetwork,
        isSolanaNetwork,
        isNetworkReady,

        // AppKit state (read-only)
        isConnected,
        walletAddress: address,

        // Selection state (read-only)
        selectedTokenMint,
        selectedTokenAccount,
        selectedNFT,
        hasRequiredSelections,

        // Computed values
        programId: CONFIG.VAULT_PROGRAM_ID.toBase58(),
        vaultConfig: CONFIG,
        transactionState,

        // Actions only
        deposit,
        withdraw,
        lock,
        refreshVaultData,
        refreshUserPosition,
        refreshAllData,
    };
};