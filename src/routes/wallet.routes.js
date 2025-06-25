import express from "express";
import BrokecoinService from "../services/BrokecoinService.js";
import { authenticate } from "../middleware/auth.js";
import validate, { walletSchemas } from "../middleware/validation.js";
import { logger } from "../utils/logger.js";
import {
  TRANSACTION_TYPES,
  CURRENCIES,
  SUCCESS_MESSAGES,
  ERROR_MESSAGES,
} from "../utils/constants.js";

const router = express.Router();

// Get wallet balance
router.get("/balance", authenticate, async (req, res) => {
  try {
    const { walletAddress } = req.query;
    console.log(`Getting balance for wallet: ${walletAddress}`);
    const balance = await BrokecoinService.getBalance(walletAddress);
    res.json({ balance });
  } catch (error) {
    logger.error(`Error getting wallet balance: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// Purchase chips with Brokecoin
router.post(
  "/purchase-chips",
  authenticate,
  validate(walletSchemas.purchaseChips),
  async (req, res) => {
    try {
      const { walletAddress } = req.user;
      const { brokecoinAmount } = req.body;

      console.log(
        `Purchasing chips with ${brokecoinAmount} ${CURRENCIES.BROKECOIN} for wallet: ${walletAddress}`
      );
      const result = await BrokecoinService.purchaseChips(
        walletAddress,
        brokecoinAmount
      );
      res.json({ ...result, message: SUCCESS_MESSAGES.CHIPS_PURCHASED });
    } catch (error) {
      logger.error(`Error purchasing chips: ${error.message}`);
      res
        .status(400)
        .json({ error: error.message || ERROR_MESSAGES.INSUFFICIENT_BALANCE });
    }
  }
);

// Cashout chips to Brokecoin
router.post(
  "/cashout-chips",
  authenticate,
  validate(walletSchemas.cashoutChips),
  async (req, res) => {
    try {
      const { walletAddress } = req.user;
      const { chipsAmount } = req.body;

      console.log(
        `Cashing out ${chipsAmount} ${CURRENCIES.CHIPS} to ${CURRENCIES.BROKECOIN} for wallet: ${walletAddress}`
      );
      const result = await BrokecoinService.cashoutChips(
        walletAddress,
        chipsAmount
      );
      res.json({ ...result, message: SUCCESS_MESSAGES.CHIPS_CASHED_OUT });
    } catch (error) {
      logger.error(`Error cashing out chips: ${error.message}`);
      res
        .status(400)
        .json({ error: error.message || ERROR_MESSAGES.INSUFFICIENT_BALANCE });
    }
  }
);

// Get transaction history
router.get("/transactions", authenticate, async (req, res) => {
  try {
    const { walletAddress } = req.query;
    console.log(`Getting transaction history for wallet: ${walletAddress}`);
    const transactions =
      await BrokecoinService.getTransactionHistory(walletAddress);
    res.json(transactions);
  } catch (error) {
    logger.error(`Error getting transaction history: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

export default router;
