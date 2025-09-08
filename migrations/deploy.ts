// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { SimpleVault } from "../target/types/simple_vault";
import { UniqueLow } from "../target/types/unique_low";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.SimpleVault as anchor.Program<SimpleVault>;
  const nftProgram = anchor.workspace.UniqueLow as anchor.Program<UniqueLow>;

  const wallet = provider.wallet as anchor.Wallet;
  console.log("Deployer wallet:", wallet.publicKey.toBase58());

  // --------------------------
  // 1. NFT Collection
  // --------------------------
  const [collectionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection")],
    nftProgram.programId
  );
  const wormholeProgram = new PublicKey(
    "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
  );

  try {
    const tx = await nftProgram.methods
      .initialize("Vault Access NFTs", "VAN", "https://vault-nfts.com/metadata/", wormholeProgram)
      .accounts({
        authority: wallet.publicKey,
      })
      .rpc();
    console.log("✅ NFT Collection initialized:", tx);
  } catch (e) {
    console.log("⚠️ Collection may already exist, skipping init.");
  }

  // --------------------------
  // 2. Create asset mint
  // --------------------------
  const assetMint = await createMint(
    provider.connection,
    wallet.payer,
    wallet.publicKey, // mint authority
    wallet.publicKey, // freeze authority
    6
  );
  console.log("✅ Asset mint created:", assetMint.toBase58());

  // Create and fund deployer’s ATA
  const deployerAta = await getAssociatedTokenAddress(assetMint, wallet.publicKey);
  const ataIx = createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    deployerAta,
    wallet.publicKey,
    assetMint
  );
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(ataIx));
  await mintTo(
    provider.connection,
    wallet.payer,
    assetMint,
    deployerAta,
    wallet.publicKey,
    BigInt(1_000_000_000_000)
  );
  console.log("✅ Minted initial tokens to deployer ATA:", deployerAta.toBase58());

  // --------------------------
  // 3. Mint NFT to deployer
  // --------------------------
  const nftMintKeypair = Keypair.generate();
  await nftProgram.methods
    .mintNft()
    .accounts({
      mint: nftMintKeypair.publicKey,
      user: wallet.publicKey,
    })
    .signers([nftMintKeypair])
    .rpc();
  console.log("✅ Minted NFT to deployer:", nftMintKeypair.publicKey.toBase58());

  // --------------------------
  // 4. Initialize vault
  // --------------------------
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), assetMint.toBuffer(), wallet.publicKey.toBuffer()],
    vaultProgram.programId
  );

  const shareMintKeypair = Keypair.generate();
  const shareMint = shareMintKeypair.publicKey;

  await vaultProgram.methods
    .initializeVault(collectionPda)
    .accounts({
      owner: wallet.publicKey,
      assetMint,
      shareMint,
    })
    .signers([shareMintKeypair])
    .rpc();

  console.log("✅ Vault initialized at:", vaultPda.toBase58());
  console.log("Share mint:", shareMint.toBase58());
  console.log("Collection:", collectionPda.toBase58());

  console.log("\n🎉 Deployment complete!");
}

main().catch((err) => {
  console.error("Deployment error:", err);
  process.exit(1);
});

