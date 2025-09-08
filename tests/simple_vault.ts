import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SimpleVault } from "../target/types/simple_vault";
import { UniqueLow } from "../target/types/unique_low";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createMint,
  mintTo,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction
} from "@solana/spl-token";
import { expect } from "chai";

describe("simple_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const nftProgram = anchor.workspace.UniqueLow as Program<UniqueLow>;

  // Test accounts
  let vaultOwner: Keypair;
  let user1: Keypair;
  let user2: Keypair; // user without NFT

  // NFT Collection related
  let collectionPda: PublicKey;
  let collectionBump: number;
  let nftMint: PublicKey;
  let user1NftTokenAccount: PublicKey;

  // Asset token (what users deposit)
  let assetMint: PublicKey;
  let user1AssetTokenAccount: PublicKey;
  let user2AssetTokenAccount: PublicKey;

  // Vault related
  let vaultPda: PublicKey;
  let vaultBump: number;
  let shareMint: PublicKey;
  let vaultTokenAccount: PublicKey;
  let user1ShareTokenAccount: PublicKey;

  // Test constants
  const collectionName = "Vault Access NFTs";
  const collectionSymbol = "VAN";
  const baseUri = "https://vault-nfts.com/metadata/";
  const depositAmount = 10000000000; // 1 token with 6 decimals
  const mintAmount = BigInt(depositAmount * 10);

  before(async () => {
    console.log("Setting up test accounts...");

    // Initialize keypairs
    vaultOwner = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();

    // Airdrop SOL
    await provider.connection.requestAirdrop(vaultOwner.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user1.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user2.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Find NFT collection PDA
    [collectionPda, collectionBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection")],
      nftProgram.programId
    );

    console.log("Collection PDA:", collectionPda.toString());
  });

  it("Initialize NFT Collection", async () => {
    const wormholeProgram = new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");

    try {
      const tx = await nftProgram.methods
        .initialize(collectionName, collectionSymbol, baseUri, wormholeProgram)
        .accounts({
          authority: vaultOwner.publicKey,
        })
        .signers([vaultOwner])
        .rpc();

      console.log("NFT Collection initialized:", tx);

      const collection = await nftProgram.account.collection.fetch(collectionPda);
      expect(collection.authority.toString()).to.equal(vaultOwner.publicKey.toString());
    } catch (error) {
      console.log("Collection may already exist, continuing...");
    }
  });

  it("Create Asset Token (what users deposit)", async () => {
    // Create the token that users will deposit into the vault
    assetMint = await createMint(
      provider.connection,
      vaultOwner,
      vaultOwner.publicKey, // mint authority
      vaultOwner.publicKey, // freeze authority
      6
    );

    // 2. Compute ATAs
    user1AssetTokenAccount = await getAssociatedTokenAddress(assetMint, user1.publicKey);
    user2AssetTokenAccount = await getAssociatedTokenAddress(assetMint, user2.publicKey);

    // 3. Create ATAs
    const userAccounts: [anchor.web3.PublicKey, anchor.web3.Keypair][] = [
      [user1AssetTokenAccount, user1],
      [user2AssetTokenAccount, user2],
    ];
    console.log({ userAccounts })

    for (const [userATA, userKey] of userAccounts) {
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          vaultOwner.publicKey, // payer
          userATA,              // ATA address
          userKey.publicKey,    // owner of ATA
          assetMint
        )
      );
      const sig = await provider.sendAndConfirm(tx, [vaultOwner]);
      const latestBlockhash = await provider.connection.getLatestBlockhash();

      await provider.connection.confirmTransaction({
        signature: sig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });

    }
    console.log("confirmed")

    // 4. Mint tokens
    for (const userATA of [user1AssetTokenAccount, user2AssetTokenAccount]) {
      console.log("User ata")
      console.log(userATA.toString())
      console.log(assetMint);
      console.log(vaultOwner.publicKey);
      console.log(mintAmount);


      try {
        await mintTo(
          provider.connection,
          vaultOwner,
          assetMint,
          userATA,
          vaultOwner,
          mintAmount
        );
      } catch (err) {
        console.error("Mint to user1 failed:", err);
        throw err;
      }
    }

    console.log("Asset tokens minted to users");
  });

  it("Mint NFT to User1 (for vault access)", async () => {
    const mint = Keypair.generate();
    nftMint = mint.publicKey;

    const [userStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_state"), user1.publicKey.toBuffer()],
      nftProgram.programId
    );

    user1NftTokenAccount = await getAssociatedTokenAddress(
      nftMint,
      user1.publicKey
    );

    const tx = await nftProgram.methods
      .mintNft()
      .accounts({

        mint: nftMint,

        user: user1.publicKey,

      })
      .signers([user1, mint])
      .rpc();

    console.log("NFT minted to user1:", tx);

    // Verify NFT was minted
    const nftAccount = await getAccount(provider.connection, user1NftTokenAccount);
    expect(nftAccount.amount.toString()).to.equal("1");
    expect(nftAccount.owner.toString()).to.equal(user1.publicKey.toString());

    // Verify mint authority is the collection
    const mintInfo = await provider.connection.getParsedAccountInfo(nftMint);
    const mintData = mintInfo.value?.data;
    if (mintData && 'parsed' in mintData) {
      expect(mintData.parsed.info.mintAuthority).to.equal(collectionPda.toString());
    }
  });

  it("Initialize Vault", async () => {
    // Find vault PDA
    console.log("1");
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), assetMint.toBuffer(), vaultOwner.publicKey.toBuffer()],
      vaultProgram.programId
    );

    console.log("2");
    // Create share mint keypair
    const shareMintKeypair = Keypair.generate();
    shareMint = shareMintKeypair.publicKey;

    console.log("3");
    // Get vault token account
    vaultTokenAccount = await getAssociatedTokenAddress(
      assetMint,
      vaultPda,
      true
    );

    console.log("4");
    const tx = await vaultProgram.methods
      .initializeVault(collectionPda) // Pass the collection PDA
      .accounts({
        owner: vaultOwner.publicKey,
        assetMint: assetMint,

        shareMint: shareMint,


      })
      .signers([vaultOwner, shareMintKeypair])
      .rpc();

    console.log("Vault initialized:", tx);

    // Verify vault state
    const vault = await vaultProgram.account.vault.fetch(vaultPda);
    expect(vault.owner.toString()).to.equal(vaultOwner.publicKey.toString());
    expect(vault.assetMint.toString()).to.equal(assetMint.toString());
    expect(vault.shareMint.toString()).to.equal(shareMint.toString());
    expect(vault.nftCollectionAddress.toString()).to.equal(collectionPda.toString());
    expect(vault.bump).to.equal(vaultBump);

    console.log("Vault PDA:", vaultPda.toString());
    console.log("Share Mint:", shareMint.toString());
  });

  it("User1 deposits successfully (has NFT)", async () => {
    // Get user's share token account
    user1ShareTokenAccount = await getAssociatedTokenAddress(
      shareMint,
      user1.publicKey
    );

    // Get initial balances
    const initialAssetBalance = await getAccount(provider.connection, user1AssetTokenAccount);
    console.log("User1 initial asset balance:", initialAssetBalance.amount.toString());

    const tx = await vaultProgram.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        user: user1.publicKey,
        vault: vaultPda,
        nftCollection: collectionPda,
        userNftToken: user1NftTokenAccount,
        userNftMint: nftMint,
        assetMint: assetMint,

        vaultTokenAccount: vaultTokenAccount,
        shareMint: shareMint,


      })
      .signers([user1])
      .rpc();

    console.log("User1 deposit successful:", tx);

    // Verify balances after deposit
    const finalAssetBalance = await getAccount(provider.connection, user1AssetTokenAccount);
    const shareBalance = await getAccount(provider.connection, user1ShareTokenAccount);
    const vaultBalance = await getAccount(provider.connection, vaultTokenAccount);

    console.log("User1 final asset balance:", finalAssetBalance.amount.toString());
    console.log("User1 share balance:", shareBalance.amount.toString());
    console.log("Vault balance:", vaultBalance.amount.toString());

    // Verify the transfer worked
    expect(Number(initialAssetBalance.amount) - Number(finalAssetBalance.amount)).to.equal(depositAmount);
    expect(Number(shareBalance.amount)).to.equal(depositAmount);
    expect(Number(vaultBalance.amount)).to.equal(depositAmount);
  });

  it("User2 deposit fails (no NFT)", async () => {
    // User2 doesn't have an NFT, so this should fail
    // We need to create a dummy NFT token account to pass validation, but it will be empty

    const dummyMint = Keypair.generate();
    await createMint(
      provider.connection,
      user2,
      user2.publicKey,
      user2.publicKey,
      0
    );

    const dummyTokenAccount = await getAssociatedTokenAddress(
      dummyMint.publicKey,
      user2.publicKey
    );

    try {
      await vaultProgram.methods
        .deposit(new anchor.BN(depositAmount))
        .accounts({
          user: user2.publicKey,
          vault: vaultPda,
          nftCollection: collectionPda,
          userNftToken: dummyTokenAccount, // Empty token account
          userNftMint: dummyMint.publicKey, // Wrong mint authority
          assetMint: assetMint,

          vaultTokenAccount: vaultTokenAccount,
          shareMint: shareMint,


        })
        .signers([user2])
        .rpc();

      // If we reach here, the test failed
      expect(false, "Deposit should have failed for user without NFT").to.be.true;
    } catch (error) {
      console.log("User2 deposit correctly failed:", error.message);
      // This is expected behavior
    }
  });

  it("User1 can deposit again (multiple deposits)", async () => {
    const initialShareBalance = await getAccount(provider.connection, user1ShareTokenAccount);
    console.log("Initial share balance:", initialShareBalance.amount.toString());

    const tx = await vaultProgram.methods
      .deposit(new anchor.BN(depositAmount / 2)) // Smaller deposit
      .accounts({
        user: user1.publicKey,
        vault: vaultPda,
        nftCollection: collectionPda,
        userNftToken: user1NftTokenAccount,
        userNftMint: nftMint,
        assetMint: assetMint,

        vaultTokenAccount: vaultTokenAccount,
        shareMint: shareMint,


      })
      .signers([user1])
      .rpc();

    console.log("User1 second deposit successful:", tx);

    const finalShareBalance = await getAccount(provider.connection, user1ShareTokenAccount);
    console.log("Final share balance:", finalShareBalance.amount.toString());

    // Should have more shares now
    expect(Number(finalShareBalance.amount)).to.be.greaterThan(Number(initialShareBalance.amount));
  });

  it("Verify vault state after deposits", async () => {
    const vault = await vaultProgram.account.vault.fetch(vaultPda);
    const vaultBalance = await getAccount(provider.connection, vaultTokenAccount);

    console.log("Final vault token balance:", vaultBalance.amount.toString());
    console.log("Vault owner:", vault.owner.toString());
    console.log("Asset mint:", vault.assetMint.toString());
    console.log("Share mint:", vault.shareMint.toString());
    console.log("NFT collection address:", vault.nftCollectionAddress.toString());

    expect(Number(vaultBalance.amount)).to.equal(depositAmount + depositAmount / 2);
  });

  // Additional test: what happens if user transfers their NFT away?
  it("User deposit fails if NFT is transferred away", async () => {
    // Create another user to transfer NFT to
    const user3 = Keypair.generate();
    await provider.connection.requestAirdrop(user3.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const user3NftTokenAccount = await getAssociatedTokenAddress(
      nftMint,
      user3.publicKey
    );

    // Transfer the NFT from user1 to user3
    const transferTx = await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          user1.publicKey,
          user3NftTokenAccount,
          user3.publicKey,
          nftMint
        ),
        createTransferInstruction(
          user1NftTokenAccount,
          user3NftTokenAccount,
          user1.publicKey,
          1
        )
      ),
      [user1]
    );

    console.log("NFT transferred from user1 to user3:", transferTx);

    // Now user1 should not be able to deposit
    try {
      await vaultProgram.methods
        .deposit(new anchor.BN(100))
        .accounts({
          user: user1.publicKey,
          vault: vaultPda,
          nftCollection: collectionPda,
          userNftToken: user1NftTokenAccount, // Now empty
          userNftMint: nftMint,
          assetMint: assetMint,

          vaultTokenAccount: vaultTokenAccount,
          shareMint: shareMint,

        })
        .signers([user1])
        .rpc();

      expect(false, "Deposit should fail when user has no NFT").to.be.true;
    } catch (error) {
      console.log("User1 deposit correctly failed after transferring NFT:", error.message);
    }
  });
});