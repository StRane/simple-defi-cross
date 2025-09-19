import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TestToken } from "../target/types/test_token";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const testTokenProgram = anchor.workspace.TestToken as anchor.Program<TestToken>;
  const wallet = provider.wallet as anchor.Wallet;

  console.log("Initializing Test Token Program");
  console.log("Program ID:", testTokenProgram.programId.toBase58());
  console.log("Wallet:", wallet.publicKey.toBase58());

  // Derive mint authority PDA
  const [mintAuthPda, mintAuthBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth_v2")],
    testTokenProgram.programId
  );

  console.log("Mint Authority PDA:", mintAuthPda.toBase58());
  console.log("Mint Authority Bump:", mintAuthBump);

  // Check if already initialized
  try {
    const mintAuthAccount = await testTokenProgram.account.mintAuthorityPda.fetch(mintAuthPda);
    console.log("✅ Program already initialized!");
    console.log("Existing bump:", mintAuthAccount.bump);
    return;
  } catch (err) {
    console.log("Program not initialized yet, proceeding...");
  }

  // Check wallet balance
  const balance = await provider.connection.getBalance(wallet.publicKey);
  console.log("Wallet balance:", balance / anchor.web3.LAMPORTS_PER_SOL, "SOL");

  if (balance < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
    console.log("Low balance, requesting airdrop...");
    try {
      const airdropTx = await provider.connection.requestAirdrop(
        wallet.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropTx);
      console.log("✅ Airdrop successful");
    } catch (err) {
      console.log("⚠️ Airdrop failed, continuing with existing balance");
    }
  }

  // Generate first mint keypair
  const mintKeypair = Keypair.generate();
  console.log("Creating first mint:", mintKeypair.publicKey.toBase58());

  try {
    // Initialize the program
    const tx = await testTokenProgram.methods
      .initialize()
      .accounts({
        payer: wallet.publicKey,
        mint: mintKeypair.publicKey,
        // mintAuth: mintAuthPda,
        // systemProgram: SystemProgram.programId,
        // tokenProgram: TOKEN_PROGRAM_ID,
        // rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    console.log("✅ Program initialized successfully!");
    console.log("Transaction signature:", tx);

    // Verify initialization
    const mintAuthAccount = await testTokenProgram.account.mintAuthorityPda.fetch(mintAuthPda);
    console.log("Verified - Mint Authority bump:", mintAuthAccount.bump);
    console.log("First mint created:", mintKeypair.publicKey.toBase58());

    console.log("\nExplorer links (testnet):");
    console.log("Program:", `https://explorer.solana.com/address/${testTokenProgram.programId.toBase58()}?cluster=testnet`);
    console.log("Mint Authority PDA:", `https://explorer.solana.com/address/${mintAuthPda.toBase58()}?cluster=testnet`);
    console.log("First Mint:", `https://explorer.solana.com/address/${mintKeypair.publicKey.toBase58()}?cluster=testnet`);
    console.log("Transaction:", `https://explorer.solana.com/tx/${tx}?cluster=testnet`);

  } catch (error) {
    console.error("❌ Error initializing program:", error);
    
    if ('logs' in (error as any)) {
      console.error("Program logs:", (error as any).logs);
    }
    
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Initialization error:", err);
  process.exit(1);
});