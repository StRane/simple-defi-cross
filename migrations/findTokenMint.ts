import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function findExistingTestTokenMint() {
  console.log("🔍 Finding existing test_token mint...\n");
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  // Your known values
  const TEST_TOKEN_PROGRAM_ID = new PublicKey("HY3dPfn3MJqLSbQm4jExye2H8KZag8AkD2AmBXgL2SKm");
  const EXPECTED_MINT_AUTH = new PublicKey("Eugyc4rLEsvZJ2kr1p4wnLzNqGJHruz7Q1dkZm4jxhsV");
  
  console.log("🎯 Looking for mints with authority:", EXPECTED_MINT_AUTH.toBase58());
  console.log("👤 Your wallet:", wallet.publicKey.toBase58());

  try {
    // Method 1: Check your token accounts to find mints you own
    console.log("\n📦 Method 1: Checking your token accounts...");
    
    const tokenAccounts = await provider.connection.getParsedTokenAccountsByOwner(
      wallet.publicKey,
      { programId: anchor.utils.token.TOKEN_PROGRAM_ID }
    );

    console.log(`Found ${tokenAccounts.value.length} token accounts in your wallet`);

    const potentialMints = [];
    
    for (const { account, pubkey } of tokenAccounts.value) {
      const parsedInfo = account.data.parsed.info;
      const mintAddress = new PublicKey(parsedInfo.mint);
      const balance = Number(parsedInfo.tokenAmount.uiAmount) || 0;
      const decimals = Number(parsedInfo.tokenAmount.decimals);

      // Only check accounts with tokens and 9 decimals (your test token format)
      if (balance > 0 && decimals === 9) {
        try {
          // Check the mint's authority
          const mintInfo = await provider.connection.getParsedAccountInfo(mintAddress);
          const mintData = mintInfo.value?.data;

          if (mintData && 'parsed' in mintData) {
            const mintAuthority = mintData.parsed.info.mintAuthority;
            
            console.log(`\n🪙 Token Account: ${pubkey.toBase58().slice(0, 8)}...`);
            console.log(`   Mint: ${mintAddress.toBase58()}`);
            console.log(`   Balance: ${balance}`);
            console.log(`   Decimals: ${decimals}`);
            console.log(`   Mint Authority: ${mintAuthority}`);
            
            if (mintAuthority === EXPECTED_MINT_AUTH.toBase58()) {
              console.log(`   ✅ MATCH! This mint is from your test_token program!`);
              potentialMints.push({
                mint: mintAddress,
                tokenAccount: pubkey,
                balance,
                authority: mintAuthority
              });
            } else {
              console.log(`   ❌ Different authority`);
            }
          }
        } catch (err) {
          console.log(`   ⚠️  Could not check mint authority: ${err}`);
        }
      }
    }

    if (potentialMints.length > 0) {
      console.log(`\n🎉 Found ${potentialMints.length} mint(s) from your test_token program:`);
      potentialMints.forEach((mint, index) => {
        console.log(`\n${index + 1}. 🪙 Mint: ${mint.mint.toBase58()}`);
        console.log(`   📊 Balance: ${mint.balance} tokens`);
        console.log(`   🏦 Token Account: ${mint.tokenAccount.toBase58()}`);
        console.log(`   ✅ Authority: ${mint.authority.slice(0, 8)}...${mint.authority.slice(-8)}`);
      });
      
      // Recommend the first one
      const recommendedMint = potentialMints[0];
      console.log(`\n💡 RECOMMENDED: Use this mint for your vault:`);
      console.log(`   VAULT_ASSET_MINT: new PublicKey("${recommendedMint.mint.toBase58()}")`);
      
      return recommendedMint.mint;
    } else {
      console.log("\n❌ No mints found from your test_token program in your wallet");
    }

    // Method 2: Check recent program transactions (if Method 1 fails)
    console.log("\n📜 Method 2: Checking recent program transactions...");
    
    const signatures = await provider.connection.getSignaturesForAddress(
      TEST_TOKEN_PROGRAM_ID,
      { limit: 20 }
    );
    
    console.log(`Found ${signatures.length} recent transactions for test_token program`);
    
    for (const sig of signatures.slice(0, 5)) { // Check last 5 transactions
      try {
        const tx = await provider.connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0
        });
        
        if (tx && tx.meta && tx.meta.postTokenBalances) {
          for (const balance of tx.meta.postTokenBalances) {
            if (balance.owner === wallet.publicKey.toBase58()) {
              console.log(`\n📝 Transaction: ${sig.signature.slice(0, 8)}...`);
              console.log(`   Mint: ${balance.mint}`);
              console.log(`   Your balance after: ${balance.uiTokenAmount.uiAmount}`);
              
              // Check if this mint has your authority
              try {
                const mintPubkey = new PublicKey(balance.mint);
                const mintInfo = await provider.connection.getParsedAccountInfo(mintPubkey);
                const mintData = mintInfo.value?.data;
                
                if (mintData && 'parsed' in mintData) {
                  const mintAuthority = mintData.parsed.info.mintAuthority;
                  if (mintAuthority === EXPECTED_MINT_AUTH.toBase58()) {
                    console.log(`   ✅ FOUND! This is from your test_token program!`);
                    console.log(`\n💡 USE THIS MINT: ${balance.mint}`);
                    return new PublicKey(balance.mint);
                  }
                }
              } catch (err) {
                // Skip this one
              }
            }
          }
        }
      } catch (err) {
        // Skip this transaction
      }
    }

    // Method 3: If nothing found, suggest creating new mint
    console.log("\n🤔 No existing mint found from your test_token program");
    console.log("\nOptions:");
    console.log("1. Create a new mint using your test_token program");
    console.log("2. Check if you have the mint address saved somewhere");
    console.log("3. Look at your transaction history on Solana Explorer");
    
    console.log(`\n🔗 Check your wallet transactions here:`);
    console.log(`https://explorer.solana.com/address/${wallet.publicKey.toBase58()}?cluster=devnet`);

  } catch (error) {
    console.error("❌ Error finding existing mint:", error);
  }
}

// Additional helper to check a specific mint
async function checkSpecificMint(mintAddress: string) {
  console.log(`\n🔍 Checking specific mint: ${mintAddress}`);
  
  const provider = anchor.AnchorProvider.env();
  const EXPECTED_MINT_AUTH = new PublicKey("Eugyc4rLEsvZJ2kr1p4wnLzNqGJHruz7Q1dkZm4jxhsV");
  
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await provider.connection.getParsedAccountInfo(mintPubkey);
    const mintData = mintInfo.value?.data;
    
    if (mintData && 'parsed' in mintData) {
      const info = mintData.parsed.info;
      console.log("📊 Mint Info:");
      console.log(`   Authority: ${info.mintAuthority}`);
      console.log(`   Decimals: ${info.decimals}`);
      console.log(`   Supply: ${info.supply}`);
      console.log(`   From your program: ${info.mintAuthority === EXPECTED_MINT_AUTH.toBase58() ? '✅ YES' : '❌ NO'}`);
      
      return info.mintAuthority === EXPECTED_MINT_AUTH.toBase58();
    }
  } catch (err) {
    console.log("❌ Invalid mint address or mint doesn't exist");
    return false;
  }
}

// Main execution
async function main() {
  await findExistingTestTokenMint();
  
  // Uncomment and add mint address if you want to check a specific one
  // await checkSpecificMint("PUT_MINT_ADDRESS_HERE");
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✅ Search completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Search failed:", error);
      process.exit(1);
    });
}