import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { SimpleVault } from "../target/types/simple_vault";

async function main() {
  console.log("🗑️ Closing Vault Account...\n");
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = anchor.workspace.SimpleVault as anchor.Program<SimpleVault>;
  const wallet = provider.wallet as anchor.Wallet;
  
  // Current vault details from your transaction
  const VAULT_PDA = new PublicKey("2waxdDxemiTJNX7G6n7VS6gnoubrWgwWgAuG5XWmctgw");
  const ASSET_MINT = new PublicKey("4kXBWAG92UZA1FPEQDN5bjePoFyQsbTnZ9rpxgRBbFYk");
  
  try {
    console.log("📋 Configuration:");
    console.log("  Wallet:", wallet.publicKey.toBase58());
    console.log("  Vault to close:", VAULT_PDA.toBase58());
    console.log("  Asset mint:", ASSET_MINT.toBase58());
    
    // Check if vault exists before attempting to close
    console.log("\n🔍 Checking vault existence...");
    const vaultAccount = await provider.connection.getAccountInfo(VAULT_PDA);
    
    if (!vaultAccount) {
      console.log("❌ Vault account does not exist!");
      return;
    }
    
    console.log("✅ Vault exists (", vaultAccount.data.length, "bytes)");
    
    // Try to fetch vault data to verify ownership
    console.log("\n🔍 Verifying vault ownership...");
    try {
      const vaultData = await program.account.vault.fetch(VAULT_PDA);
      console.log("✅ Vault owner:", vaultData.owner.toBase58());
      console.log("✅ Your wallet:", wallet.publicKey.toBase58());
      
      if (!vaultData.owner.equals(wallet.publicKey)) {
        console.log("❌ You are not the owner of this vault!");
        return;
      }
    } catch (err) {
      console.log("⚠️ Could not deserialize vault data:", err);
      console.log("📋 Proceeding with close attempt anyway...");
    }
    
    // Attempt to close the vault
    console.log("\n🗑️ Closing vault...");
    
    const tx = await program.methods
      .closeVault()
      .accounts({
        vault: VAULT_PDA,
        assetMint: ASSET_MINT,
        authority: wallet.publicKey,
      })
      .rpc();
    
    console.log("✅ Vault closed successfully!");
    console.log("📝 Transaction signature:", tx);
    
    // Verify the vault was closed
    console.log("\n🔍 Verifying closure...");
    const closedVaultAccount = await provider.connection.getAccountInfo(VAULT_PDA);
    
    if (!closedVaultAccount) {
      console.log("✅ Vault account successfully deleted!");
    } else {
      console.log("⚠️ Vault account still exists. Close may have failed.");
    }
    
  } catch (error) {
    console.error("\n❌ Error closing vault:");
    
    if (error instanceof anchor.AnchorError) {
      console.error("  Anchor Error:", error.error.errorMessage);
      console.error("  Error Code:", error.error.errorCode.code);
    } else {
      console.error("  Error:", error);
    }
    
    // Additional troubleshooting info
    console.log("\n🔧 Troubleshooting:");
    console.log("  1. Make sure you are the vault owner");
    console.log("  2. Check if vault has any outstanding balances");
    console.log("  3. Ensure your close_vault instruction exists in the program");
    console.log("  4. Try using solana CLI to close the account manually if needed");
  }
}

// Alternative manual close using Solana CLI (if Anchor close fails)
function printManualCloseInstructions() {
  console.log("\n🔧 Manual Close Instructions:");
  console.log("If the Anchor close fails, you can try manually with Solana CLI:");
  console.log("");
  console.log("solana transfer \\");
  console.log("  2waxdDxemiTJNX7G6n7VS6gnoubrWgwWgAuG5XWmctgw \\");
  console.log("  ALL \\");
  console.log("  --url testnet \\");
  console.log("  --allow-unfunded-recipient");
  console.log("");
  console.log("Note: This only works if you're the account owner and");
  console.log("the account has no data dependencies.");
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✅ Close vault script completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error);
      printManualCloseInstructions();
      process.exit(1);
    });
}