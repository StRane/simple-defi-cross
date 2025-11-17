import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import {
  PublicKey,
  Keypair,
  Commitment,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { AnchorWallet } from '@solana/wallet-adapter-react';

import type { UniqueLow } from '@/types/unique_low';
import IDL from '@/../../target/idl/unique_low.json';

// Import stores
import { useNetworkStore } from '@/store/networkStore';
import { useUniqueIdStore, type MintedNFT } from '@/store/uniqueIdStore';

// Import new config structure
import { CONFIG } from '@/config/programs';

export interface UseUniqueIdReturn {
  // Store state (read-only)
  program: Program<UniqueLow> | null;
  collection: any | null;
  userState: any | null;
  totalSupply: number;
  userNonce: number;
  isCollectionInitialized: boolean;
  loading: boolean;
  error: string | null;

  // Network state (read-only)
  connection: any | null;
  currentNetwork: string | null;
  isSolanaNetwork: boolean;
  isNetworkReady: boolean;

  // AppKit state (read-only)
  isConnected: boolean;
  walletAddress: string | undefined;

  // Local state
  userStatePda: PublicKey | null;
  collectionPda: PublicKey;

  // Computed values
  programId: string;

  // Actions only (no direct data fetching in components)
  initializeCollection: (name: string, symbol: string, baseUri: string) => Promise<string | null>;
  mintNFT: () => Promise<MintedNFT | null>;
  mintMultipleNFTs: (count: number) => Promise<MintedNFT[] | null>;
  uniqueIdExists: (uniqueId: number[]) => Promise<boolean>;
  getTokenIdByUniqueId: (uniqueId: number[]) => Promise<number | null>;
  getUniqueIdByTokenId: (tokenId: number) => Promise<number[] | null>;
  getUniqueIdByMint: (mint: PublicKey) => Promise<number[] | null>;
  
  // Store actions
  refreshAllData: () => void;
}

export const useUniqueId = (): UseUniqueIdReturn => {

  // AppKit hooks (wallet info only)
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<AnchorWallet>('solana');

  // Network store (read-only)
  const { connection, currentNetwork, isSolanaNetwork, isReady: isNetworkReady } = useNetworkStore();

  // UniqueId store (read-only + actions)
  const {
    program,
    collection,
    userState,
    totalSupply,
    userNonce,
    isCollectionInitialized,
    loading,
    error,
    setProgram,
    setCollection,
    setUserState,
    setIsCollectionInitialized,
    setLoading,
    setError,
  } = useUniqueIdStore();

  // Local state (specific to this hook)
  const [userStatePda, setUserStatePda] = useState<PublicKey | null>(null);

  // Loading guards to prevent concurrent operations
  const hasInitializedProgram = useRef(false);
  const hasLoadedNFTData = useRef(false);

  // Derived addresses
  const collectionPda = CONFIG.COLLECTION_PDA;
  const programId = CONFIG.NFT_PROGRAM_ID;


  // Network change effect - resets loading flags only
  useEffect(() => {
    const unsubscribe = useNetworkStore.subscribe((state, prevState) => {
      if (state.currentNetwork !== prevState?.currentNetwork) {
        hasInitializedProgram.current = false;
        hasLoadedNFTData.current = false;
        setUserStatePda(null);
      }
    });
    return unsubscribe;
  }, []);

  // Program initialization effect - ONLY sets up program (no manual sync)
  useEffect(() => {
 
    const initializeProgram = async () => {
      if (hasInitializedProgram.current) {
        return;
      }

      if (!connection || !address || !walletProvider || !isNetworkReady || !isSolanaNetwork) {
        return;
      }

      try {
        // console.log('[useUniqueId] Initializing program...');
        hasInitializedProgram.current = true;
        setLoading(true);
        setError(null);

        const anchorProvider = new AnchorProvider(
          connection,
          walletProvider as AnchorWallet,
          { commitment: 'confirmed' as Commitment }
        );

        const newProgram = new Program<UniqueLow>(
          IDL as UniqueLow,
          anchorProvider
        );

        // Derive user state PDA
        const [derivedUserStatePda] = PublicKey.findProgramAddressSync(
          [Buffer.from("user_state"), new PublicKey(address).toBuffer()],
          programId
        );

        // Update stores
        setProgram(newProgram);
        setUserStatePda(derivedUserStatePda);

      } catch (err) {
        // console.error('[useUniqueId] Program initialization failed:', err);
        setError(`Failed to initialize: ${(err as Error).message}`);
        hasInitializedProgram.current = false;
      } finally {
        setLoading(false);
      }
    };

    if (connection && address && walletProvider && isNetworkReady && isSolanaNetwork && !hasInitializedProgram.current) {
      // console.log('[useUniqueId] Starting program initialization...');
      initializeProgram();
    }

  }, [connection, address, walletProvider, isNetworkReady, isSolanaNetwork, programId, collectionPda, setProgram, setLoading, setError]);

  // NFT data loading effect - ONLY loads data when program is ready
  useEffect(() => {

    const loadNFTData = async () => {
      if (hasLoadedNFTData.current) {
        return;
      }

      if (!program || !userStatePda || !connection) {
        return;
      }

      try {
        
        hasLoadedNFTData.current = true;
        setLoading(true);
        
        
        
        // Fetch collection data
        const collectionData = await program.account.collection.fetchNullable(collectionPda);
        if (collectionData) {

          setCollection(collectionData);
          setIsCollectionInitialized(true);
        } else {
          
          setIsCollectionInitialized(false);
        }

        
        // Fetch user state
        const userStateData = await program.account.userState.fetchNullable(userStatePda);
        if (userStateData) {
          
          setUserState({ 
            user: userStatePda,
            nonce: userStateData.nonce.toNumber() 
          });
        } else {

          setUserState(null);
        }

        

      } catch (err) {
        setError(`Failed to load NFT data: ${(err as Error).message}`);
        hasLoadedNFTData.current = false;
      } finally {
        setLoading(false);
      }
    };

    if (program && userStatePda && connection && !hasLoadedNFTData.current && !loading) {
      
      loadNFTData();
    }

  }, [program, userStatePda, connection, collectionPda, setCollection, setUserState, setIsCollectionInitialized, setLoading, setError]);
// [program, userStatePda, connection, collectionPda, setCollection, setUserState, setIsCollectionInitialized, setLoading, setError, loading]);

  // Action functions
  const refreshAllData = useCallback(() => {

    if (program && userStatePda && connection) {
      hasLoadedNFTData.current = false;
      // The effect will automatically trigger
    }

  }, [program, userStatePda, connection]);

  // Initialize collection - ACTION only, updates store automatically
  const initializeCollection = useCallback(async (
    name: string,
    symbol: string,
    baseUri: string
  ): Promise<string | null> => {

    if (!program || !address) {
      setError('Program not initialized or wallet not connected');
      return null;
    }

    if (isCollectionInitialized) {
      setError('Collection already initialized');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // Generate a random Wormhole program ID (or use a real one if you have it)
      const wormholeProgramId = Keypair.generate().publicKey;


      const tx = await program.methods
        .initialize(name, symbol, baseUri, wormholeProgramId)
        .accounts({
          authority: new PublicKey(address),
        })
        .rpc({
          commitment: 'confirmed',
          skipPreflight: false,
        });


      // Refresh store data after successful initialization
      refreshAllData();

      return tx;
    } catch (err) {

      setError(`Failed to initialize: ${(err as Error).message}`);
      return null;
    } finally {
      setLoading(false);
    }
  }, [program, address, isCollectionInitialized, refreshAllData, setLoading, setError]);

  // Mint NFT - ACTION only, updates store automatically
  const mintNFT = useCallback(async (): Promise<MintedNFT | null> => {

    if (!program || !address || !userStatePda || !walletProvider) {
      setError('Wallet not connected or program not initialized');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const userPublicKey = new PublicKey(address);
      const mintKeypair = Keypair.generate();

      const tokenAccount = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        userPublicKey,
        false,
        TOKEN_PROGRAM_ID
      );


      const tx = await program.methods
        .mintNft()
        .accounts({
          mint: mintKeypair.publicKey,
          user: userPublicKey,
        })
        .signers([mintKeypair])
        .rpc();

      console.log('[useUniqueId] Mint transaction successful:', tx);

      // Refresh store data after successful mint
      refreshAllData();

      // Get the unique ID for this mint from refreshed collection data
      // Note: This would need to wait for the refresh to complete
      // For now, return basic NFT data
      const nftData: MintedNFT = {
        mint: mintKeypair.publicKey,
        tokenAccount,
        tokenId: (collection?.totalSupply?.toNumber() || 0) + 1,
        uniqueId: [],
        txSignature: tx,
      };

      return nftData;
    } catch (err) {
      setError(`Failed to mint NFT: ${(err as Error).message}`);
      return null;
    } finally {
      setLoading(false);
    }
  }, [program, address, userStatePda, walletProvider, collection, refreshAllData, setLoading, setError]);

  // Mint multiple NFTs - ACTION only
  const mintMultipleNFTs = useCallback(async (count: number): Promise<MintedNFT[] | null> => {

    const mintedNFTs: MintedNFT[] = [];

    for (let i = 0; i < count; i++) {

      const nft = await mintNFT();
      if (nft) {
        mintedNFTs.push(nft);
      } else {
        console.log(`[useUniqueId] Failed to mint NFT ${i + 1}, stopping batch`);
        break;
      }
    }

    return mintedNFTs.length > 0 ? mintedNFTs : null;
  }, [mintNFT]);

  // View functions - UTILITY functions (don't update store)
  const uniqueIdExists = useCallback(async (uniqueId: number[]): Promise<boolean> => {
    if (!program) return false;

    try {
      const exists = await program.methods
        .uniqueIdExists(uniqueId)
        .accounts({
          collection: collectionPda,
        })
        .view();

      return exists;
    } catch (err) {
      console.error('[useUniqueId] Error checking unique ID:', err);
      return false;
    }
  }, [program, collectionPda]);

  const getTokenIdByUniqueId = useCallback(async (uniqueId: number[]): Promise<number | null> => {
    if (!program) return null;

    try {
      const tokenId = await program.methods
        .getTokenIdByUniqueId(uniqueId)
        .accounts({
          collection: collectionPda,
        })
        .view();

      return tokenId.toNumber();
    } catch (err) {
      console.error('[useUniqueId] Error getting token ID:', err);
      return null;
    }
  }, [program, collectionPda]);

  const getUniqueIdByTokenId = useCallback(async (tokenId: number): Promise<number[] | null> => {
    if (!collection) return null;

    const mapping = collection.tokenIdToUniqueId.find(
      m => m.tokenId === tokenId
    );

    return mapping?.uniqueId || null;
  }, [collection]);

  const getUniqueIdByMint = useCallback(async (mint: PublicKey): Promise<number[] | null> => {
    if (!collection) return null;

    const mapping = collection.mintToUniqueId.find(
      m => m.mint.toBase58() === mint.toBase58()
    );

    return mapping?.uniqueId || null;
  }, [collection]);


  return {
    // Store state (read-only)
    program,
    collection,
    userState,
    totalSupply,
    userNonce,
    isCollectionInitialized,
    loading,
    error,

    // Network state (read-only)
    connection,
    currentNetwork,
    isSolanaNetwork,
    isNetworkReady,

    // AppKit state (read-only)
    isConnected: isConnected && isSolanaNetwork,
    walletAddress: address,

    // Local state
    userStatePda,
    collectionPda,

    // Computed values
    programId: programId.toBase58(),

    // Actions only
    initializeCollection,
    mintNFT,
    mintMultipleNFTs,
    uniqueIdExists,
    getTokenIdByUniqueId,
    getUniqueIdByTokenId,

    getUniqueIdByMint,
    refreshAllData,
  };
};