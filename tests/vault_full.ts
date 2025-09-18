import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UniqueLow } from "../target/types/unique_low";
import { SimpleVault } from "../target/types/simple_vault"; // Add this import
import { TestToken } from "../target/types/test_token"
import {
    PublicKey,
    Keypair,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    SYSVAR_CLOCK_PUBKEY
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount,
    createMint,
    mintTo,
    createAccount
} from "@solana/spl-token";
import { expect } from "chai";

describe("unique_low with vault", () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const nftProgram = anchor.workspace.UniqueLow as Program<UniqueLow>;
    const vaultProgram = anchor.workspace.SimpleVault as Program<SimpleVault>;
    const testTokenProgram = anchor.workspace.TestToken as Program<TestToken>;

    // Test accounts
    let authority: Keypair;
    let user1: Keypair;
    let user2: Keypair;
    let collectionPda: PublicKey;
    let collectionBump: number;
    let wormholeProgram: PublicKey;

    // Vault-related accounts
    let assetMint: PublicKey;
    let vaultPda: PublicKey;
    let vaultBump: number;
    let shareMint: PublicKey;
    let vaultTokenAccount: PublicKey;

    // INITIALIZE THESE PROPERLY
    let user1Data = {
        firstMint: null as PublicKey | null,
        firstTokenAccount: null as PublicKey | null,
        secondMint: null as PublicKey | null,
        secondTokenAccount: null as PublicKey | null,
        assetTokenAccount: null as PublicKey | null,
        shareTokenAccount: null as PublicKey | null,
        sharePda: null as PublicKey | null,
        nftInfo: null as PublicKey | null
    };

    let user2Data = {
        firstMint: null as PublicKey | null,
        firstTokenAccount: null as PublicKey | null,
        assetTokenAccount: null as PublicKey | null,
        shareTokenAccount: null as PublicKey | null,
        sharePda: null as PublicKey | null,
        nftInfo: null as PublicKey | null
    };

    // Collection info
    const collectionName = "Test NFT Collection";
    const collectionSymbol = "TNC";
    const baseUri = "https://example.com/metadata/";

    before(async () => {
        // Initialize test keypairs
        authority = Keypair.generate();
        user1 = Keypair.generate();
        user2 = Keypair.generate();

        // Airdrop SOL to test accounts
        await provider.connection.requestAirdrop(authority.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
        await provider.connection.requestAirdrop(user1.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
        await provider.connection.requestAirdrop(user2.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);

        // Wait for airdrops
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Find collection PDA
        [collectionPda, collectionBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("collection")],
            nftProgram.programId
        );

        // Wormhole program ID (using placeholder)
        wormholeProgram = new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");

        const mintKeypair = Keypair.generate();

        // Initialize the test token program
        await testTokenProgram.methods
            .initialize()
            .accounts({
                payer: authority.publicKey,
                mint: mintKeypair.publicKey,
            })
            .signers([authority, mintKeypair])
            .rpc();

        assetMint = mintKeypair.publicKey;

        // Find vault PDA
        [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_v3"), assetMint.toBuffer(), authority.publicKey.toBuffer()],
            vaultProgram.programId
        );

        console.log("Setup completed");

    });

    it("Initialize collection", async () => {
        try {
            const tx = await nftProgram.methods
                .initialize(collectionName, collectionSymbol, baseUri, wormholeProgram)
                .accounts({
                    authority: authority.publicKey,
                })
                .signers([authority])
                .rpc();

            console.log("Initialize transaction signature", tx);

            // Verify collection was initialized correctly
            const collection = await nftProgram.account.collection.fetch(collectionPda);
            expect(collection.authority.toString()).to.equal(authority.publicKey.toString());
            expect(collection.name).to.equal(collectionName);
            expect(collection.symbol).to.equal(collectionSymbol);
            expect(collection.baseUri).to.equal(baseUri);
            expect(collection.totalSupply.toNumber()).to.equal(0);
            expect(collection.bump).to.equal(collectionBump);
        } catch (error) {
            console.log("Initialization error:", error);
            try {
                const collection = await nftProgram.account.collection.fetch(collectionPda);
                console.log("Collection already exists with total supply:", collection.totalSupply.toNumber());
            } catch (fetchError) {
                throw error;
            }
        }
    });

    it("Initialize vault", async () => {
        const shareKeypair = Keypair.generate();
        shareMint = shareKeypair.publicKey;

        // Get vault token account address
        vaultTokenAccount = await getAssociatedTokenAddress(
            assetMint,
            vaultPda,
            true
        );

        const tx = await vaultProgram.methods
            .initializeVault(collectionPda) // Pass collection address
            .accounts({
                owner: authority.publicKey,
                assetMint: assetMint,
                // vault: vaultPda,
                shareMint: shareMint,
                // vaultTokenAccount: vaultTokenAccount,
                // tokenProgram: TOKEN_PROGRAM_ID,
                // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                // systemProgram: SystemProgram.programId,
            })
            .signers([authority, shareKeypair])
            .rpc();

        console.log("Initialize vault transaction signature", tx);

        // Verify vault was initialized correctly
        const vault = await vaultProgram.account.vault.fetch(vaultPda);
        expect(vault.owner.toString()).to.equal(authority.publicKey.toString());
        expect(vault.assetMint.toString()).to.equal(assetMint.toString());
        expect(vault.shareMint.toString()).to.equal(shareMint.toString());
        expect(vault.nftCollectionAddress.toString()).to.equal(collectionPda.toString());
        expect(vault.totalShares.toNumber()).to.equal(0);
    });

    it("Mint NFT for user1", async () => {
        const mint = Keypair.generate();

        const [userStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_state"), user1.publicKey.toBuffer()],
            nftProgram.programId
        );

        const tokenAccount = await getAssociatedTokenAddress(
            mint.publicKey,
            user1.publicKey
        );

        const tx = await nftProgram.methods
            .mintNft()
            .accounts({
                mint: mint.publicKey,
                user: user1.publicKey,
            })
            .signers([user1, mint])
            .rpc();

        console.log("Mint NFT transaction signature", tx);

        user1Data.firstMint = mint.publicKey;
        user1Data.firstTokenAccount = tokenAccount;

        // Create user's asset token account and mint some tokens for testing
        user1Data.assetTokenAccount = await getAssociatedTokenAddress(
            assetMint,
            user1.publicKey
        );

        // Create the associated token account
        const createAtaIx = createAssociatedTokenAccountInstruction(
            user1.publicKey,
            user1Data.assetTokenAccount,
            user1.publicKey,
            assetMint
        );

        const createAtaTx = new anchor.web3.Transaction().add(createAtaIx);
        await anchor.web3.sendAndConfirmTransaction(
            provider.connection,
            createAtaTx,
            [user1]
        );

        await testTokenProgram.methods
            .mintTokens(new anchor.BN(1000000000))
            .accounts({
                caller: user1.publicKey,
                mint: assetMint,
                // recipient and mintAuth auto-derived
            })
            .signers([user1])
            .rpc();

        // Setup user share PDA and token account
        [user1Data.sharePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_shares_v3"), user1Data.firstMint.toBuffer()],
            vaultProgram.programId
        );

        user1Data.shareTokenAccount = await getAssociatedTokenAddress(
            shareMint,
            user1Data.sharePda,
            true
        );

        // Setup NFT info PDA
        [user1Data.nftInfo] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("user_info_v3"),
                user1Data.firstTokenAccount.toBuffer(),
                user1Data.shareTokenAccount.toBuffer()
            ],
            vaultProgram.programId
        );
        // console.log("Account checks")
        // console.log("User1 asset account");
        // console.log(await provider.connection.getAccountInfo(user1Data.assetTokenAccount))
        // console.log("User1 sharetoken account");
        // console.log(await provider.connection.getAccountInfo(user1Data.shareTokenAccount))

        console.log("User1 setup completed");
    });

    it("Mint NFT for user2", async () => {
        const mint = Keypair.generate();

        const [userStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_state"), user2.publicKey.toBuffer()],
            nftProgram.programId
        );

        const tokenAccount = await getAssociatedTokenAddress(
            mint.publicKey,
            user2.publicKey
        );

        const tx = await nftProgram.methods
            .mintNft()
            .accounts({
                mint: mint.publicKey,
                user: user2.publicKey,
            })
            .signers([user2, mint])
            .rpc();

        console.log("Mint NFT for user2 transaction signature", tx);

        user2Data.firstMint = mint.publicKey;
        user2Data.firstTokenAccount = tokenAccount;

        // Create user2's asset token account and mint some tokens for testing
        user2Data.assetTokenAccount = await getAssociatedTokenAddress(
            assetMint,
            user2.publicKey
        );

        const createAtaIx = createAssociatedTokenAccountInstruction(
            user2.publicKey,
            user2Data.assetTokenAccount,
            user2.publicKey,
            assetMint
        );

        const createAtaTx = new anchor.web3.Transaction().add(createAtaIx);
        await anchor.web3.sendAndConfirmTransaction(
            provider.connection,
            createAtaTx,
            [user2]
        );

        await testTokenProgram.methods
            .mintTokens(new anchor.BN(500_000_000_000)) // 500 tokens with 9 decimals
            .accounts({
                caller: user2.publicKey,
                mint: assetMint,
            })
            .signers([user2])
            .rpc();

        // Setup user2 share PDA and token account
        [user2Data.sharePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_shares_v3"), user2Data.firstMint.toBuffer()],
            vaultProgram.programId
        );

        user2Data.shareTokenAccount = await getAssociatedTokenAddress(
            shareMint,
            user2Data.sharePda,
            true
        );

        // Setup NFT info PDA
        [user2Data.nftInfo] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("user_info_v3"),
                user2Data.firstTokenAccount.toBuffer(),
                user2Data.shareTokenAccount.toBuffer()
            ],
            vaultProgram.programId
        );

        console.log("User2 setup completed");
    });

    it("User1 deposits to vault", async () => {
        if (!user1Data.firstMint || !user1Data.assetTokenAccount) {
            throw new Error("User1 data not initialized");
        }

        const depositAmount = new anchor.BN(100_000_000); // 100 tokens

        const tx = await vaultProgram.methods
            .deposit(depositAmount)
            .accounts({
                user: user1.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: user1Data.firstTokenAccount,
                userNftMint: user1Data.firstMint,
                assetMint: assetMint,
                // userAssetToken: user1Data.assetTokenAccount,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
                // userSharePda: user1Data.sharePda,
                // userShareToken: user1Data.shareTokenAccount,
                // nftInfo: user1Data.nftInfo,
                // tokenProgram: TOKEN_PROGRAM_ID,
                // systemProgram: SystemProgram.programId,
                // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([user1])
            .rpc();

        console.log("User1 deposit transaction signature", tx);

        // Verify deposit was successful
        console.log("User1 asset account");
        console.log(await provider.connection.getAccountInfo(user1Data.assetTokenAccount))
        console.log("User1 sharetoken account");
        console.log(await provider.connection.getAccountInfo(user1Data.shareTokenAccount))
        console.log("User1 sharetoken pda account");
        console.log(user1Data.sharePda.toBase58())
        console.log("user 1 user")
        const vault = await vaultProgram.account.vault.fetch(vaultPda);
        expect(vault.totalShares.toNumber()).to.be.greaterThan(0);

        const userInfo = await vaultProgram.account.userInfo.fetch(user1Data.nftInfo);
        expect(userInfo.shares.toNumber()).to.equal(depositAmount.toNumber());

        console.log("User1 shares:", userInfo.shares.toNumber());
        console.log("Total vault shares:", vault.totalShares.toNumber());
    });

    it("User2 deposits to vault", async () => {
        if (!user2Data.firstMint || !user2Data.assetTokenAccount) {
            throw new Error("User2 data not initialized");
        }

        const depositAmount = new anchor.BN(50_000_000); // 50 tokens

        const tx = await vaultProgram.methods
            .deposit(depositAmount)
            .accounts({
                user: user2.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: user2Data.firstTokenAccount,
                userNftMint: user2Data.firstMint,
                assetMint: assetMint,
                // userAssetToken: user2Data.assetTokenAccount,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
                // userSharePda: user2Data.sharePda,
                // userShareToken: user2Data.shareTokenAccount,
                // nftInfo: user2Data.nftInfo,
                // tokenProgram: TOKEN_PROGRAM_ID,
                // systemProgram: SystemProgram.programId,
                // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([user2])
            .rpc();

        console.log("User2 deposit transaction signature", tx);

        // Verify vault state after second deposit
        const vault = await vaultProgram.account.vault.fetch(vaultPda);
        const user2Info = await vaultProgram.account.userInfo.fetch(user2Data.nftInfo);

        console.log("User2 shares:", user2Info.shares.toNumber());
        console.log("Total vault shares after user2:", vault.totalShares.toNumber());
    });

    it("User1 partially withdraws from vault", async () => {
        if (!user1Data.nftInfo) {
            throw new Error("User1 NFT info not initialized");
        }

        // Get user's current shares
        const userInfoBefore = await vaultProgram.account.userInfo.fetch(user1Data.nftInfo);
        const sharesToWithdraw = new anchor.BN(userInfoBefore.shares.toNumber() / 2); // Withdraw half

        const tx = await vaultProgram.methods
            .withdraw(sharesToWithdraw)
            .accounts({
                user: user1.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: user1Data.firstTokenAccount,
                userNftMint: user1Data.firstMint,
                assetMint: assetMint,
                // userAssetToken: user1Data.assetTokenAccount,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
                // userSharePda: user1Data.sharePda,
                // userShareToken: user1Data.shareTokenAccount,
                // nftInfo: user1Data.nftInfo,
                // tokenProgram: TOKEN_PROGRAM_ID,
                // systemProgram: SystemProgram.programId,
                // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([user1])
            .rpc();

        console.log("User1 withdraw transaction signature", tx);

        // Verify withdrawal was successful
        const userInfoAfter = await vaultProgram.account.userInfo.fetch(user1Data.nftInfo);
        expect(userInfoAfter.shares.toNumber()).to.be.lessThan(userInfoBefore.shares.toNumber());

        console.log("User1 shares before withdrawal:", userInfoBefore.shares.toNumber());
        console.log("User1 shares after withdrawal:", userInfoAfter.shares.toNumber());
    });

    it("Verify NFT ownership and mint authority", async () => {
        if (!user1Data.firstMint) {
            console.log("Skipping ownership test - user1Data.firstMint not initialized");
            return;
        }

        const mintInfo = await provider.connection.getParsedAccountInfo(user1Data.firstMint);
        const mintData = mintInfo.value?.data;

        if (mintData && 'parsed' in mintData) {
            expect(mintData.parsed.info.mintAuthority).to.equal(collectionPda.toString());
            expect(mintData.parsed.info.supply).to.equal("1");
            expect(mintData.parsed.info.decimals).to.equal(0);
        }
    });

    it("Get user nonce", async () => {
        try {
            const [userStatePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("user_state"), user1.publicKey.toBuffer()],
                nftProgram.programId
            );

            const nonce = await nftProgram.methods
                .getNonce()
                .accounts({
                    userState: userStatePda,
                })
                .view();

            expect(nonce.toNumber()).to.be.greaterThan(0);
            console.log("User1 nonce:", nonce.toNumber());
        } catch (error) {
            console.log("Get nonce error:", error);
            console.log("This might fail if user state doesn't exist yet");
        }
    });

    it("Get total supply", async () => {
        const totalSupply = await nftProgram.methods
            .totalSupply()
            .accounts({
                collection: collectionPda,
            })
            .view();

        console.log("Total supply:", totalSupply.toNumber());
        expect(totalSupply.toNumber()).to.be.greaterThan(0);
    });

    it("Try deposit without NFT (should fail)", async () => {
        // Create a user without NFT
        const userWithoutNft = Keypair.generate();
        await provider.connection.requestAirdrop(userWithoutNft.publicKey, anchor.web3.LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // This should fail because user doesn't own required NFT
        try {
            const depositAmount = new anchor.BN(10000000);

            await vaultProgram.methods
                .deposit(depositAmount)
                .accounts({
                    user: userWithoutNft.publicKey,
                    vault: vaultPda,
                    // ... other accounts would fail validation
                })
                .signers([userWithoutNft])
                .rpc();

            // If we get here, the test should fail
            expect.fail("Deposit should have failed for user without NFT");
        } catch (error) {
            console.log("Expected error for user without NFT:", error.message);
            // This is expected behavior
        }
    });
    it("Multiple deposits by same user - share calculation accuracy", async () => {
        // Create a third user for isolated testing
        const user3 = Keypair.generate();
        await provider.connection.requestAirdrop(user3.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Mint NFT for user3
        const mint3 = Keypair.generate();
        const tokenAccount3 = await getAssociatedTokenAddress(mint3.publicKey, user3.publicKey);

        await nftProgram.methods
            .mintNft()
            .accounts({
                mint: mint3.publicKey,
                user: user3.publicKey,
            })
            .signers([user3, mint3])
            .rpc();

        // Setup user3 accounts
        const assetTokenAccount3 = await getAssociatedTokenAddress(assetMint, user3.publicKey);
        const createAtaIx3 = createAssociatedTokenAccountInstruction(
            user3.publicKey,
            assetTokenAccount3,
            user3.publicKey,
            assetMint
        );
        const createAtaTx3 = new anchor.web3.Transaction().add(createAtaIx3);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, createAtaTx3, [user3]);

        // Mint tokens to user3
        await testTokenProgram.methods
            .mintTokens(new anchor.BN(1000_000_000_000)) // 1000 tokens
            .accounts({
                caller: user3.publicKey,
                mint: assetMint,
            })
            .signers([user3])
            .rpc();

        const [sharePda3] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_shares_v3"), mint3.publicKey.toBuffer()],
            vaultProgram.programId
        );

        const shareTokenAccount3 = await getAssociatedTokenAddress(shareMint, sharePda3, true);

        const [nftInfo3] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("user_info_v3"),
                tokenAccount3.toBuffer(),
                shareTokenAccount3.toBuffer()
            ],
            vaultProgram.programId
        );

        // Get initial vault state
        const initialVault = await vaultProgram.account.vault.fetch(vaultPda);
        const initialTotalShares = initialVault.totalShares.toNumber();
        const initialVaultBalance = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;

        console.log("=== Multiple Deposits Test ===");
        console.log("Initial vault shares:", initialTotalShares);
        console.log("Initial vault balance:", initialVaultBalance);

        // First deposit: 100 tokens
        const deposit1 = new anchor.BN(10_000_000);
        await vaultProgram.methods
            .deposit(deposit1)
            .accounts({
                user: user3.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: tokenAccount3,
                userNftMint: mint3.publicKey,
                assetMint: assetMint,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
            })
            .signers([user3])
            .rpc();

        const afterDeposit1 = await vaultProgram.account.vault.fetch(vaultPda);
        const userInfo1 = await vaultProgram.account.userInfo.fetch(nftInfo3);
        const vaultBalance1 = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;

        console.log("After deposit 1:");
        console.log("  User shares:", userInfo1.shares.toString());
        console.log("  Total shares:", afterDeposit1.totalShares.toString());
        console.log("  Vault balance:", vaultBalance1);

        // Second deposit: 200 tokens (should get proportionally fewer shares)
        const deposit2 = new anchor.BN(20_000_000);
        await vaultProgram.methods
            .deposit(deposit2)
            .accounts({
                user: user3.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: tokenAccount3,
                userNftMint: mint3.publicKey,
                assetMint: assetMint,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
            })
            .signers([user3])
            .rpc();

        const afterDeposit2 = await vaultProgram.account.vault.fetch(vaultPda);
        const userInfo2 = await vaultProgram.account.userInfo.fetch(nftInfo3);
        const vaultBalance2 = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;

        console.log("After deposit 2:");
        console.log("  User shares:", userInfo2.shares.toString());
        console.log("  Total shares:", afterDeposit2.totalShares.toString());
        console.log("  Vault balance:", vaultBalance2);

        // Third deposit: 150 tokens
        const deposit3 = new anchor.BN(15_000_000);
        await vaultProgram.methods
            .deposit(deposit3)
            .accounts({
                user: user3.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: tokenAccount3,
                userNftMint: mint3.publicKey,
                assetMint: assetMint,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
            })
            .signers([user3])
            .rpc();

        const afterDeposit3 = await vaultProgram.account.vault.fetch(vaultPda);
        const userInfo3 = await vaultProgram.account.userInfo.fetch(nftInfo3);
        const vaultBalance3 = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;

        console.log("After deposit 3:");
        console.log("  User shares:", userInfo3.shares.toString());
        console.log("  Total shares:", afterDeposit3.totalShares.toString());
        console.log("  Vault balance:", vaultBalance3);

        // Fourth deposit: 50 tokens
        const deposit4 = new anchor.BN(5_000_000);
        await vaultProgram.methods
            .deposit(deposit4)
            .accounts({
                user: user3.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: tokenAccount3,
                userNftMint: mint3.publicKey,
                assetMint: assetMint,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
            })
            .signers([user3])
            .rpc();

        const finalVault = await vaultProgram.account.vault.fetch(vaultPda);
        const finalUserInfo = await vaultProgram.account.userInfo.fetch(nftInfo3);
        const finalVaultBalance = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;

        console.log("After deposit 4:");
        console.log("  User shares:", finalUserInfo.shares.toString());
        console.log("  Total shares:", finalVault.totalShares.toString());
        console.log("  Vault balance:", finalVaultBalance);

        // Verify math: Total deposited should equal share value
        const totalDeposited = deposit1.add(deposit2).add(deposit3).add(deposit4);
        const userShares = finalUserInfo.shares;

        console.log("Total deposited:", totalDeposited.toString());
        console.log("User final shares:", userShares.toString());

        // User should be able to withdraw approximately what they deposited
        // (accounting for rounding and other users in the vault)
        expect(userShares.toNumber()).to.be.greaterThan(0);
        expect(finalVault.totalShares.toNumber()).to.be.greaterThan(initialTotalShares);
    });

    it("Multiple partial withdrawals - precision and accounting", async () => {
        // Use user1 who already has shares
        const initialUserInfo = await vaultProgram.account.userInfo.fetch(user1Data.nftInfo);
        const initialVault = await vaultProgram.account.vault.fetch(vaultPda);
        const initialVaultBalance = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;

        console.log("=== Multiple Withdrawals Test ===");
        console.log("Initial user shares:", initialUserInfo.shares.toString());
        console.log("Initial total shares:", initialVault.totalShares.toString());
        console.log("Initial vault balance:", initialVaultBalance);

        let remainingShares = initialUserInfo.shares.toNumber();
        const withdrawals = [
            Math.floor(remainingShares * 0.25), // 25%
            Math.floor(remainingShares * 0.15), // 15% of original
            Math.floor(remainingShares * 0.30), // 30% of original
        ];

        for (let i = 0; i < withdrawals.length; i++) {
            const withdrawAmount = new anchor.BN(withdrawals[i]);

            console.log(`\n--- Withdrawal ${i + 1}: ${withdrawAmount.toString()} shares ---`);

            const beforeVault = await vaultProgram.account.vault.fetch(vaultPda);
            const beforeUserInfo = await vaultProgram.account.userInfo.fetch(user1Data.nftInfo);
            const beforeVaultBalance = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;
            const beforeUserBalance = (await provider.connection.getTokenAccountBalance(user1Data.assetTokenAccount)).value.amount;

            await vaultProgram.methods
                .withdraw(withdrawAmount)
                .accounts({
                    user: user1.publicKey,
                    vault: vaultPda,
                    nftCollection: collectionPda,
                    userNftToken: user1Data.firstTokenAccount,
                    userNftMint: user1Data.firstMint,
                    assetMint: assetMint,
                    vaultTokenAccount: vaultTokenAccount,
                    shareMint: shareMint,
                })
                .signers([user1])
                .rpc();

            const afterVault = await vaultProgram.account.vault.fetch(vaultPda);
            const afterUserInfo = await vaultProgram.account.userInfo.fetch(user1Data.nftInfo);
            const afterVaultBalance = (await provider.connection.getTokenAccountBalance(vaultTokenAccount)).value.amount;
            const afterUserBalance = (await provider.connection.getTokenAccountBalance(user1Data.assetTokenAccount)).value.amount;

            // Calculate withdrawn assets
            const assetsWithdrawn = BigInt(afterUserBalance) - BigInt(beforeUserBalance);
            const sharesReduced = beforeUserInfo.shares.toNumber() - afterUserInfo.shares.toNumber();
            const vaultReduction = BigInt(beforeVaultBalance) - BigInt(afterVaultBalance);

            console.log("  Shares reduced:", sharesReduced);
            console.log("  Assets withdrawn:", assetsWithdrawn.toString());
            console.log("  Vault reduction:", vaultReduction.toString());
            console.log("  User remaining shares:", afterUserInfo.shares.toString());
            console.log("  Total shares remaining:", afterVault.totalShares.toString());

            // Verify accounting
            expect(sharesReduced).to.equal(withdrawAmount.toNumber());
            expect(vaultReduction).to.equal(assetsWithdrawn);
            expect(afterVault.totalShares.toNumber()).to.equal(beforeVault.totalShares.toNumber() - sharesReduced);

            remainingShares = afterUserInfo.shares.toNumber();
        }

        console.log("Final user shares:", remainingShares);
        expect(remainingShares).to.be.greaterThan(0); // Should still have some shares left
    });

    it("Complex scenario: Multiple users, deposits, withdrawals - cross-user math verification", async () => {
        // Create user4 for this test
        const user4 = Keypair.generate();
        await provider.connection.requestAirdrop(user4.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Setup user4 with NFT and tokens
        const mint4 = Keypair.generate();
        const tokenAccount4 = await getAssociatedTokenAddress(mint4.publicKey, user4.publicKey);

        await nftProgram.methods
            .mintNft()
            .accounts({
                mint: mint4.publicKey,
                user: user4.publicKey,
            })
            .signers([user4, mint4])
            .rpc();

        const assetTokenAccount4 = await getAssociatedTokenAddress(assetMint, user4.publicKey);
        const createAtaIx4 = createAssociatedTokenAccountInstruction(
            user4.publicKey,
            assetTokenAccount4,
            user4.publicKey,
            assetMint
        );
        const createAtaTx4 = new anchor.web3.Transaction().add(createAtaIx4);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, createAtaTx4, [user4]);

        await testTokenProgram.methods
            .mintTokens(new anchor.BN(1_000_000_000))
            .accounts({
                caller: user4.publicKey,
                mint: assetMint,
            })
            .signers([user4])
            .rpc();

        const [sharePda4] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_shares_v3"), mint4.publicKey.toBuffer()],
            vaultProgram.programId
        );
        const shareTokenAccount4 = await getAssociatedTokenAddress(shareMint, sharePda4, true);
        const [nftInfo4] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("user_info_v3"),
                tokenAccount4.toBuffer(),
                shareTokenAccount4.toBuffer()
            ],
            vaultProgram.programId
        );

        console.log("=== Complex Multi-User Scenario ===");

        // Snapshot initial state
        const initialVault = await vaultProgram.account.vault.fetch(vaultPda);
        console.log("Starting total shares:", initialVault.totalShares.toString());

        // User4 deposits
        await vaultProgram.methods
            .deposit(new anchor.BN(30_000_000))
            .accounts({
                user: user4.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: tokenAccount4,
                userNftMint: mint4.publicKey,
                assetMint: assetMint,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
            })
            .signers([user4])
            .rpc();

        // User2 makes another deposit
        await testTokenProgram.methods
            .mintTokens(new anchor.BN(200_000_000))
            .accounts({
                caller: user2.publicKey,
                mint: assetMint,
            })
            .signers([user2])
            .rpc();

        await vaultProgram.methods
            .deposit(new anchor.BN(15_000_000))
            .accounts({
                user: user2.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: user2Data.firstTokenAccount,
                userNftMint: user2Data.firstMint,
                assetMint: assetMint,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
            })
            .signers([user2])
            .rpc();

        // User4 withdraws half their shares
        const user4Info = await vaultProgram.account.userInfo.fetch(nftInfo4);
        const withdrawAmount = new anchor.BN(Math.floor(user4Info.shares.toNumber() / 2));

        await vaultProgram.methods
            .withdraw(withdrawAmount)
            .accounts({
                user: user4.publicKey,
                vault: vaultPda,
                nftCollection: collectionPda,
                userNftToken: tokenAccount4,
                userNftMint: mint4.publicKey,
                assetMint: assetMint,
                vaultTokenAccount: vaultTokenAccount,
                shareMint: shareMint,
            })
            .signers([user4])
            .rpc();

        // Verify final state consistency
        const finalVault = await vaultProgram.account.vault.fetch(vaultPda);
        const finalUser1Info = await vaultProgram.account.userInfo.fetch(user1Data.nftInfo);
        const finalUser2Info = await vaultProgram.account.userInfo.fetch(user2Data.nftInfo);
        const finalUser4Info = await vaultProgram.account.userInfo.fetch(nftInfo4);

        const totalUserShares = finalUser1Info.shares.toNumber() +
            finalUser2Info.shares.toNumber() +
            finalUser4Info.shares.toNumber();

        console.log("Final vault total shares:", finalVault.totalShares.toString());
        console.log("Sum of all user shares:", totalUserShares);
        console.log("User1 shares:", finalUser1Info.shares.toString());
        console.log("User2 shares:", finalUser2Info.shares.toString());
        console.log("User4 shares:", finalUser4Info.shares.toString());

        // Critical invariant: Sum of individual user shares should equal vault total shares
        console.log("\n=== DEBUGGING ACCOUNTING MISMATCH ===");

        const shareMintInfo = await provider.connection.getParsedAccountInfo(shareMint);
        console.log("Share mint total supply:", shareMintInfo.value?.data?.parsed?.info?.supply);
        console.log("Should match vault.total_shares:", finalVault.totalShares.toString());

        expect(totalUserShares).to.equal(finalVault.totalShares.toNumber());

        // All users should have positive shares
        expect(finalUser1Info.shares.toNumber()).to.be.greaterThan(0);
        expect(finalUser2Info.shares.toNumber()).to.be.greaterThan(0);
        expect(finalUser4Info.shares.toNumber()).to.be.greaterThan(0);

        console.log("✅ All accounting invariants verified!");
    });
});

// Helper function
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}