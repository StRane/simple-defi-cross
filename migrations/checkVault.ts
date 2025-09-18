import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { SimpleVault } from "../target/types/simple_vault";
import SimpleVaultIDL from "../target/idl/simple_vault.json";

async function main() {
    console.log("🔍 Fetching and Debugging Vault Account...\n");

    // Setup providers and programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // **CRITICAL**: Which program ID is correct?
    const DEPLOYED_PROGRAM_ID = new PublicKey("6szSVnHy2GrCi6y7aQxJfQG9WpVkTgdB6kDXixepvdoW"); // From your transaction
    const SCRIPT_PROGRAM_ID = new PublicKey("B2iJWvv6hwMvVkdKm1ovTzSr52neJU9k8AQyQHVBtFRM"); // From your script

    console.log("📋 Program ID Investigation:");
    console.log("From transaction logs:", DEPLOYED_PROGRAM_ID.toBase58());
    console.log("From your script:   ", SCRIPT_PROGRAM_ID.toBase58());
    console.log("Programs match:", DEPLOYED_PROGRAM_ID.equals(SCRIPT_PROGRAM_ID) ? "✅ YES" : "❌ NO");

    // The vault PDA from your transaction
    const VAULT_PDA = new PublicKey("DbCxNx4uvjK2wxvJbrd5DVJ6jVM8eJirYk8RbAL9Mvt1");

    try {
        // ================================
        // STEP 1: Raw Account Info
        // ================================
        console.log("\n🔍 STEP 1: Raw account inspection...");

        const accountInfo = await provider.connection.getAccountInfo(VAULT_PDA);

        if (!accountInfo) {
            console.log("❌ Account does not exist!");
            return;
        }

        console.log("📊 Raw Account Info:");
        console.log("  Address:", VAULT_PDA.toBase58());
        console.log("  Owner:", accountInfo.owner.toBase58());
        console.log("  Data Length:", accountInfo.data.length, "bytes");
        console.log("  Lamports:", accountInfo.lamports);
        console.log("  Executable:", accountInfo.executable);
        console.log("  Rent Epoch:", accountInfo.rentEpoch);

        // Check which program owns this account
        console.log("\n🔍 Program Ownership Check:");
        console.log("  Owned by DEPLOYED_PROGRAM_ID:", accountInfo.owner.equals(DEPLOYED_PROGRAM_ID) ? "✅ YES" : "❌ NO");
        console.log("  Owned by SCRIPT_PROGRAM_ID:", accountInfo.owner.equals(SCRIPT_PROGRAM_ID) ? "✅ YES" : "❌ NO");

        // ================================
        // STEP 2: Try with DEPLOYED Program ID
        // ================================
        console.log("\n🔍 STEP 2: Attempting to deserialize with DEPLOYED program ID...");

        try {

            const deployedProgram = new anchor.Program<SimpleVault>(
                SimpleVaultIDL as anchor.Idl,
                provider
            );

            // Override the program ID to point to deployed version
            Object.defineProperty(deployedProgram, 'programId', {
                value: DEPLOYED_PROGRAM_ID,
                writable: false
            });
            // const deployedProgram = new anchor.Program<SimpleVault>(
            //     SimpleVaultIDL as SimpleVault,
            //     provider,
            //     DEPLOYED_PROGRAM_ID
            // );

            const vaultData = await deployedProgram.account.vault.fetch(VAULT_PDA);
            console.log("✅ SUCCESS with DEPLOYED program ID!");
            console.log("📊 Vault Data:");
            console.log("  Owner:", vaultData.owner.toBase58());
            console.log("  Asset Mint:", vaultData.assetMint.toBase58());
            console.log("  Share Mint:", vaultData.shareMint.toBase58());
            console.log("  NFT Collection:", vaultData.nftCollectionAddress.toBase58());
            console.log("  Total Borrowed:", vaultData.totalBorrowed?.toString() || "0");
            console.log("  Borrow Index:", vaultData.borrowIndex?.toString() || "0");
            console.log("  Borrow Rate:", vaultData.borrowRate?.toString() || "0");
            console.log("  Last Update:", vaultData.lastUpdateTime?.toString() || "0");
            console.log("  Reserve Factor:", vaultData.reserveFactor?.toString() || "0");
            console.log("  Total Reserves:", vaultData.totalReserves?.toString() || "0");
            console.log("  Total Shares:", vaultData.totalShares?.toString() || "0");
            console.log("  Bump:", vaultData.bump);

            console.log("\n✅ DEPLOYED program ID can deserialize the vault successfully!");

        } catch (err) {
            console.log("❌ FAILED with DEPLOYED program ID:", (err as Error).message);
        }

        // ================================
        // STEP 3: Try with SCRIPT Program ID
        // ================================
        console.log("\n🔍 STEP 3: Attempting to deserialize with SCRIPT program ID...");

        try {

            const scriptProgram = new anchor.Program<SimpleVault>(
                SimpleVaultIDL as anchor.Idl,
                provider
            );

            // Override the program ID to point to deployed version
            Object.defineProperty(scriptProgram, 'programId', {
                value: SCRIPT_PROGRAM_ID,
                writable: false
            });

            // const scriptProgram = new anchor.Program<SimpleVault>(
            //     anchor.workspace.SimpleVault.idl,
            //     SCRIPT_PROGRAM_ID,
            //     provider
            // );

            const vaultData = await scriptProgram.account.vault.fetch(VAULT_PDA);
            console.log("✅ SUCCESS with SCRIPT program ID!");
            console.log("📊 Vault Data:");
            console.log("  Owner:", vaultData.owner.toBase58());
            console.log("  Asset Mint:", vaultData.assetMint.toBase58());
            console.log("  Share Mint:", vaultData.shareMint.toBase58());
            console.log("  NFT Collection:", vaultData.nftCollectionAddress.toBase58());
            console.log("  Total Borrowed:", vaultData.totalBorrowed?.toString() || "0");
            console.log("  Total Shares:", vaultData.totalShares?.toString() || "0");
            console.log("  Bump:", vaultData.bump);

            console.log("\n✅ SCRIPT program ID can deserialize the vault successfully!");

        } catch (err) {
            console.log("❌ FAILED with SCRIPT program ID:", (err as Error).message);
        }

        // ================================
        // STEP 4: Raw Data Inspection
        // ================================
        console.log("\n🔍 STEP 4: Raw data inspection...");

        console.log("📊 First 50 bytes of account data:");
        const first50Bytes = accountInfo.data.slice(0, 50);
        console.log("  Hex:", first50Bytes.toString('hex'));
        console.log("  Bytes:", Array.from(first50Bytes));

        // Try to manually parse the discriminator (first 8 bytes)
        const discriminator = accountInfo.data.slice(0, 8);
        console.log("📊 Account Discriminator:");
        console.log("  Hex:", discriminator.toString('hex'));
        console.log("  Bytes:", Array.from(discriminator));

        // ================================
        // STEP 5: IDL Structure Analysis
        // ================================
        console.log("\n🔍 STEP 5: IDL structure analysis...");

        const idl = anchor.workspace.SimpleVault.idl;
        const vaultAccount = idl.accounts?.find((acc: any) => acc.name === 'Vault');

        if (vaultAccount) {
            console.log("📊 IDL Vault Account Structure:");
            console.log("  Name:", vaultAccount.name);
            console.log("  Fields:");

            if ('type' in vaultAccount && 'fields' in vaultAccount.type) {
                vaultAccount.type.fields.forEach((field: any, index: number) => {
                    console.log(`    ${index + 1}. ${field.name}: ${JSON.stringify(field.type)}`);
                });
            }
        }

        // ================================
        // STEP 6: Size Calculation
        // ================================
        console.log("\n🔍 STEP 6: Expected size calculation...");

        // Based on your Rust struct:
        // pub struct Vault {
        //     pub owner: Pubkey,                    // 32 bytes
        //     pub asset_mint: Pubkey,               // 32 bytes
        //     pub share_mint: Pubkey,               // 32 bytes
        //     pub nft_collection_address: Pubkey,   // 32 bytes
        //     pub total_borrowed: u64,              // 8 bytes
        //     pub borrow_index: u64,                // 8 bytes
        //     pub borrow_rate: u64,                 // 8 bytes
        //     pub last_update_time: i64,            // 8 bytes
        //     pub reserve_factor: u64,              // 8 bytes
        //     pub total_reserves: u64,              // 8 bytes
        //     pub total_shares: u64,                // 8 bytes
        //     pub bump: u8,                         // 1 byte
        // }

        const expectedSize = 8 + // discriminator
            32 + // owner
            32 + // asset_mint
            32 + // share_mint
            32 + // nft_collection_address
            8 +  // total_borrowed
            8 +  // borrow_index
            8 +  // borrow_rate
            8 +  // last_update_time
            8 +  // reserve_factor
            8 +  // total_reserves
            8 +  // total_shares
            1;   // bump

        console.log("📊 Size Analysis:");
        console.log("  Expected size:", expectedSize, "bytes");
        console.log("  Actual size:", accountInfo.data.length, "bytes");
        console.log("  Size matches:", expectedSize === accountInfo.data.length ? "✅ YES" : "❌ NO");
        console.log("  Difference:", accountInfo.data.length - expectedSize, "bytes");

        // ================================
        // CONCLUSION
        // ================================
        console.log("\n🎯 DIAGNOSIS CONCLUSION:");

        if (accountInfo.owner.equals(DEPLOYED_PROGRAM_ID)) {
            console.log("✅ The vault account is owned by the DEPLOYED program ID");
            console.log("💡 Your hook should use:", DEPLOYED_PROGRAM_ID.toBase58());
        } else if (accountInfo.owner.equals(SCRIPT_PROGRAM_ID)) {
            console.log("✅ The vault account is owned by the SCRIPT program ID");
            console.log("💡 Your hook should use:", SCRIPT_PROGRAM_ID.toBase58());
        } else {
            console.log("❌ The vault account is owned by an unknown program!");
            console.log("🔍 Owner:", accountInfo.owner.toBase58());
        }

        if (expectedSize === accountInfo.data.length) {
            console.log("✅ Account size matches expected Rust struct");
            console.log("💡 The issue is likely the wrong program ID in your TypeScript");
        } else {
            console.log("❌ Account size does NOT match expected Rust struct");
            console.log("💡 The Rust struct and IDL may be out of sync");
        }

    } catch (error) {
        console.error("\n❌ Error during diagnosis:", error);

        if (error instanceof Error) {
            console.error("Error details:", error.message);
        }
    }
}

if (require.main === module) {
    main()
        .then(() => {
            console.log("\n✅ Vault diagnosis completed!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Diagnosis failed:", error);
            process.exit(1);
        });
}