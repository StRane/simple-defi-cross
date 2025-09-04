import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SimpleVault } from "../target/types/simple_vault";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccount,
  transfer
} from "@solana/spl-token";
import { assert, expect } from "chai";

describe("simple_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;

  // Test wallets
  let authority: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let poolSigner: Keypair;
  let shareMint: Keypair;

  // Mints
  let depositTokenMint: PublicKey;

  // PDAs
  let vaultPda: PublicKey;
  let vaultBump: number;
  let vaultTokenAccount: PublicKey;

  // Token accounts
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;
  let authorityTokenAccount: PublicKey;

  // Constants for testing
  const RESERVE_FACTOR = new BN(1000);
  const DEPOSIT_AMOUNT = new BN(1000 * 10 ** 9);
  const BORROW_AMOUNT = new BN(100 * 10 ** 9);

  before(async () => {
    // Initialize test wallets
    authority = provider.wallet.payer;
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    poolSigner = Keypair.generate();

    // Airdrop SOL to test users
    await provider.connection.requestAirdrop(
      user1.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      user2.publicKey,
      2 * LAMPORTS_PER_SOL
    );

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create deposit token mint (e.g., USDC)
    depositTokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      9 // USDC decimals
    );

    // Create token accounts
    user1TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority,
      depositTokenMint,
      user1.publicKey
    );

    user2TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority,
      depositTokenMint,
      user2.publicKey
    );

    authorityTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority,
      depositTokenMint,
      authority.publicKey
    );

    // Mint deposit tokens to users
    await mintTo(
      provider.connection,
      authority,
      depositTokenMint,
      user1TokenAccount,
      authority,
      10000 * 10 ** 9
    );

    await mintTo(
      provider.connection,
      authority,
      depositTokenMint,
      user2TokenAccount,
      authority,
      10000 * 10 ** 9
    );

    // Derive vault PDA
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        depositTokenMint.toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );

    vaultTokenAccount = await getAssociatedTokenAddress(
      depositTokenMint,
      vaultPda,
      true // allowOwnerOffCurve because vault PDA
    );

    shareMint = Keypair.generate();
  });

  describe("Initialize Vault", () => {
    it("Successfully initializes the vault", async () => {
      const tx = await program.methods
        .initializeVault()
        .accounts({
          shareMint: shareMint.publicKey,
          assetMint: depositTokenMint,
        })
        .signers([shareMint])
        .rpc();

      console.log("Initialize vault tx:", tx);
    });
  });

  describe("Deposit with simple vault", () => {
    it("Successfully deposits tokens", async () => {
      console.log("Starting deposit test");

      // Check user balance before deposit
      const balanceBefore = await provider.connection.getTokenAccountBalance(user1TokenAccount);
      console.log("Balance before:", balanceBefore);

      // Get user share token account address
      const user1ShareTokenAccount = await getAssociatedTokenAddress(
        shareMint.publicKey,
        user1.publicKey
      );

      // Send deposit instruction
      const tx2 = await program.methods
        .deposit(new anchor.BN(DEPOSIT_AMOUNT))
        .accounts({
          user: user1.publicKey,
          shareMint: shareMint.publicKey,
          assetMint: depositTokenMint,
          vault: vaultPda,
          vaultTokenAccount: vaultTokenAccount,
      
        })
        .signers([user1])
        .rpc();

      console.log("Deposit tx:", tx2);

      // Fetch vault state and check shares minted
      const vaultState = await program.account.vault.fetch(vaultPda);
      console.log("Vault state:", vaultState);

      // Check user balance after deposit
      const balanceAfter = await provider.connection.getTokenAccountBalance(user1TokenAccount);
      const transferred = balanceBefore.value.uiAmount - balanceAfter.value.uiAmount;
      console.log("Transferred amount:", transferred);
    });
  });
});