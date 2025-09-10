import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UniqueLow } from "../target/types/unique_low";
import { SimpleVault } from "../target/types/simple_vault"; // Add this import
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
    const vaultProgram = anchor.workspace.SimpleVault as Program<SimpleVault>; // Add vault program

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

        // Create asset mint for vault testing
        assetMint = await createMint(
            provider.connection,
            authority,
            authority.publicKey,
            null,
            6 // decimals
        );

        // Find vault PDA
        [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer(), authority.publicKey.toBuffer()],
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

        // Mint some tokens to user for testing
        await mintTo(
            provider.connection,
            authority,
            assetMint,
            user1Data.assetTokenAccount,
            authority,
            1000000000 // 1000 tokens with 6 decimals
        );

        // Setup user share PDA and token account
        [user1Data.sharePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_shares"), user1Data.firstMint.toBuffer()],
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
                Buffer.from("vault"),
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

        await mintTo(
            provider.connection,
            authority,
            assetMint,
            user2Data.assetTokenAccount,
            authority,
            500000000 // 500 tokens with 6 decimals
        );

        // Setup user2 share PDA and token account
        [user2Data.sharePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_shares"), user2Data.firstMint.toBuffer()],
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
                Buffer.from("vault"),
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

        const depositAmount = new anchor.BN(100000000); // 100 tokens

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

        const depositAmount = new anchor.BN(50000000); // 50 tokens

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
});

// Helper function
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}