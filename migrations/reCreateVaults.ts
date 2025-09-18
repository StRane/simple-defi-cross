// scripts/recreate_vault.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { SimpleVault } from "../target/types/simple_vault";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = anchor.workspace.SimpleVault as anchor.Program<SimpleVault>;
  const wallet = provider.wallet as anchor.Wallet;
  
  const assetMint = new PublicKey("4kXBWAG92UZA1FPEQDN5bjePoFyQsbTnZ9rpxgRBbFYk");
  const collection = new PublicKey("EoZ5NFigrZ7uqUUSH6ShDsYGMooe5ziTfgWvAbFmVTXt");
  
  // Step 1: Close existing vault
  console.log("🗑️ Closing existing vault...");
  try {
    const tx1 = await program.methods
      .closeVault()
      .accounts({
        authority: wallet.publicKey,
        assetMint: assetMint,
      })
      .rpc();
    console.log("✅ Vault closed:", tx1);
  } catch (err) {
    console.log("⚠️ Close failed (vault might not exist):", err);
  }
  
  // Step 2: Wait a bit
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Step 3: Recreate vault
  console.log("🏗️ Creating new vault...");
  const tx2 = await program.methods
    .initializeVault(collection)
    .accounts({
      owner: wallet.publicKey,
      assetMint: assetMint,
    })
    .rpc();
  
  console.log("✅ New vault created:", tx2);
}

main().catch(console.error);