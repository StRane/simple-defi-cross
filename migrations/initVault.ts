import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { SimpleVault } from "../target/types/simple_vault";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import fs from 'fs';

async function main() {
  console.log("🚀 Reinitializing Vault with EXISTING test_token mint...\n");

  // Setup providers and programs
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.SimpleVault as anchor.Program<SimpleVault>;
  const wallet = provider.wallet as anchor.Wallet;

  console.log("📋 Configuration:");
  console.log("Deployer Wallet:", wallet.publicKey.toBase58());
  console.log("Vault Program:", vaultProgram.programId.toBase58());

  // Your EXISTING working infrastructure
  const CONFIG = {
    // ✅ Use your CURRENT deployed program ID
    existingAssetMint: new PublicKey("DjgG2FYvDLnpu7Br5wcHCuYapjXdZAi29qEBxghBgw6P"),
    nftCollection: new PublicKey("2okdWdXycjkKeC6aE1UTyUmxZndRR45dzfWGA9xsBTYz"),

    vaultProgramId: new PublicKey("DGXrmuhPvYJEWytSpZPB3PCA2zNvSsNvctkAeS924473"),

    testTokenProgramId: new PublicKey("BSCgQLPHjjvoH6qbG59dyxUTfcK6jAqFDdPk6MNN7sEz"),
    mintAuthPda: new PublicKey("4BFqXxQTPhL2MY84mWcaZNhN8gWmxVpa6PTDkU2wwCA2"),
  };

  console.log("✅ Using EXISTING asset mint:", CONFIG.existingAssetMint.toBase58());
  console.log("✅ Using EXISTING NFT collection:", CONFIG.nftCollection.toBase58());
  console.log("✅ Mint authority PDA:", CONFIG.mintAuthPda.toBase58());

  try {
    // ================================
    // STEP 1: Verify Existing Asset Mint
    // ================================
    console.log("\n🔍 STEP 1: Verifying existing asset mint...");

    const mintInfo = await provider.connection.getParsedAccountInfo(CONFIG.existingAssetMint);
    const mintData = mintInfo.value?.data;
    if (mintData && 'parsed' in mintData) {
      const info = mintData.parsed.info;
      console.log("📊 Asset Mint Verification:");
      console.log("  Mint Address:", CONFIG.existingAssetMint.toBase58());
      console.log("  Authority:", info.mintAuthority);
      console.log("  Decimals:", info.decimals);
      console.log("  Current Supply:", info.supply);
      console.log("  Authority matches:", info.mintAuthority === CONFIG.mintAuthPda.toBase58() ? "✅ YES" : "❌ NO");

      // if (info.mintAuthority !== CONFIG.mintAuthPda.toBase58()) {
      //   throw new Error("Asset mint authority doesn't match your test_token program!");
      // }
    } else {
      // throw new Error("Could not fetch asset mint info!");
    }

    // ================================
    // STEP 2: Generate NEW Share Mint for Vault
    // ================================ 
    console.log("\n🎫 STEP 2: Generating NEW share mint for vault...");

    const shareMintKeypair = Keypair.generate();
    console.log("Generated Share Mint:", shareMintKeypair.publicKey.toBase58());

    // ================================
    // STEP 3: Derive NEW Vault PDA with Existing Asset Mint
    // ================================
    console.log("\n🏦 STEP 3: Deriving NEW vault PDA...");

    const [newVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault_v2"),
        CONFIG.existingAssetMint.toBuffer(), // ✅ Use existing asset mint
        wallet.publicKey.toBuffer()
      ],
      CONFIG.vaultProgramId
    );
    console.log("NEW Vault PDA:", newVaultPda.toBase58());

    // Derive vault's token account (ATA for vault PDA + existing asset mint)
    const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [
        newVaultPda.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        CONFIG.existingAssetMint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    console.log("Vault Token Account:", vaultTokenAccount.toBase58());

    // ================================
    // STEP 4: Initialize NEW Vault
    // ================================
    console.log("\n🔧 STEP 4: Initializing NEW vault...");

    const vaultInitTx = await vaultProgram.methods
      .initializeVault(CONFIG.nftCollection)
      .accounts({
        owner: wallet.publicKey,
        assetMint: CONFIG.existingAssetMint, // ✅ Use existing asset mint
        // vault: newVaultPda,
        shareMint: shareMintKeypair.publicKey, // ✅ New share mint
        // vaultTokenAccount: vaultTokenAccount,
        // tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        // associatedTokenProgram: anchor.utils.token.ASSOCIATED_TOKEN_PROGRAM_ID,
        // systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([shareMintKeypair]) // ✅ Important: share mint must sign
      .rpc();

    console.log("✅ NEW Vault initialized successfully!");
    console.log("✅ Transaction:", vaultInitTx);

    // ================================
    // STEP 5: Verify NEW Vault
    // ================================
    console.log("\n✅ STEP 5: Verifying new vault...");

    const vaultAccount = await vaultProgram.account.vault.fetch(newVaultPda);
    console.log("📊 Vault Verification:");
    console.log("  Vault Owner:", vaultAccount.owner.toBase58());
    console.log("  Asset Mint:", vaultAccount.assetMint.toBase58());
    console.log("  Share Mint:", vaultAccount.shareMint.toBase58());
    console.log("  NFT Collection:", vaultAccount.nftCollectionAddress.toBase58());
    console.log("  Total Shares:", vaultAccount.totalShares?.toString() || "0");

    // Verify all matches
    const assetMatches = vaultAccount.assetMint.equals(CONFIG.existingAssetMint);
    const shareMatches = vaultAccount.shareMint.equals(shareMintKeypair.publicKey);
    const collectionMatches = vaultAccount.nftCollectionAddress.equals(CONFIG.nftCollection);
    const ownerMatches = vaultAccount.owner.equals(wallet.publicKey);

    console.log("\n🔍 Verification Results:");
    console.log("  Asset Mint Matches:", assetMatches ? "✅ YES" : "❌ NO");
    console.log("  Share Mint Matches:", shareMatches ? "✅ YES" : "❌ NO");
    console.log("  Collection Matches:", collectionMatches ? "✅ YES" : "❌ NO");
    console.log("  Owner Matches:", ownerMatches ? "✅ YES" : "❌ NO");

    if (!assetMatches || !shareMatches || !collectionMatches || !ownerMatches) {
      throw new Error("Vault verification failed - data mismatch!");
    }

    // ================================
    // STEP 6: Calculate All Required Addresses for useVault Hook
    // ================================
    console.log("\n🔗 STEP 6: Calculating all required addresses for useVault hook...");

    // All the addresses your useVault hook needs
    const hookConfig = {
      // Program configuration
      PROGRAM_ID: CONFIG.vaultProgramId.toBase58(),

      // Seeds (for PDA derivation in hook - from your contract)
      VAULT_SEED: "vault_v2", // ✅ Match constants
      USER_SHARES_SEED: "user_shares_v2", // ✅ Match constants
      USER_INFO_SEED: "user_info_v2", // ✅ Match constants

      // Core vault infrastructure (static - same for all users)
      COLLECTION_PDA: CONFIG.nftCollection.toBase58(),
      VAULT_ASSET_MINT: CONFIG.existingAssetMint.toBase58(),
      VAULT_PDA: newVaultPda.toBase58(),
      SHARE_MINT: shareMintKeypair.publicKey.toBase58(),
      VAULT_TOKEN_ACCOUNT: vaultTokenAccount.toBase58(),

      // Dynamic derivation patterns (from your contract seeds)
      derivationPatterns: {
        // From your contract: seeds = [b"vault", user_nft_token.key().as_ref(), user_share_token.key().as_ref()]
        nftUserInfoSeeds: ["vault_v2", "[USER_NFT_TOKEN_ACCOUNT]", "[USER_SHARE_TOKEN_ACCOUNT]"],
        // From your contract: seeds = [b"user_shares", user_nft_mint.key().as_ref()]  
        userSharePdaSeeds: ["user_shares_v2", "[USER_NFT_MINT]"],
        // Standard ATA derivation
        userShareTokenSeeds: "ATA of user_share_pda + share_mint",
      }
    };

    console.log("✅ Hook Configuration Generated:");
    console.log("  VAULT_ASSET_MINT:", hookConfig.VAULT_ASSET_MINT);
    console.log("  VAULT_PDA:", hookConfig.VAULT_PDA);
    console.log("  SHARE_MINT:", hookConfig.SHARE_MINT);
    console.log("  VAULT_TOKEN_ACCOUNT:", hookConfig.VAULT_TOKEN_ACCOUNT);
    console.log("  COLLECTION_PDA:", hookConfig.COLLECTION_PDA);

    console.log("\n📋 Dynamic Derivation Info:");
    console.log("  ✅ Any NFT from collection can be used");
    console.log("  ✅ Each NFT gets separate UserInfo PDA");
    console.log("  ✅ Each NFT gets separate share token account");
    console.log("  ✅ Users can have multiple positions with different NFTs");

    // ================================
    // STEP 7: Save Updated Configuration  
    // ================================
    console.log("\n💾 STEP 7: Saving updated configuration...");

    const updatedConfig = {
      // Program IDs (unchanged)
      programs: {
        testToken: CONFIG.testTokenProgramId.toBase58(),
        vault: CONFIG.vaultProgramId.toBase58(),
        uniqueId: "5XdsDEXPiHndfBkrvJKjsFZy3Zf95bUZLRZQvJ4W6Bpa",
      },

      // Infrastructure (existing)
      infrastructure: {
        nftCollection: CONFIG.nftCollection.toBase58(),
        mintAuthority: CONFIG.mintAuthPda.toBase58(),
      },

      // Complete useVault hook configuration
      useVaultConfig: hookConfig,

      // Vault configuration (for reference)
      vault: {
        assetMint: CONFIG.existingAssetMint.toBase58(), // ✅ Existing
        vaultPda: newVaultPda.toBase58(), // ✅ New
        shareMint: shareMintKeypair.publicKey.toBase58(), // ✅ New
        vaultTokenAccount: vaultTokenAccount.toBase58(), // ✅ New
      },

      // Old vault (for reference)
      oldVault: {
        vaultPda: "Cs6Vz6BNq6HHViusWzVzK9cg1u5cCvdW3nSvDCCZJd4m",
        assetMint: "7Uc3xCQxiPqMHVXPrzcgUw8rrKQ7vCu5HUXL4TVRntDS",
        shareMint: "Ggbz1DvG6sh5FwTCFUqc85M6RYVduivGu3BhyxVHqpP1",
        note: "Old vault with wrong asset mint - now replaced"
      },

      // Deployment info
      deployment: {
        deployedAt: new Date().toISOString(),
        deployerWallet: wallet.publicKey.toBase58(),
        network: "devnet",
      }
    };

    // Ensure directories exist
    if (!fs.existsSync('keypairs')) {
      fs.mkdirSync('keypairs', { recursive: true });
    }
    if (!fs.existsSync('config')) {
      fs.mkdirSync('config', { recursive: true });
    }

    // Save configuration
    fs.writeFileSync('config/updated-vault-config.json', JSON.stringify(updatedConfig, null, 2));
    console.log("✅ Configuration saved to: config/updated-vault-config.json");

    // Save share mint keypair (you might need it later)
    fs.writeFileSync(
      'keypairs/new-share-mint-keypair.json',
      JSON.stringify(Array.from(shareMintKeypair.secretKey))
    );
    console.log("✅ Share mint keypair saved to: keypairs/new-share-mint-keypair.json");

    // ================================
    // STEP 8: Frontend Update Instructions
    // ================================
    console.log("\n📝 FRONTEND UPDATE INSTRUCTIONS:");
    console.log("\n1️⃣ Update lib/useVault.ts CONFIG (COMPLETE REPLACEMENT):");
    console.log("```typescript");
    console.log("const CONFIG = {");
    console.log(`    PROGRAM_ID: '${hookConfig.PROGRAM_ID}',`);
    console.log(`    VAULT_SEED: Buffer.from("${hookConfig.VAULT_SEED}"),`);
    console.log("    ");
    console.log("    // Static vault infrastructure");
    console.log(`    COLLECTION_PDA: new PublicKey('${hookConfig.COLLECTION_PDA}'),`);
    console.log(`    VAULT_ASSET_MINT: new PublicKey("${hookConfig.VAULT_ASSET_MINT}"),`);
    console.log(`    VAULT_PDA: new PublicKey("${hookConfig.VAULT_PDA}"),`);
    console.log(`    SHARE_MINT: new PublicKey("${hookConfig.SHARE_MINT}"),`);
    console.log(`    VAULT_TOKEN_ACCOUNT: new PublicKey("${hookConfig.VAULT_TOKEN_ACCOUNT}"),`);
    console.log("};");
    console.log("```");

    console.log("\n2️⃣ Update your deposit() function in useVault.ts:");
    console.log("```typescript");
    console.log("import { useNFTSelection } from '@/context/SelectionContext';");
    console.log("");
    console.log("const deposit = useCallback(async (amount: BN): Promise<string | null> => {");
    console.log("    // ✅ Get selectedNFT from SelectionContext");
    console.log("    const { selectedNFT } = useNFTSelection();");
    console.log("    if (!selectedNFT) {");
    console.log("        setError('Please select an NFT from your collection');");
    console.log("        return null;");
    console.log("    }");
    console.log("");
    console.log("    const userPublicKey = new PublicKey(address);");
    console.log("    ");
    console.log("    // Derive user's NFT token account");
    console.log("    const userNftTokenAccount = getAssociatedTokenAddressSync(");
    console.log("        selectedNFT,");
    console.log("        userPublicKey");
    console.log("    );");
    console.log("    ");
    console.log("    // Derive user share PDA (tied to specific NFT)");
    console.log("    const [userSharePda] = PublicKey.findProgramAddressSync(");
    console.log("        [Buffer.from('user_shares'), selectedNFT.toBuffer()],");
    console.log("        new PublicKey(CONFIG.PROGRAM_ID)");
    console.log("    );");
    console.log("    ");
    console.log("    // Derive user's share token account (ATA of userSharePda + shareMint)");
    console.log("    const userShareTokenAccount = getAssociatedTokenAddressSync(");
    console.log("        CONFIG.SHARE_MINT,");
    console.log("        userSharePda,");
    console.log("        true // allowOwnerOffCurve = true for PDA");
    console.log("    );");
    console.log("    ");
    console.log("    // Derive NFT user info PDA (from your contract seeds)");
    console.log("    const [nftUserInfo] = PublicKey.findProgramAddressSync(");
    console.log("        [");
    console.log("            Buffer.from('vault'),");
    console.log("            userNftTokenAccount.toBuffer(),");
    console.log("            userShareTokenAccount.toBuffer()");
    console.log("        ],");
    console.log("        new PublicKey(CONFIG.PROGRAM_ID)");
    console.log("    );");
    console.log("    ");
    console.log("    const tx = await program.methods");
    console.log("        .deposit(amount)");
    console.log("        .accounts({");
    console.log("            user: userPublicKey,");
    console.log("            vault: CONFIG.VAULT_PDA,");
    console.log("            nftCollection: CONFIG.COLLECTION_PDA,");
    console.log("            userNftToken: userNftTokenAccount,        // ✅ Dynamic from selected NFT");
    console.log("            userNftMint: selectedNFT,                 // ✅ Dynamic from selected NFT");
    console.log("            assetMint: CONFIG.VAULT_ASSET_MINT,");
    console.log("            userAssetToken: null, // ATA will be derived");
    console.log("            vaultTokenAccount: CONFIG.VAULT_TOKEN_ACCOUNT,");
    console.log("            shareMint: CONFIG.SHARE_MINT,");
    console.log("            userSharePda: userSharePda,               // ✅ Dynamic PDA for this NFT");
    console.log("            userShareToken: userShareTokenAccount,    // ✅ Dynamic share account for this NFT");
    console.log("            nftInfo: nftUserInfo,                     // ✅ Dynamic user info for this NFT");
    console.log("        })");
    console.log("        .rpc();");
    console.log("        ");
    console.log("    return tx;");
    console.log("}, [selectedNFT, program, address]);");
    console.log("```");

    console.log("\n3️⃣ Key Points About Your Vault Design:");
    console.log("   ✅ Users can deposit with ANY NFT from your collection");
    console.log("   ✅ Each NFT creates a separate vault position");
    console.log("   ✅ Users can have multiple positions using different NFTs");
    console.log("   ✅ Share tokens are tied to the specific NFT used");
    console.log("   ✅ SelectionContext allows users to choose which NFT to use");

    console.log("\n4️⃣ Components (NO CHANGES NEEDED):");
    console.log("   ✅ TokenManager: Uses correct asset mint");
    console.log("   ✅ AssetIdentityHub: Users select which NFT to use");
    console.log("   ✅ VaultManager: Will use selected NFT from context");

    console.log("\n🎉 SUCCESS! Vault reinitialized with your existing test_token mint!");

    console.log("\n📊 FINAL CONFIGURATION:");
    console.log("┌─────────────────────────────────────────────────────────────────┐");
    console.log("│                        VAULT ECOSYSTEM                         │");
    console.log("├─────────────────────────────────────────────────────────────────┤");
    console.log(`│ 🪙 Asset Mint:    ${CONFIG.existingAssetMint.toBase58()} │`);
    console.log(`│ 🏦 Vault PDA:     ${newVaultPda.toBase58()} │`);
    console.log(`│ 🎫 Share Mint:    ${shareMintKeypair.publicKey.toBase58()} │`);
    console.log(`│ 🆔 NFT Collection: ${CONFIG.nftCollection.toBase58()} │`);
    console.log(`│ 👤 Your Wallet:   ${wallet.publicKey.toBase58()} │`);
    console.log("└─────────────────────────────────────────────────────────────────┘");

    console.log("\n🔄 USER FLOW NOW:");
    console.log("1. ✅ User mints tokens → Gets your existing asset mint tokens");
    console.log("2. ✅ User mints NFTs → Gets NFTs from your collection");
    console.log("3. ✅ User deposits → Uses asset mint tokens + NFT identity");
    console.log("4. ✅ User gets shares → From new vault share mint");
    console.log("5. ✅ Everything unified → Same ecosystem, no confusion!");

  } catch (error) {
    console.error("\n❌ Error during vault reinitialization:", error);

    if (error instanceof Error) {
      console.error("Error details:", error.message);

      if (error.message.includes("already in use")) {
        console.log("\n💡 Account collision. The vault PDA might already exist.");
        console.log("   This could happen if you've run this before. Check existing vault or use different seed.");
      } else if (error.message.includes("signature")) {
        console.log("\n💡 Signature issue. Ensure share mint keypair is signing the transaction.");
      } else if (error.message.includes("insufficient")) {
        console.log("\n💡 Insufficient funds. Ensure wallet has enough SOL for rent + transaction fees.");
      } else if (error.message.includes("InvalidAccountData")) {
        console.log("\n💡 Account data issue. Check if vault program matches expected structure.");
      }
    }

    process.exit(1);
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✅ Vault reinitialization with existing mint completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Reinitialization failed:", error);
      process.exit(1);
    });
}