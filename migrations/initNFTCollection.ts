import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { UniqueLow } from "../target/types/unique_low";

async function main() {
  console.log("🎨 Initializing NFT Collection...\n");

  // Setup providers and programs
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const nftProgram = anchor.workspace.UniqueLow as anchor.Program<UniqueLow>;
  const wallet = provider.wallet as anchor.Wallet;

  console.log("📋 Configuration:");
  console.log("NFT Program ID:", nftProgram.programId.toBase58());
  console.log("Wallet:", wallet.publicKey.toBase58());

  // Derive collection PDA using your program's seeds
  const [collectionPda, collectionBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_v1")], // Matches COLLECTION_SEED in your lib.rs
    nftProgram.programId
  );

  console.log("Collection PDA:", collectionPda.toBase58());
  console.log("Collection Bump:", collectionBump);

  try {
    // Check if collection already exists
    console.log("\n🔍 Checking if collection already exists...");
    try {
      const existingCollection = await nftProgram.account.collection.fetch(collectionPda);
      console.log("✅ Collection already initialized!");
      console.log("📊 Existing Collection Info:");
      console.log("  Name:", existingCollection.name);
      console.log("  Symbol:", existingCollection.symbol);
      console.log("  Base URI:", existingCollection.baseUri);
      console.log("  Total Supply:", existingCollection.totalSupply.toString());
      console.log("  Authority:", existingCollection.authority.toBase58());
      console.log("  Wormhole Program:", existingCollection.wormholeProgramId.toBase58());
      console.log("  Bump:", existingCollection.bump);
      
      return collectionPda;
    } catch (err) {
      console.log("Collection not initialized yet, proceeding with initialization...");
    }

    // Check wallet balance
    const balance = await provider.connection.getBalance(wallet.publicKey);
    console.log("Wallet balance:", balance / anchor.web3.LAMPORTS_PER_SOL, "SOL");

    if (balance < 0.05 * anchor.web3.LAMPORTS_PER_SOL) {
      console.log("⚠️ Low balance, you may need more SOL for transaction fees");
    }

    // Initialize the collection
    console.log("\n🔧 Initializing NFT collection...");
    
    // Wormhole program ID - using placeholder since it's required by your initialize function
    const wormholeProgram = new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");
    
    const tx = await nftProgram.methods
      .initialize(
        "Vault Access NFTs",                    // name
        "VAN",                                  // symbol
        "https://vault-nfts.com/metadata/",     // base_uri
        wormholeProgram                         // wormhole_program_id
      )
      .accounts({
        authority: wallet.publicKey,
      })
      .rpc();

    console.log("✅ NFT Collection initialized successfully!");
    console.log("📝 Transaction signature:", tx);

    // Verify initialization by fetching the account
    console.log("\n✅ Verifying collection initialization...");
    const collection = await nftProgram.account.collection.fetch(collectionPda);
    
    console.log("📊 Collection Verification:");
    console.log("  Name:", collection.name);
    console.log("  Symbol:", collection.symbol);
    console.log("  Base URI:", collection.baseUri);
    console.log("  Total Supply:", collection.totalSupply.toString());
    console.log("  Authority:", collection.authority.toBase58());
    console.log("  Authority matches wallet:", collection.authority.equals(wallet.publicKey) ? "✅ YES" : "❌ NO");
    console.log("  Wormhole Program:", collection.wormholeProgramId.toBase58());
    console.log("  Bump:", collection.bump);
    console.log("  Collection mappings initialized:", {
      uniqueIdToTokenId: collection.uniqueIdToTokenId.length,
      tokenIdToUniqueId: collection.tokenIdToUniqueId.length,
      mintToUniqueId: collection.mintToUniqueId.length,
      crossChainUniqueIds: collection.crossChainUniqueIds.length
    });

    // Explorer links
    const network = provider.connection.rpcEndpoint.includes('testnet') ? 'testnet' : 
                   provider.connection.rpcEndpoint.includes('devnet') ? 'devnet' : 'localnet';
    
    if (network !== 'localnet') {
      console.log("\n🔗 Explorer Links:");
      console.log("Collection Account:", `https://explorer.solana.com/address/${collectionPda.toBase58()}?cluster=${network}`);
      console.log("Transaction:", `https://explorer.solana.com/tx/${tx}?cluster=${network}`);
      console.log("NFT Program:", `https://explorer.solana.com/address/${nftProgram.programId.toBase58()}?cluster=${network}`);
    }

    console.log("\n🎉 SUCCESS! NFT Collection is ready for vault initialization!");
    console.log("💡 Collection PDA for vault init:", collectionPda.toBase58());

    return collectionPda;

  } catch (error) {
    console.error("\n❌ Error initializing NFT collection:");
    
    if (error instanceof anchor.AnchorError) {
      console.error("  Anchor Error:", error.error.errorMessage);
      console.error("  Error Code:", error.error.errorCode.code);
      console.error("  Error Number:", error.error.errorCode.number);
    } else if (error instanceof Error) {
      console.error("  Error:", error.message);
    } else {
      console.error("  Error:", error);
    }
    
    if ('logs' in (error as any)) {
      console.error("Program logs:", (error as any).logs);
    }
    
    console.log("\n🔧 Troubleshooting:");
    console.log("  1. Make sure you have enough SOL for transaction fees");
    console.log("  2. Verify the unique_low program is deployed correctly");
    console.log("  3. Check if your wallet is the correct authority");
    console.log("  4. Ensure program ID matches your deployed unique_low program");
    
    process.exit(1);
  }
}

// Alternative function to just check collection status
async function checkCollectionStatus() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const nftProgram = anchor.workspace.UniqueLow as anchor.Program<UniqueLow>;
  
  const [collectionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_v1")],
    nftProgram.programId
  );
  
  try {
    const collection = await nftProgram.account.collection.fetch(collectionPda);
    console.log("Collection Status: ✅ INITIALIZED");
    console.log("Collection PDA:", collectionPda.toBase58());
    return true;
  } catch (err) {
    console.log("Collection Status: ❌ NOT INITIALIZED");
    console.log("Collection PDA would be:", collectionPda.toBase58());
    return false;
  }
}

// Main execution
if (require.main === module) {
  // Check if user wants to just check status
  const args = process.argv.slice(2);
  
  if (args.includes('--check') || args.includes('-c')) {
    checkCollectionStatus()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    main()
      .then((collectionPda) => {
        console.log(`\n✅ Collection initialization completed!`);
        console.log(`🎯 Collection PDA: ${collectionPda.toBase58()}`);
        console.log(`\n💡 Next steps:`);
        console.log(`   1. Update initVault.ts with your asset mint: DjgG2FYvDLnpu7Br5wcHCuYapjXdZAi29qEBxghBgw6P`);
        console.log(`   2. Update initVault.ts collection PDA: ${collectionPda.toBase58()}`);
        console.log(`   3. Run vault initialization`);
        process.exit(0);
      })
      .catch((error) => {
        console.error("❌ Collection initialization failed:", error);
        process.exit(1);
      });
  }
}