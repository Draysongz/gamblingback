import { expect } from "chai";
import { Transaction, Keypair, PublicKey } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import brokecoinService from "../services/BrokecoinService.js";
import { supabase } from "../db/supabase.js";
import config from "../config/config.js";
import { TRANSACTION_STATUS } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

// WARNING: This test will use real tokens and balances on mainnet!
describe("BrokecoinService Mainnet", () => {
  let testUser;
  let testWallet;
  const TEST_BROKECOIN_AMOUNT = 1; // Use a small amount for safety
  const TEST_CHIPS_AMOUNT = TEST_BROKECOIN_AMOUNT * 100;
  const secretKeyArray = [
    214, 137, 128, 177, 115, 61, 146, 138, 218, 158, 180, 243, 26, 151, 89, 56,
    198, 174, 125, 36, 121, 218, 154, 227, 159, 195, 114, 198, 210, 37, 178, 57,
    219, 126, 170, 158, 175, 104, 39, 193, 98, 24, 15, 119, 100, 83, 82, 161,
    44, 125, 51, 90, 101, 132, 77, 202, 83, 105, 100, 100, 225, 113, 167, 236,
  ];
  const secretKey = new Uint8Array(secretKeyArray);

  before(async () => {
    // Create test user in database (if not exists)
    testWallet = Keypair.fromSecretKey(secretKey);
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", testWallet.publicKey.toString())
      .single();
    if (error) throw error;
    testUser = user;
    console.log(`Test wallet: ${testWallet.publicKey.toString()}`);
  });

  after(async () => {
    // Optionally clean up test data
    // await supabase.from("users").delete().eq("wallet_address", testWallet.publicKey.toString());
    // await supabase.from("transactions").delete().eq("wallet_address", testWallet.publicKey.toString());
  });

  describe("purchaseChips (mainnet)", () => {
    it("should successfully purchase chips with a real mainnet transaction", async () => {
      try {
        // Get token accounts
        const userTokenAccount = await getAssociatedTokenAddress(
          brokecoinService.tokenMint,
          testWallet.publicKey
        );
        const casinoTokenAccount = await getAssociatedTokenAddress(
          brokecoinService.tokenMint,
          brokecoinService.casinoWallet
        );

        // Create transfer instruction
        const transferInstruction = createTransferInstruction(
          userTokenAccount,
          casinoTokenAccount,
          testWallet.publicKey,
          BigInt(TEST_BROKECOIN_AMOUNT * Math.pow(10, 9))
        );

        // Create transaction
        const tx = new Transaction();
        tx.add(transferInstruction);

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } =
          await brokecoinService.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = testWallet.publicKey;

        // Sign transaction with the keypair
        tx.sign(testWallet);

        // Serialize the signed transaction
        const serializedTx = tx.serialize().toString("base64");

        // Purchase chips
        const result = await brokecoinService.purchaseChips(
          testWallet.publicKey.toString(),
          TEST_BROKECOIN_AMOUNT,
          serializedTx
        );

        // Verify result
        expect(result).to.have.property("transaction");
        expect(result.transaction.status).to.equal(
          TRANSACTION_STATUS.COMPLETED
        );
        expect(result.transaction.signature).to.exist;
        expect(result.chipsAmount).to.equal(TEST_CHIPS_AMOUNT);
        expect(result.brokecoinAmount).to.equal(TEST_BROKECOIN_AMOUNT);
        expect(result.newBalance).to.have.property("brokecoin_balance");
        expect(result.newBalance).to.have.property("chips_balance");
        console.log("Mainnet purchaseChips test passed.");
      } catch (error) {
        logger.error("Test failed:", error);
        throw error;
      }
    });
  });
});
