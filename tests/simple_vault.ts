// tests/vault-debug-real-flow.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import { SimpleVault } from "../target/types/simple_vault";
import { UniqueLow } from "../target/types/unique_low";
import { expect } from "chai";

describe("vault-debug following working pattern", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const nftProgram = anchor.workspace.UniqueLow as Program<UniqueLow>;

  // Use your REAL deployed addresses
  const REAL_ADDRESSES = {
    COLLECTION_PDA: new PublicKey('EoZ5NFigrZ7uqUUSH6ShDsYGMooe5ziTfgWvAbFmVTXt'),
    VAULT_ASSET_MINT: new PublicKey("4kXBWAG92UZA1FPEQDN5bFYk"),
    VAULT_PDA: new PublicKey("DbCxNx4uvjK2wxvJbrd5DVJ6jVM8eJirYk8RbAL9Mvt1"),
    SHARE_MINT: new PublicKey("5CTdzZxPhqC4DWpTM5MFzwqCtHFmKQTsXE7VWUC6UxTG"),
    VAULT_TOKEN_ACCOUNT: new PublicKey("Ak7DxLGEauBkW769NSRvA9kVkc41SxJKK29mbeJu5gzE"),
  };

  const wallet = provider.wallet;
  let testUser = {
    mint: null as PublicKey | null,
    tokenAccount: null as PublicKey | null,
    assetTokenAccount: null as PublicKey | null,
    shareTokenAccount: null as PublicKey | null,
    sharePda: null as PublicKey | null,
    nftInfo: null as PublicKey | null
  };

  before("Setup test user", async () => {
    console.log("Setting up test user with real addresses...");
    console.log("Wallet:", wallet.publicKey.toBase58());
  });

  it("Check real vault state", async () => {
    console.log("Checking real vault state...");
    
    const vaultData = await vaultProgram.account.vault.fetch(REAL_ADDRESSES.VAULT_PDA);
    console.log("Real Vault Data:", {
      owner: vaultData.owner.toBase58(),
      assetMint: vaultData.assetMint.toBase58(),
      shareMint: vaultData.shareMint.toBase58(),
      totalShares: vaultData.totalShares.toString(),
      totalReserves: vaultData.totalReserves.toString(),
      totalBorrowed: vaultData.totalBorrowed.toString(),
    });

    const vaultBalance = await getAccount(provider.connection, REAL_ADDRESSES.VAULT_TOKEN_ACCOUNT);
    console.log("Vault Token Balance:", Number(vaultBalance.amount) / 1e6);

    const availableLiquidity = Number(vaultBalance.amount) - Number(vaultData.totalReserves);
    console.log("Available Liquidity:", availableLiquidity / 1e6);
  });

  it("Mint fresh NFT for testing", async () => {
    console.log("Minting fresh NFT using your working pattern...");
    
    const mint = Keypair.generate();
    const tokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      wallet.publicKey
    );

    const tx = await nftProgram.methods
      .mintNft()
      .accounts({
        mint: mint.publicKey,
        user: wallet.publicKey,
      })
      .signers([mint])
      .rpc();

    console.log("NFT minted:", {
      mint: mint.publicKey.toBase58(),
      tokenAccount: tokenAccount.toBase58(),
      tx: tx
    });

    testUser.mint = mint.publicKey;
    testUser.tokenAccount = tokenAccount;

    // Setup asset token account following your pattern
    testUser.assetTokenAccount = await getAssociatedTokenAddress(
      REAL_ADDRESSES.VAULT_ASSET_MINT,
      wallet.publicKey
    );

    // Create if needed
    try {
      await getAccount(provider.connection, testUser.assetTokenAccount);
      console.log("Asset token account exists");
    } catch {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        testUser.assetTokenAccount,
        wallet.publicKey,
        REAL_ADDRESSES.VAULT_ASSET_MINT
      );
      const createAtaTx = new anchor.web3.Transaction().add(createAtaIx);
      await anchor.web3.sendAndConfirmTransaction(provider.connection, createAtaTx, [wallet.payer]);
      console.log("Created asset token account");
    }

    // Setup PDAs using your EXACT v3 pattern
    [testUser.sharePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_shares_v3"), testUser.mint.toBuffer()],
      vaultProgram.programId
    );

    testUser.shareTokenAccount = await getAssociatedTokenAddress(
      REAL_ADDRESSES.SHARE_MINT,
      testUser.sharePda,
      true
    );

    [testUser.nftInfo] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_info_v3"),
        testUser.tokenAccount.toBuffer(),
        testUser.shareTokenAccount.toBuffer()
      ],
      vaultProgram.programId
    );

    console.log("PDAs derived:", {
      sharePda: testUser.sharePda.toBase58(),
      shareTokenAccount: testUser.shareTokenAccount.toBase58(),
      nftInfo: testUser.nftInfo.toBase58(),
    });
  });

  it("Test deposit using your working pattern", async () => {
    console.log("Testing deposit with your exact account structure...");
    
    const depositAmount = new anchor.BN(10 * 1e6); // 10 tokens

    // Check pre-deposit state
    const preVault = await vaultProgram.account.vault.fetch(REAL_ADDRESSES.VAULT_PDA);
    console.log("Pre-deposit total shares:", preVault.totalShares.toString());

    try {
      // Use your EXACT working pattern - only essential accounts
      const tx = await vaultProgram.methods
        .deposit(depositAmount)
        .accounts({
          user: wallet.publicKey,
          vault: REAL_ADDRESSES.VAULT_PDA,
          nftCollection: REAL_ADDRESSES.COLLECTION_PDA,
          userNftToken: testUser.tokenAccount,
          userNftMint: testUser.mint,
          assetMint: REAL_ADDRESSES.VAULT_ASSET_MINT,
          // userAssetToken: testUser.assetTokenAccount,     ← Let Anchor auto-derive
          vaultTokenAccount: REAL_ADDRESSES.VAULT_TOKEN_ACCOUNT,
          shareMint: REAL_ADDRESSES.SHARE_MINT,
          // userSharePda: testUser.sharePda,               ← Let Anchor auto-derive
          // userShareToken: testUser.shareTokenAccount,    ← Let Anchor auto-derive
          // nftInfo: testUser.nftInfo,                     ← Let Anchor auto-derive
          // tokenProgram: TOKEN_PROGRAM_ID,                ← Let Anchor auto-derive
          // systemProgram: SystemProgram.programId,        ← Let Anchor auto-derive
          // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, ← Let Anchor auto-derive
        })
        .rpc();

      console.log("Deposit successful:", tx);

      // Check post-deposit state
      const postVault = await vaultProgram.account.vault.fetch(REAL_ADDRESSES.VAULT_PDA);
      const userInfo = await vaultProgram.account.userInfo.fetch(testUser.nftInfo);

      console.log("Post-deposit state:", {
        totalShares: postVault.totalShares.toString(),
        userShares: userInfo.shares.toString(),
      });

    } catch (depositErr) {
      console.log("Deposit failed:", depositErr.toString());
      throw depositErr;
    }
  });

  it("Test withdrawal calculation before attempting", async () => {
    console.log("Testing withdrawal calculation...");
    
    const vaultData = await vaultProgram.account.vault.fetch(REAL_ADDRESSES.VAULT_PDA);
    const userInfo = await vaultProgram.account.userInfo.fetch(testUser.nftInfo);
    const vaultBalance = await getAccount(provider.connection, REAL_ADDRESSES.VAULT_TOKEN_ACCOUNT);

    const sharesToWithdraw = Math.min(50, Number(userInfo.shares));
    const totalAssets = Number(vaultBalance.amount);
    const totalShares = Number(vaultData.totalShares);
    const assetsToWithdraw = Math.floor((sharesToWithdraw * totalAssets) / totalShares);
    const availableLiquidity = Number(vaultBalance.amount) - Number(vaultData.totalReserves);

    console.log("Withdrawal calculation:", {
      userShares: userInfo.shares.toString(),
      sharesToWithdraw,
      vaultBalance: totalAssets / 1e6,
      totalShares: totalShares.toString(),
      assetsToWithdraw: assetsToWithdraw / 1e6,
      totalReserves: Number(vaultData.totalReserves) / 1e6,
      availableLiquidity: availableLiquidity / 1e6,
      liquidityCheck: availableLiquidity >= assetsToWithdraw ? "PASS" : "FAIL"
    });
  });

  it("Test withdrawal using your working pattern", async () => {
    console.log("Testing withdrawal with your exact account structure...");
    
    const userInfo = await vaultProgram.account.userInfo.fetch(testUser.nftInfo);
    const sharesToWithdraw = new anchor.BN(Math.min(50, Number(userInfo.shares)));

    console.log("Attempting to withdraw", sharesToWithdraw.toString(), "shares...");

    try {
      // Use your EXACT working pattern
      const tx = await vaultProgram.methods
        .withdraw(sharesToWithdraw)
        .accounts({
          user: wallet.publicKey,
          vault: REAL_ADDRESSES.VAULT_PDA,
          nftCollection: REAL_ADDRESSES.COLLECTION_PDA,
          userNftToken: testUser.tokenAccount,
          userNftMint: testUser.mint,
          assetMint: REAL_ADDRESSES.VAULT_ASSET_MINT,
          // userAssetToken: testUser.assetTokenAccount,     ← Let Anchor auto-derive
          vaultTokenAccount: REAL_ADDRESSES.VAULT_TOKEN_ACCOUNT,
          shareMint: REAL_ADDRESSES.SHARE_MINT,
          // userSharePda: testUser.sharePda,               ← Let Anchor auto-derive
          // userShareToken: testUser.shareTokenAccount,    ← Let Anchor auto-derive
          // nftInfo: testUser.nftInfo,                     ← Let Anchor auto-derive
        })
        .rpc();

      console.log("Withdrawal successful:", tx);

    } catch (withdrawErr) {
      console.log("Withdrawal failed:", withdrawErr.toString());
      
      // Parse specific errors
      if (withdrawErr.toString().includes("InsufficientLiquidity")) {
        console.log("❌ LIQUIDITY ERROR - Your vault contract liquidity check failed");
      } else if (withdrawErr.toString().includes("InsufficientShares")) {
        console.log("❌ SHARES ERROR - User doesn't have enough shares");
      } else if (withdrawErr.toString().includes("AccountNotInitialized")) {
        console.log("❌ ACCOUNT ERROR - One of the accounts doesn't exist");
      } else if (withdrawErr.toString().includes("ConstraintTokenOwner")) {
        console.log("❌ NFT OWNERSHIP ERROR - NFT ownership/authority check failed");
      }
      
      throw withdrawErr;
    }
  });
});