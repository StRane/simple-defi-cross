import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { UniqueId } from "../target/types/unique_id";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { assert } from "chai";

describe("unique-id-no-metadata", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.UniqueId as Program<UniqueId>;
  
  let authority: Keypair;
  let user: Keypair;
  let collectionPda: PublicKey;
  let collectionBump: number;
  let userStatePda: PublicKey;
  
  const collectionName = "Test Collection";
  const collectionSymbol = "TEST";
  const baseUri = "https://example.com/metadata/";
  // const wormholeProgramId = Keypair.generate().publicKey;
  const wormholeProgramId = new PublicKey("11111111111111111111111111111111");
  
  const COLLECTION_SEED = Buffer.from("collection");
  const USER_STATE_SEED = Buffer.from("user_state");

  before(async () => {
    authority = provider.wallet.payer;
    user = Keypair.generate();
    
    // Airdrop SOL
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);
    
    // Derive PDAs
    [collectionPda, collectionBump] = PublicKey.findProgramAddressSync(
      [COLLECTION_SEED],
      program.programId
    );
    
    [userStatePda] = PublicKey.findProgramAddressSync(
      [USER_STATE_SEED, user.publicKey.toBuffer()],
      program.programId
    );
  });

  describe("Initialize", () => {
    it("Initializes collection", async () => {
      try {
        const existing = await program.account.collection.fetchNullable(collectionPda);
        if (!existing) {
          await program.methods
            .initialize(collectionName, collectionSymbol, baseUri, wormholeProgramId)
            .accounts({
              authority: authority.publicKey,
            })
            .rpc();
        }
        
        const collection = await program.account.collection.fetch(collectionPda);
        assert.exists(collection);
        console.log("Collection initialized");
      } catch (error) {
        console.log("Collection already exists");
      }
    });
  });

  describe("Mint NFT Without Metadata", () => {
    let mintKeypair: Keypair;
    let tokenAccount: PublicKey;

    beforeEach(() => {
      mintKeypair = Keypair.generate();
    });

    it("Successfully mints an NFT without metadata", async () => {
      tokenAccount = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        user.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Get initial state
      const collectionBefore = await program.account.collection.fetch(collectionPda);
      const initialSupply = collectionBefore.totalSupply.toNumber();

      // Mint NFT (without metadata account)
      const tx = await program.methods
        .mintNft()
        .accounts({
          mint: mintKeypair.publicKey,
          user: user.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user, mintKeypair])
        .rpc();

      console.log("Mint transaction:", tx);

      // Verify state updates
      const collectionAfter = await program.account.collection.fetch(collectionPda);
      assert.equal(collectionAfter.totalSupply.toNumber(), initialSupply + 1);
      
      // Verify user state
      const userState = await program.account.userState.fetch(userStatePda);
      assert.equal(userState.nonce.toNumber(), 1);
      
      // Verify mappings
      assert.equal(collectionAfter.uniqueIdToTokenId.length, initialSupply + 1);
      assert.equal(collectionAfter.tokenIdToUniqueId.length, initialSupply + 1);
      assert.equal(collectionAfter.mintToUniqueId.length, initialSupply + 1);
      
      // Verify mint is in mappings
      const mintMapping = collectionAfter.mintToUniqueId.find(
        m => m.mint.toBase58() === mintKeypair.publicKey.toBase58()
      );
      assert.exists(mintMapping);
      
      console.log("NFT minted successfully!");
      console.log("Token ID:", collectionAfter.totalSupply.toNumber());
      console.log("Unique ID exists:", mintMapping !== undefined);
    });

    it("Mints multiple NFTs", async () => {
      const mint1 = Keypair.generate();
      const mint2 = Keypair.generate();
      
      // Mint first NFT
      await program.methods
        .mintNft()
        .accounts({
          mint: mint1.publicKey,
          user: user.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user, mint1])
        .rpc();
      
      // Mint second NFT
      await program.methods
        .mintNft()
        .accounts({
          mint: mint2.publicKey,
          user: user.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user, mint2])
        .rpc();
      
      // Verify nonce incremented
      const userState = await program.account.userState.fetch(userStatePda);
      assert.isAtLeast(userState.nonce.toNumber(), 3);
      
      // Verify total supply
      const collection = await program.account.collection.fetch(collectionPda);
      assert.isAtLeast(collection.totalSupply.toNumber(), 3);
      
      console.log("Multiple NFTs minted successfully!");
      console.log("User nonce:", userState.nonce.toNumber());
      console.log("Total supply:", collection.totalSupply.toNumber());
    });
  });

  describe("View Functions", () => {
    it("Gets nonce", async () => {
      const nonce = await program.methods
        .getNonce()
        .accounts({
          userState: userStatePda,
        })
        .view();
      
      assert.isAtLeast(nonce.toNumber(), 1);
      console.log("Nonce:", nonce.toNumber());
    });

    it("Gets total supply", async () => {
      const totalSupply = await program.methods
        .totalSupply()
        .accounts({
          collection: collectionPda,
        })
        .view();
      
      assert.isAtLeast(totalSupply.toNumber(), 1);
      console.log("Total supply:", totalSupply.toNumber());
    });

    it("Checks unique ID exists", async () => {
      const collection = await program.account.collection.fetch(collectionPda);
      
      if (collection.uniqueIdToTokenId.length > 0) {
        const existingUniqueId = collection.uniqueIdToTokenId[0].uniqueId;
        
        const exists = await program.methods
          .uniqueIdExists(existingUniqueId)
          .accounts({
            collection: collectionPda,
          })
          .view();
        
        assert.isTrue(exists);
        console.log("Existing unique ID found:", existingUniqueId);
      }
      
      // Check non-existent
      const fakeUniqueId = Array(32).fill(255);
      const notExists = await program.methods
        .uniqueIdExists(fakeUniqueId)
        .accounts({
          collection: collectionPda,
        })
        .view();
      
      assert.isFalse(notExists);
    });

    it("Gets token ID by unique ID", async () => {
      const collection = await program.account.collection.fetch(collectionPda);
      
      if (collection.uniqueIdToTokenId.length > 0) {
        const mapping = collection.uniqueIdToTokenId[0];
        
        const tokenId = await program.methods
          .getTokenIdByUniqueId(mapping.uniqueId)
          .accounts({
            collection: collectionPda,
          })
          .view();
        
        assert.equal(tokenId.toString(), mapping.tokenId.toString());
        console.log("Token ID retrieved:", tokenId.toNumber());
      }
    });
  });
});