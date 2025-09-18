"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var anchor = require("@coral-xyz/anchor");
var web3_js_1 = require("@solana/web3.js");
var simple_vault_json_1 = require("../target/idl/simple_vault.json");
function main() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    return __awaiter(this, void 0, void 0, function () {
        var provider, DEPLOYED_PROGRAM_ID, SCRIPT_PROGRAM_ID, VAULT_PDA, accountInfo, deployedProgram, vaultData, err_1, scriptProgram, vaultData, err_2, first50Bytes, discriminator, idl, vaultAccount, expectedSize, error_1;
        return __generator(this, function (_l) {
            switch (_l.label) {
                case 0:
                    console.log("🔍 Fetching and Debugging Vault Account...\n");
                    provider = anchor.AnchorProvider.env();
                    anchor.setProvider(provider);
                    DEPLOYED_PROGRAM_ID = new web3_js_1.PublicKey("6szSVnHy2GrCi6y7aQxJfQG9WpVkTgdB6kDXixepvdoW");
                    SCRIPT_PROGRAM_ID = new web3_js_1.PublicKey("B2iJWvv6hwMvVkdKm1ovTzSr52neJU9k8AQyQHVBtFRM");
                    console.log("📋 Program ID Investigation:");
                    console.log("From transaction logs:", DEPLOYED_PROGRAM_ID.toBase58());
                    console.log("From your script:   ", SCRIPT_PROGRAM_ID.toBase58());
                    console.log("Programs match:", DEPLOYED_PROGRAM_ID.equals(SCRIPT_PROGRAM_ID) ? "✅ YES" : "❌ NO");
                    VAULT_PDA = new web3_js_1.PublicKey("J9CqYMdTx7E2g3MzPkbpLcXULNYMo93fbPqC6k1vvZhS");
                    _l.label = 1;
                case 1:
                    _l.trys.push([1, 11, , 12]);
                    // ================================
                    // STEP 1: Raw Account Info
                    // ================================
                    console.log("\n🔍 STEP 1: Raw account inspection...");
                    return [4 /*yield*/, provider.connection.getAccountInfo(VAULT_PDA)];
                case 2:
                    accountInfo = _l.sent();
                    if (!accountInfo) {
                        console.log("❌ Account does not exist!");
                        return [2 /*return*/];
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
                    _l.label = 3;
                case 3:
                    _l.trys.push([3, 5, , 6]);
                    deployedProgram = new anchor.Program(simple_vault_json_1["default"], provider);
                    // Override the program ID to point to deployed version
                    Object.defineProperty(deployedProgram, 'programId', {
                        value: DEPLOYED_PROGRAM_ID,
                        writable: false
                    });
                    return [4 /*yield*/, deployedProgram.account.vault.fetch(VAULT_PDA)];
                case 4:
                    vaultData = _l.sent();
                    console.log("✅ SUCCESS with DEPLOYED program ID!");
                    console.log("📊 Vault Data:");
                    console.log("  Owner:", vaultData.owner.toBase58());
                    console.log("  Asset Mint:", vaultData.assetMint.toBase58());
                    console.log("  Share Mint:", vaultData.shareMint.toBase58());
                    console.log("  NFT Collection:", vaultData.nftCollectionAddress.toBase58());
                    console.log("  Total Borrowed:", ((_a = vaultData.totalBorrowed) === null || _a === void 0 ? void 0 : _a.toString()) || "0");
                    console.log("  Borrow Index:", ((_b = vaultData.borrowIndex) === null || _b === void 0 ? void 0 : _b.toString()) || "0");
                    console.log("  Borrow Rate:", ((_c = vaultData.borrowRate) === null || _c === void 0 ? void 0 : _c.toString()) || "0");
                    console.log("  Last Update:", ((_d = vaultData.lastUpdateTime) === null || _d === void 0 ? void 0 : _d.toString()) || "0");
                    console.log("  Reserve Factor:", ((_e = vaultData.reserveFactor) === null || _e === void 0 ? void 0 : _e.toString()) || "0");
                    console.log("  Total Reserves:", ((_f = vaultData.totalReserves) === null || _f === void 0 ? void 0 : _f.toString()) || "0");
                    console.log("  Total Shares:", ((_g = vaultData.totalShares) === null || _g === void 0 ? void 0 : _g.toString()) || "0");
                    console.log("  Bump:", vaultData.bump);
                    console.log("\n✅ DEPLOYED program ID can deserialize the vault successfully!");
                    return [3 /*break*/, 6];
                case 5:
                    err_1 = _l.sent();
                    console.log("❌ FAILED with DEPLOYED program ID:", err_1.message);
                    return [3 /*break*/, 6];
                case 6:
                    // ================================
                    // STEP 3: Try with SCRIPT Program ID
                    // ================================
                    console.log("\n🔍 STEP 3: Attempting to deserialize with SCRIPT program ID...");
                    _l.label = 7;
                case 7:
                    _l.trys.push([7, 9, , 10]);
                    scriptProgram = new anchor.Program(simple_vault_json_1["default"], provider);
                    // Override the program ID to point to deployed version
                    Object.defineProperty(scriptProgram, 'programId', {
                        value: SCRIPT_PROGRAM_ID,
                        writable: false
                    });
                    return [4 /*yield*/, scriptProgram.account.vault.fetch(VAULT_PDA)];
                case 8:
                    vaultData = _l.sent();
                    console.log("✅ SUCCESS with SCRIPT program ID!");
                    console.log("📊 Vault Data:");
                    console.log("  Owner:", vaultData.owner.toBase58());
                    console.log("  Asset Mint:", vaultData.assetMint.toBase58());
                    console.log("  Share Mint:", vaultData.shareMint.toBase58());
                    console.log("  NFT Collection:", vaultData.nftCollectionAddress.toBase58());
                    console.log("  Total Borrowed:", ((_h = vaultData.totalBorrowed) === null || _h === void 0 ? void 0 : _h.toString()) || "0");
                    console.log("  Total Shares:", ((_j = vaultData.totalShares) === null || _j === void 0 ? void 0 : _j.toString()) || "0");
                    console.log("  Bump:", vaultData.bump);
                    console.log("\n✅ SCRIPT program ID can deserialize the vault successfully!");
                    return [3 /*break*/, 10];
                case 9:
                    err_2 = _l.sent();
                    console.log("❌ FAILED with SCRIPT program ID:", err_2.message);
                    return [3 /*break*/, 10];
                case 10:
                    // ================================
                    // STEP 4: Raw Data Inspection
                    // ================================
                    console.log("\n🔍 STEP 4: Raw data inspection...");
                    console.log("📊 First 50 bytes of account data:");
                    first50Bytes = accountInfo.data.slice(0, 50);
                    console.log("  Hex:", first50Bytes.toString('hex'));
                    console.log("  Bytes:", Array.from(first50Bytes));
                    discriminator = accountInfo.data.slice(0, 8);
                    console.log("📊 Account Discriminator:");
                    console.log("  Hex:", discriminator.toString('hex'));
                    console.log("  Bytes:", Array.from(discriminator));
                    // ================================
                    // STEP 5: IDL Structure Analysis
                    // ================================
                    console.log("\n🔍 STEP 5: IDL structure analysis...");
                    idl = anchor.workspace.SimpleVault.idl;
                    vaultAccount = (_k = idl.accounts) === null || _k === void 0 ? void 0 : _k.find(function (acc) { return acc.name === 'Vault'; });
                    if (vaultAccount) {
                        console.log("📊 IDL Vault Account Structure:");
                        console.log("  Name:", vaultAccount.name);
                        console.log("  Fields:");
                        if ('type' in vaultAccount && 'fields' in vaultAccount.type) {
                            vaultAccount.type.fields.forEach(function (field, index) {
                                console.log("    " + (index + 1) + ". " + field.name + ": " + JSON.stringify(field.type));
                            });
                        }
                    }
                    // ================================
                    // STEP 6: Size Calculation
                    // ================================
                    console.log("\n🔍 STEP 6: Expected size calculation...");
                    expectedSize = 8 + // discriminator
                        32 + // owner
                        32 + // asset_mint
                        32 + // share_mint
                        32 + // nft_collection_address
                        8 + // total_borrowed
                        8 + // borrow_index
                        8 + // borrow_rate
                        8 + // last_update_time
                        8 + // reserve_factor
                        8 + // total_reserves
                        8 + // total_shares
                        1;
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
                    }
                    else if (accountInfo.owner.equals(SCRIPT_PROGRAM_ID)) {
                        console.log("✅ The vault account is owned by the SCRIPT program ID");
                        console.log("💡 Your hook should use:", SCRIPT_PROGRAM_ID.toBase58());
                    }
                    else {
                        console.log("❌ The vault account is owned by an unknown program!");
                        console.log("🔍 Owner:", accountInfo.owner.toBase58());
                    }
                    if (expectedSize === accountInfo.data.length) {
                        console.log("✅ Account size matches expected Rust struct");
                        console.log("💡 The issue is likely the wrong program ID in your TypeScript");
                    }
                    else {
                        console.log("❌ Account size does NOT match expected Rust struct");
                        console.log("💡 The Rust struct and IDL may be out of sync");
                    }
                    return [3 /*break*/, 12];
                case 11:
                    error_1 = _l.sent();
                    console.error("\n❌ Error during diagnosis:", error_1);
                    if (error_1 instanceof Error) {
                        console.error("Error details:", error_1.message);
                    }
                    return [3 /*break*/, 12];
                case 12: return [2 /*return*/];
            }
        });
    });
}
if (require.main === module) {
    main()
        .then(function () {
        console.log("\n✅ Vault diagnosis completed!");
        process.exit(0);
    })["catch"](function (error) {
        console.error("\n❌ Diagnosis failed:", error);
        process.exit(1);
    });
}
