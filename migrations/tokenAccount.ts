import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { SimpleVault } from "../target/types/simple_vault";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.SimpleVault as anchor.Program<SimpleVault>;
  const wallet = provider.wallet as anchor.Wallet;

  console.log("Deployer wallet:", wallet.publicKey.toBase58());

  // Replace with your deployed mints & collection
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
  console.log("Vault PDA:", vaultPda.toBase58());

  // Derive vault token account PDA from IDL seeds
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [vaultPda.toBuffer(), Buffer.from([6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169]), CONFIG.assetMint.toBuffer()],
    vaultProgram.programId
  );

  console.log("Vault Token Account PDA:", vaultTokenAccount.toBase58());

  // Check if vault token account already exists
  let accountExists = false;
  try {
    const accountInfo = await getAccount(provider.connection, vaultTokenAccount);
    console.log("✅ Vault token account already exists:", accountInfo.address.toBase58());
    accountExists = true;
  } catch (err) {
    console.log("⚠️ Vault token account does not exist, will create it");
  }

  // Initialize vault only if it doesn't exist
  if (!accountExists) {
    console.log("Initializing vault...");
    const tx = await vaultProgram.methods
      .initializeVault(CONFIG.collection)
      .accounts({
        owner: wallet.publicKey,
        assetMint: CONFIG.assetMint,
        shareMint: CONFIG.shareMint,
      })
      .signers([])
      .rpc();

    console.log("✅ Vault initialized with tx:", tx);
  } else {
    console.log("Vault already initialized, skipping...");
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
