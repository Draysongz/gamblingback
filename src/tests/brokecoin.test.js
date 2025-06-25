import { expect } from "chai";
import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import { createTransferInstruction } from "@solana/spl-token";
import brokecoinService from "../services/BrokecoinService.js";
import { supabase } from "../db/supabase.js";
import config from "../config/config.js";
import { TRANSACTION_STATUS, ERROR_MESSAGES } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

describe("BrokecoinService", () => {
  let testUser;
  let testWallet;
  const TEST_BROKECOIN_AMOUNT = 10;
  const TEST_CHIPS_AMOUNT = TEST_BROKECOIN_AMOUNT * 100;

  before(async () => {
    // Create test user in database
    testWallet = Keypair.generate();
    const { data: user, error } = await supabase
      .from("users")
      .insert([
        {
          wallet_address: testWallet.publicKey.toString(),
          brokecoin_balance: 1000, // Give user some initial balance
          chips_balance: 0,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    testUser = user;
  });

  after(async () => {
    // Cleanup test data
    await supabase
      .from("users")
      .delete()
      .eq("wallet_address", testWallet.publicKey.toString());

    await supabase
      .from("transactions")
      .delete()
      .eq("wallet_address", testWallet.publicKey.toString());
  });

  describe("purchaseChips", () => {
    it("should successfully purchase chips with valid transaction", async () => {
      // Create and sign a valid transaction
      const userTokenAccount = await brokecoinService.getAssociatedTokenAddress(
        brokecoinService.tokenMint,
        testWallet.publicKey
      );

      const casinoTokenAccount =
        await brokecoinService.getAssociatedTokenAddress(
          brokecoinService.tokenMint,
          brokecoinService.casinoWallet
        );

      const transferInstruction = createTransferInstruction(
        userTokenAccount,
        casinoTokenAccount,
        testWallet.publicKey,
        BigInt(TEST_BROKECOIN_AMOUNT * Math.pow(10, 9))
      );

      const tx = new Transaction().add(transferInstruction);
      const { blockhash } =
        await brokecoinService.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = testWallet.publicKey;

      // Sign transaction
      tx.sign(testWallet);
      const signedTx = tx.serialize().toString("base64");

      // Purchase chips
      const result = await brokecoinService.purchaseChips(
        testWallet.publicKey.toString(),
        TEST_BROKECOIN_AMOUNT,
        signedTx
      );

      // Verify result
      expect(result).to.have.property("transaction");
      expect(result.transaction.status).to.equal(TRANSACTION_STATUS.COMPLETED);
      expect(result.transaction.signature).to.exist;
      expect(result.chipsAmount).to.equal(TEST_CHIPS_AMOUNT);
      expect(result.brokecoinAmount).to.equal(TEST_BROKECOIN_AMOUNT);
      expect(result.newBalance).to.have.property("brokecoin_balance");
      expect(result.newBalance).to.have.property("chips_balance");
    });

    it("should fail with insufficient balance", async () => {
      const largeAmount = 1000000; // Amount larger than user's balance

      try {
        await brokecoinService.purchaseChips(
          testWallet.publicKey.toString(),
          largeAmount,
          "dummy-signed-tx"
        );
        expect.fail("Should have thrown insufficient balance error");
      } catch (error) {
        expect(error.message).to.include("Insufficient brokecoin balance");
      }
    });

    it("should fail with invalid wallet address", async () => {
      try {
        await brokecoinService.purchaseChips(
          "invalid-address",
          TEST_BROKECOIN_AMOUNT,
          "dummy-signed-tx"
        );
        expect.fail("Should have thrown invalid address error");
      } catch (error) {
        expect(error.message).to.include("Invalid address");
      }
    });

    it("should fail with invalid amount", async () => {
      try {
        await brokecoinService.purchaseChips(
          testWallet.publicKey.toString(),
          -10,
          "dummy-signed-tx"
        );
        expect.fail("Should have thrown invalid amount error");
      } catch (error) {
        expect(error.message).to.include("Invalid brokecoin amount");
      }
    });

    it("should fail with missing signed transaction", async () => {
      try {
        await brokecoinService.purchaseChips(
          testWallet.publicKey.toString(),
          TEST_BROKECOIN_AMOUNT
        );
        expect.fail("Should have thrown missing transaction error");
      } catch (error) {
        expect(error.message).to.include("Signed transaction is required");
      }
    });

    it("should fail with invalid transaction", async () => {
      try {
        await brokecoinService.purchaseChips(
          testWallet.publicKey.toString(),
          TEST_BROKECOIN_AMOUNT,
          "invalid-base64-string"
        );
        expect.fail("Should have thrown invalid transaction error");
      } catch (error) {
        expect(error.message).to.include("Failed to parse transaction");
      }
    });
  });

  describe("getBalance", () => {
    it("should return correct balance", async () => {
      const balance = await brokecoinService.getBalance(
        testWallet.publicKey.toString()
      );
      expect(balance).to.have.property("brokecoin");
      expect(balance).to.have.property("chips");
    });

    it("should fail with invalid wallet address", async () => {
      try {
        await brokecoinService.getBalance("invalid-address");
        expect.fail("Should have thrown invalid address error");
      } catch (error) {
        expect(error.message).to.include("Invalid address");
      }
    });
  });

  describe("getTransactionHistory", () => {
    it("should return transaction history", async () => {
      const history = await brokecoinService.getTransactionHistory(
        testWallet.publicKey.toString()
      );
      expect(history).to.be.an("array");
    });

    it("should respect limit and offset", async () => {
      const limit = 5;
      const offset = 0;
      const history = await brokecoinService.getTransactionHistory(
        testWallet.publicKey.toString(),
        { limit, offset }
      );
      expect(history.length).to.be.at.most(limit);
    });

    it("should filter by transaction type", async () => {
      const type = "PURCHASE_CHIPS";
      const history = await brokecoinService.getTransactionHistory(
        testWallet.publicKey.toString(),
        { type }
      );
      expect(history.every((tx) => tx.type === type)).to.be.true;
    });
  });
});
