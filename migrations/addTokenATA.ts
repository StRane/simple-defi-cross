import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { Transaction, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { SimpleVault } from "../target/types/simple_vault";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.SimpleVault as anchor.Program<SimpleVault>;
  const wallet = provider.wallet as anchor.Wallet;

  const CONFIG = {
    assetMint: new PublicKey("7Uc3xCQxiPqMHVXPrzcgUw8rrKQ7vCu5HUXL4TVRntDS"),
    shareMint: new PublicKey("Ggbz1DvG6sh5FwTCFUqc85M6RYVduivGu3BhyxVHqpP1"),
    collection: new PublicKey("EoZ5NFigrZ7uqUUSH6ShDsYGMooe5ziTfgWvAbFmVTXt"),
  };

  // Derive vault PDA
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), CONFIG.assetMint.toBuffer(), wallet.publicKey.toBuffer()],
    vaultProgram.programId
  );

  const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
  console.log("Vault share_mint:", vaultAccount.shareMint.toBase58());



  // Derive the vault's associated token account (ATA) for assetMint
  const vaultTokenAccount = await getAssociatedTokenAddress(
    CONFIG.assetMint, // mint
    vaultPda,         // owner = vault PDA
    true              // allow owner PDA (not regular wallet)
  );

  console.log("Vault Token Account:", vaultTokenAccount.toBase58());

  // Create it if it doesn’t exist
  try {
    const ix = createAssociatedTokenAccountInstruction(
      wallet.publicKey,    // payer
      vaultTokenAccount,   // ata
      vaultPda,            // owner = vault
      CONFIG.assetMint
    );

    await provider.sendAndConfirm(new Transaction().add(ix));
    console.log("✅ Vault token account created");
  } catch (err) {
    console.log("⚠️ Vault token account may already exist:", err);
  }
}

main().catch(console.error);
