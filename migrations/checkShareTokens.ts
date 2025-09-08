import * as anchor from "@coral-xyz/anchor";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

async function main() {
  // 1️⃣ Setup provider & wallet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet;

  // 2️⃣ Vault and share mint info
  const vaultShareMint = new PublicKey("Ggbz1DvG6sh5FwTCFUqc85M6RYVduivGu3BhyxVHqpP1"); // Replace with your vault's share mint

  // 3️⃣ Derive your associated token account (ATA) for the share mint
  const userShareTokenAccount = await getAssociatedTokenAddress(
    vaultShareMint,
    wallet.publicKey
  );

  console.log("Your share token account:", userShareTokenAccount.toBase58());

  // 4️⃣ Fetch the account info
  try {
    const accountInfo = await getAccount(provider.connection, userShareTokenAccount);
    console.log("Raw balance:", accountInfo.amount.toString());

    // Assuming 6 decimals like typical vault shares
    const decimals =  6;
    const humanReadable = Number(accountInfo.amount) / 10 ** decimals;
    console.log(`Balance: ${humanReadable} shares`);
  } catch (err) {
    console.error("Error fetching share token account:", err);
  }
}

main().catch((err) => {
  console.error(err);
});
