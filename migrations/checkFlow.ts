// migrations/complete_flow_test.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  getAccount
} from "@solana/spl-token";
import { SimpleVault } from "../target/types/simple_vault";
import { UniqueLow } from "../target/types/unique_low";

// Program configs
const VAULT_CONFIG = {
  PROGRAM_ID: "6szSVnHy2GrCi6y7aQxJfQG9WpVkTgdB6kDXixepvdoW",
  VAULT_SEED: "vault_v3",
  USER_INFO_SEED: "user_info_v3", 
  USER_SHARES_SEED: "user_shares_v3",
};

const NFT_CONFIG = {
  PROGRAM_ID: "5XdsDEXPiHndfBkrvJKjsFZy3Zf95bUZLRZQvJ4W6Bpa",
  COLLECTION_SEED: "collection",
  USER_STATE_SEED: "user_state",
  COLLECTION_PDA: new PublicKey("EoZ5NFigrZ7uqUUSH6ShDsYGMooe5ziTfgWvAbFmVTXt"),
};

async function main() {
  console.log("🚀 Starting Complete Vault Flow Test\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const vaultProgram = new anchor.Program<SimpleVault>(
    require("../target/idl/simple_vault.json"),
    provider
  );

  const nftProgram = new anchor.Program<UniqueLow>(
    require("../target/idl/unique_low.json"), 
    provider
  );

  const wallet = provider.wallet;
  console.log("👤 Wallet:", wallet.publicKey.toBase58());

  // =================================
  // STEP 1: Setup Asset Mint (Test Token)
  // =================================
  console.log("🪙 STEP 1: Creating test asset mint...");
  
  const assetMintKeypair = Keypair.generate();
  const assetMint = await createMint(
    provider.connection,
    wallet.payer,
    wallet.publicKey,
    null,
    6, // 6 decimals
    assetMintKeypair,
    undefined,
    TOKEN_PROGRAM_ID
  );

  console.log("✅ Asset mint created:", assetMint.toBase58());

  // Create user's asset token account and mint some tokens
  const userAssetToken = await createAssociatedTokenAccount(
    provider.connection,
    wallet.payer,
    assetMint,
    wallet.publicKey
  );

  await mintTo(
    provider.connection,
    wallet.payer,
    assetMint,
    userAssetToken,
    wallet.publicKey,
    20000 * 1e6 // 20,000 tokens
  );

  const assetBalance = await getAccount(provider.connection, userAssetToken);
  console.log("✅ Minted tokens to user:", Number(assetBalance.amount) / 1e6);

  // =================================
  // STEP 2: Initialize NFT Collection
  // =================================
  console.log("\n🎨 STEP 2: Initializing NFT collection...");

  const [collectionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(NFT_CONFIG.COLLECTION_SEED)],
    new PublicKey(NFT_CONFIG.PROGRAM_ID)
  );

  let isCollectionInitialized = false;
  try {
    await nftProgram.account.collection.fetch(collectionPda);
    isCollectionInitialized = true;
    console.log("✅ Collection already initialized:", collectionPda.toBase58());
  } catch (err) {
    console.log("⏳ Initializing new collection...");
    
    const tx = await nftProgram.methods
      .initialize(
        "Test Vault NFTs",
        "TVNFT", 
        "https://api.example.com/nft/"
      )
      .accounts({
        collection: collectionPda,
        authority: wallet.publicKey,
      })
      .rpc();
    
    console.log("✅ Collection initialized:", tx);
    isCollectionInitialized = true;
  }

  // =================================
  // STEP 3: Initialize Vault
  // =================================
  console.log("\n🏦 STEP 3: Initializing vault...");

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(VAULT_CONFIG.VAULT_SEED),
      assetMint.toBuffer(),
      wallet.publicKey.toBuffer()
    ],
    new PublicKey(VAULT_CONFIG.PROGRAM_ID)
  );

  const shareMintKeypair = Keypair.generate();
  
  let vaultExists = false;
  try {
    await vaultProgram.account.vault.fetch(vaultPda);
    vaultExists = true;
    console.log("⚠️ Vault already exists:", vaultPda.toBase58());
  } catch (err) {
    console.log("⏳ Creating new vault...");
    
    const vaultTokenAccount = await getAssociatedTokenAddress(
      assetMint,
      vaultPda,
      true // allowOwnerOffCurve
    );

    const tx = await vaultProgram.methods
      .initializeVault(collectionPda)
      .accounts({
        owner: wallet.publicKey,
        assetMint: assetMint,

        shareMint: shareMintKeypair.publicKey,



      })
      .signers([shareMintKeypair])
      .rpc();
    
    console.log("✅ Vault initialized:", tx);
    vaultExists = true;
  }

  // =================================
  // STEP 4: Mint NFT for Testing
  // =================================
  console.log("\n🖼️ STEP 4: Minting test NFT...");

  const [userStatePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(NFT_CONFIG.USER_STATE_SEED),
      wallet.publicKey.toBuffer()
    ],
    new PublicKey(NFT_CONFIG.PROGRAM_ID)
  );

  const nftMintKeypair = Keypair.generate();
  const nftTokenAccount = await getAssociatedTokenAddress(
    nftMintKeypair.publicKey,
    wallet.publicKey
  );

  console.log("⏳ Minting NFT...");
  const mintTx = await nftProgram.methods
    .mintNft()
    .accounts({
      mint: nftMintKeypair.publicKey,
      user: wallet.publicKey,
    })
    .signers([nftMintKeypair])
    .rpc();

  console.log("✅ NFT minted:", {
    mint: nftMintKeypair.publicKey.toBase58(),
    tokenAccount: nftTokenAccount.toBase58(),
    tx: mintTx
  });

  // =================================
  // STEP 5: Get Vault Info & Calculate PDAs
  // =================================
  console.log("\n📊 STEP 5: Analyzing vault state...");

  const vaultData = await vaultProgram.account.vault.fetch(vaultPda);
  const vaultTokenAccount = await getAssociatedTokenAddress(
    assetMint,
    vaultPda,
    true
  );

  console.log("📊 Vault State Before Deposit:", {
    owner: vaultData.owner.toBase58(),
    assetMint: vaultData.assetMint.toBase58(),
    shareMint: vaultData.shareMint.toBase58(),
    totalShares: vaultData.totalShares.toString(),
    totalReserves: vaultData.totalReserves.toString(),
    totalBorrowed: vaultData.totalBorrowed.toString(),
  });

  // Calculate all PDAs for deposit
  const [userSharePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(VAULT_CONFIG.USER_SHARES_SEED),
      nftMintKeypair.publicKey.toBuffer()
    ],
    new PublicKey(VAULT_CONFIG.PROGRAM_ID)
  );

  const userShareToken = await getAssociatedTokenAddress(
    vaultData.shareMint,
    userSharePda,
    true
  );

  const [nftInfo] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(VAULT_CONFIG.USER_INFO_SEED),
      nftTokenAccount.toBuffer(),
      userShareToken.toBuffer()
    ],
    new PublicKey(VAULT_CONFIG.PROGRAM_ID)
  );

  console.log("🔐 Derived PDAs:", {
    vaultPda: vaultPda.toBase58(),
    userSharePda: userSharePda.toBase58(), 
    userShareToken: userShareToken.toBase58(),
    nftInfo: nftInfo.toBase58(),
  });

  // =================================
  // STEP 6: Deposit Test
  // =================================
  console.log("\n💰 STEP 6: Testing deposit...");

  const depositAmount = 1000 * 1e6; // 1000 tokens

  console.log("⏳ Executing deposit transaction...");
  try {
    const depositTx = await vaultProgram.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        user: wallet.publicKey,
        vault: vaultPda,
        nftCollection: collectionPda,
        userNftToken: nftTokenAccount,
        userNftMint: nftMintKeypair.publicKey,
        assetMint: assetMint,

        vaultTokenAccount: vaultTokenAccount,
        shareMint: vaultData.shareMint,


      })
      .rpc();

    console.log("✅ Deposit successful:", depositTx);

    // Check post-deposit state
    const vaultDataAfter = await vaultProgram.account.vault.fetch(vaultPda);
    const userInfoData = await vaultProgram.account.userInfo.fetch(nftInfo);
    
    console.log("📊 Vault State After Deposit:", {
      totalShares: vaultDataAfter.totalShares.toString(),
      totalReserves: vaultDataAfter.totalReserves.toString(),
    });

    console.log("👤 User Position:", {
      shares: userInfoData.shares.toString(),
      nftMint: userInfoData.nftMint.toBase58(),
      owner: userInfoData.owner.toBase58(),
    });

    // =================================
    // STEP 7: Withdrawal Test  
    // =================================
    console.log("\n💸 STEP 7: Testing withdrawal...");

    const sharesToWithdraw = Math.floor(Number(userInfoData.shares) / 2); // Withdraw half
    console.log("⏳ Withdrawing", sharesToWithdraw, "shares...");

    try {
      const withdrawTx = await vaultProgram.methods
        .withdraw(new anchor.BN(sharesToWithdraw))
        .accounts({
          user: wallet.publicKey,
          vault: vaultPda,
          nftCollection: collectionPda,
          userNftToken: nftTokenAccount,
          userNftMint: nftMintKeypair.publicKey,
          assetMint: assetMint,

          vaultTokenAccount: vaultTokenAccount,
          shareMint: vaultData.shareMint,


        })
        .rpc();

      console.log("✅ Withdrawal successful:", withdrawTx);

      // Final state check
      const finalVaultData = await vaultProgram.account.vault.fetch(vaultPda);
      const finalUserData = await vaultProgram.account.userInfo.fetch(nftInfo);

      console.log("📊 Final Vault State:", {
        totalShares: finalVaultData.totalShares.toString(),
        totalReserves: finalVaultData.totalReserves.toString(),
      });

      console.log("👤 Final User Position:", {
        shares: finalUserData.shares.toString(),
      });

      console.log("\n🎉 ALL TESTS PASSED! The vault flow works correctly.");

    } catch (withdrawErr) {
      console.log("❌ Withdrawal failed:", withdrawErr);
      
      // Debug vault liquidity
      try {
        const vaultBalance = await getAccount(provider.connection, vaultTokenAccount);
        console.log("🔍 Vault Debug Info:", {
          vaultBalance: Number(vaultBalance.amount) / 1e6,
          totalReserves: Number(vaultDataAfter.totalReserves) / 1e6,
          availableLiquidity: (Number(vaultBalance.amount) - Number(vaultDataAfter.totalReserves)) / 1e6,
          sharesToWithdraw,
          totalShares: vaultDataAfter.totalShares.toString(),
        });
      } catch (debugErr) {
        console.log("❌ Could not debug vault state:", debugErr);
      }
    }

  } catch (depositErr) {
    console.log("❌ Deposit failed:", depositErr);
    
    // Try to debug the issue
    if (depositErr.toString().includes("ConstraintTokenOwner")) {
      console.log("💡 NFT ownership constraint failed - check if NFT mint authority is collection");
    } else if (depositErr.toString().includes("ConstraintTokenMint")) {
      console.log("💡 Token mint constraint failed - check NFT mint vs token account relationship");
    }
  }

  console.log("\n✅ Test completed!");
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("Migration finished!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}