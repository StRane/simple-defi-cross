import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import {
    PublicKey,
    Keypair,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createMint,
    mintTo,
    getAssociatedTokenAddress,
    getAccount,
    createAssociatedTokenAccount,
    transfer
} from "@solana/spl-token";
import { assert, expect } from "chai";

describe("vault", () => {
    // Configure the client
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Vault as Program<Vault>;

    // Test wallets
    let authority: Keypair;
    let user1: Keypair;
    let user2: Keypair;
    let poolSigner: Keypair;

    // Mints
    let depositTokenMint: PublicKey;
    let nftMint1: PublicKey;
    let nftMint2: PublicKey;
    let nftMint3: PublicKey;

    // PDAs
    let vaultPda: PublicKey;
    let vaultBump: number;
    let vaultTokenAccount: PublicKey;

    // Token accounts
    let user1TokenAccount: PublicKey;
    let user2TokenAccount: PublicKey;
    let authorityTokenAccount: PublicKey;
    let nft1TokenAccount: PublicKey;
    let nft2TokenAccount: PublicKey;
    let nft3TokenAccount: PublicKey;

    // Constants for testing
    const RESERVE_FACTOR = new BN(1000);
    const DEPOSIT_AMOUNT = new BN(1000 * 10 ** 6);
    const BORROW_AMOUNT = new BN(100 * 10 ** 6);

    before(async () => {
        // Initialize test wallets
        authority = provider.wallet.payer;
        user1 = Keypair.generate();
        user2 = Keypair.generate();
        poolSigner = Keypair.generate();

        // Airdrop SOL to test users
        await provider.connection.requestAirdrop(
            user1.publicKey,
            2 * LAMPORTS_PER_SOL
        );
        await provider.connection.requestAirdrop(
            user2.publicKey,
            2 * LAMPORTS_PER_SOL
        );

        // Wait for airdrops to confirm
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create deposit token mint (e.g., USDC)
        depositTokenMint = await createMint(
            provider.connection,
            authority,
            authority.publicKey,
            null,
            6 // USDC decimals
        );

        // Create NFT mints
        nftMint1 = await createMint(
            provider.connection,
            authority,
            authority.publicKey,
            null,
            0
        );

        nftMint2 = await createMint(
            provider.connection,
            authority,
            authority.publicKey,
            null,
            0
        );

        nftMint3 = await createMint(
            provider.connection,
            authority,
            authority.publicKey,
            null,
            0
        );

        // Create token accounts
        user1TokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            authority,
            depositTokenMint,
            user1.publicKey
        );

        user2TokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            authority,
            depositTokenMint,
            user2.publicKey
        );

        authorityTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            authority,
            depositTokenMint,
            authority.publicKey
        );

        // Create NFT token accounts
        nft1TokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            authority,
            nftMint1,
            user1.publicKey
        );

        nft2TokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            authority,
            nftMint2,
            user1.publicKey
        );

        nft3TokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            authority,
            nftMint3,
            user2.publicKey
        );

        // Mint NFTs to users
        await mintTo(
            provider.connection,
            authority,
            nftMint1,
            nft1TokenAccount,
            authority,
            1
        );

        await mintTo(
            provider.connection,
            authority,
            nftMint2,
            nft2TokenAccount,
            authority,
            1
        );

        await mintTo(
            provider.connection,
            authority,
            nftMint3,
            nft3TokenAccount,
            authority,
            1
        );

        // Mint deposit tokens to users
        await mintTo(
            provider.connection,
            authority,
            depositTokenMint,
            user1TokenAccount,
            authority,
            10000 * 10 ** 6
        );

        await mintTo(
            provider.connection,
            authority,
            depositTokenMint,
            user2TokenAccount,
            authority,
            10000 * 10 ** 6
        );

        // Derive vault PDA
        [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), depositTokenMint.toBuffer()],
            program.programId
        );

        // Get vault token account
        vaultTokenAccount = await getAssociatedTokenAddress(
            depositTokenMint,
            vaultPda,
            true // allowOwnerOffCurve
        );
    });

    describe("Initialize Vault", () => {
        it("Successfully initializes the vault", async () => {
            const tx = await program.methods
                .initializeVault(RESERVE_FACTOR)
                .accounts({
                    authority: authority.publicKey,
                    mint: depositTokenMint,
                    pool: poolSigner.publicKey,
                })
                .rpc();

            console.log("Initialize vault tx:", tx);

            // Verify vault state
            const vault = await program.account.vault.fetch(vaultPda);
            assert.equal(vault.authority.toBase58(), authority.publicKey.toBase58());
            assert.equal(vault.mint.toBase58(), depositTokenMint.toBase58());
            assert.equal(vault.tokenAccount.toBase58(), vaultTokenAccount.toBase58());
            assert.equal(vault.pool.toBase58(), poolSigner.publicKey.toBase58());
            assert.equal(vault.totalShares.toNumber(), 0);
            assert.equal(vault.isPaused, false);
            assert.equal(vault.reserveFactor.toNumber(), RESERVE_FACTOR.toNumber());
        });
    });

    describe("Deposit with NFT", () => {
        let nftUserInfoPda: PublicKey;

        before(() => {
            // Derive NFT user info PDA
            [nftUserInfoPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("nft_user_info"),
                    vaultPda.toBuffer(),
                    nftMint1.toBuffer()
                ],
                program.programId
            );
        });

        it("Successfully deposits tokens using NFT as identifier", async () => {
            const balanceBefore = await provider.connection.getTokenAccountBalance(user1TokenAccount);

            const tx = await program.methods
                .depositWithNft(DEPOSIT_AMOUNT)
                .accountsPartial({
                    user: user1.publicKey,
                    vault: vaultPda,
                    nftMint: nftMint1,
                    nftTokenAccount: nft1TokenAccount,
                    nftUserInfo: nftUserInfoPda,
                    userTokenAccount: user1TokenAccount,
                    tokenAccount: vaultTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user1])
                .rpc();

            console.log("Deposit with NFT tx:", tx);

            // Verify NFT user info
            const nftUserInfo = await program.account.nftUserInfo.fetch(nftUserInfoPda);
            assert.equal(nftUserInfo.vault.toBase58(), vaultPda.toBase58());
            assert.equal(nftUserInfo.nftMint.toBase58(), nftMint1.toBase58());
            assert.equal(nftUserInfo.owner.toBase58(), user1.publicKey.toBase58());
            assert.equal(nftUserInfo.shares.toNumber(), DEPOSIT_AMOUNT.toNumber());
            assert.equal(nftUserInfo.depositedAmount.toNumber(), DEPOSIT_AMOUNT.toNumber());

            // Verify vault state updated
            const vault = await program.account.vault.fetch(vaultPda);
            assert.equal(vault.totalShares.toNumber(), DEPOSIT_AMOUNT.toNumber());

            // Verify tokens transferred
            const balanceAfter = await provider.connection.getTokenAccountBalance(user1TokenAccount);
            const transferred = balanceBefore.value.uiAmount - balanceAfter.value.uiAmount;
            assert.equal(transferred, DEPOSIT_AMOUNT.toNumber() / 10 ** 6);
        });

        it("Fails to deposit without NFT ownership", async () => {
            const [wrongNftUserInfoPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("nft_user_info"),
                    vaultPda.toBuffer(),
                    nftMint3.toBuffer()
                ],
                program.programId
            );

            try {
                await program.methods
                    .depositWithNft(DEPOSIT_AMOUNT)
                    .accountsPartial({
                        user: user1.publicKey,
                        vault: vaultPda,
                        nftMint: nftMint3,
                        nftTokenAccount: nft3TokenAccount,
                        nftUserInfo: wrongNftUserInfoPda,
                        userTokenAccount: user1TokenAccount,
                        tokenAccount: vaultTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([user1])
                    .rpc();

                assert.fail("Should have failed without NFT ownership");
            } catch (error) {
                assert.include(error.toString(), "ConstraintTokenOwner");
            }
        });

        it("Deposits more tokens to existing NFT position", async () => {
            const nftUserInfoBefore = await program.account.nftUserInfo.fetch(nftUserInfoPda);
            const sharesBefore = nftUserInfoBefore.shares.toNumber();

            const tx = await program.methods
                .depositWithNft(DEPOSIT_AMOUNT)
                .accountsPartial({
                    user: user1.publicKey,
                    vault: vaultPda,
                    nftMint: nftMint1,
                    nftTokenAccount: nft1TokenAccount,
                    nftUserInfo: nftUserInfoPda,
                    userTokenAccount: user1TokenAccount,
                    tokenAccount: vaultTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user1])
                .rpc();

            console.log("Second deposit tx:", tx);

            const nftUserInfoAfter = await program.account.nftUserInfo.fetch(nftUserInfoPda);
            const sharesAfter = nftUserInfoAfter.shares.toNumber();

            assert.isAbove(sharesAfter, sharesBefore);
            assert.equal(
                nftUserInfoAfter.depositedAmount.toNumber(),
                DEPOSIT_AMOUNT.toNumber() * 2
            );
        });
    });

    describe("Withdraw with NFT", () => {
        let nftUserInfoPda: PublicKey;

        before(() => {
            [nftUserInfoPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("nft_user_info"),
                    vaultPda.toBuffer(),
                    nftMint1.toBuffer()
                ],
                program.programId
            );
        });

        it("Successfully withdraws tokens using NFT", async () => {
            const nftUserInfo = await program.account.nftUserInfo.fetch(nftUserInfoPda);
            const sharesToWithdraw = new BN(nftUserInfo.shares.toNumber() / 2);

            const balanceBefore = await provider.connection.getTokenAccountBalance(user1TokenAccount);

            const tx = await program.methods
                .withdrawWithNft(sharesToWithdraw)
                .accountsPartial({
                    user: user1.publicKey,
                    vault: vaultPda,
                    nftMint: nftMint1,
                    nftTokenAccount: nft1TokenAccount,
                    nftUserInfo: nftUserInfoPda,
                    userTokenAccount: user1TokenAccount,
                    tokenAccount: vaultTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([user1])
                .rpc();

            console.log("Withdraw with NFT tx:", tx);

            // Verify shares decreased
            const nftUserInfoAfter = await program.account.nftUserInfo.fetch(nftUserInfoPda);
            assert.equal(
                nftUserInfoAfter.shares.toNumber(),
                nftUserInfo.shares.toNumber() - sharesToWithdraw.toNumber()
            );

            // Verify tokens received
            const balanceAfter = await provider.connection.getTokenAccountBalance(user1TokenAccount);
            assert.isAbove(balanceAfter.value.uiAmount, balanceBefore.value.uiAmount);
        });

        it("Fails to withdraw more shares than owned", async () => {
            const nftUserInfo = await program.account.nftUserInfo.fetch(nftUserInfoPda);
            const excessShares = new BN(nftUserInfo.shares.toNumber() + 1000);

            try {
                await program.methods
                    .withdrawWithNft(excessShares)
                    .accountsPartial({
                        user: user1.publicKey,
                        vault: vaultPda,
                        nftMint: nftMint1,
                        nftTokenAccount: nft1TokenAccount,
                        nftUserInfo: nftUserInfoPda,
                        userTokenAccount: user1TokenAccount,
                        tokenAccount: vaultTokenAccount,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([user1])
                    .rpc();

                assert.fail("Should have failed with insufficient shares");
            } catch (error) {
                assert.include(error.toString(), "InsufficientShares");
            }
        });
    });
});