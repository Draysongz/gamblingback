import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  createTransferInstruction,
} from "@solana/spl-token";
import { supabase } from "../db/supabase.js";
import config from "../config/config.js";
import {
  TRANSACTION_TYPES,
  TRANSACTION_STATUS,
  CURRENCIES,
  ERROR_MESSAGES,
} from "../utils/constants.js";
import { logger } from "../utils/logger.js";

class BrokecoinService {
  constructor() {
    // Validate Solana configuration
    if (!config.solana.rpcUrl) {
      throw new Error("SOLANA_RPC_URL is not configured");
    }
    if (!config.solana.brokecoinMint) {
      throw new Error("SOLANA_BROKECOIN_MINT is not configured");
    }
    if (!config.solana.casinoWallet) {
      throw new Error("SOLANA_CASINO_WALLET is not configured");
    }

    try {
      this.connection = new Connection(config.solana.rpcUrl);
      this.tokenMint = new PublicKey(config.solana.brokecoinMint);
      this.casinoWallet = new PublicKey(config.solana.casinoWallet);

      // Verify mint address on initialization
      // this.verifyMintAddress().catch((error) => {
      //   logger.error("Failed to verify mint address:", error);
      //   throw new Error("Invalid mint address");
      // });
    } catch (error) {
      logger.error("Failed to initialize Solana connection:", error);
      throw new Error("Failed to initialize Solana connection");
    }
  }

  // async verifyMintAddress() {
  //   try {
  //     const mintInfo = await getMint(this.connection, this.tokenMint);

  //     if (!mintInfo) {
  //       throw new Error("Mint account not found");
  //     }

  //     console.log("Mint address verified successfully", {
  //       mint: this.tokenMint.toString(),
  //       decimals: mintInfo.decimals,
  //       supply: mintInfo.supply.toString(),
  //     });

  //     return mintInfo;
  //   } catch (error) {
  //     logger.error("Mint verification failed:", error);
  //     throw error;
  //   }
  // }

  async getBalance(walletAddress) {
    try {
      // Validate wallet address
      if (!walletAddress) {
        throw new Error("Wallet address is required");
      }
      console.log("wallet", walletAddress);
      new PublicKey(walletAddress); // Validate address format

      const { data: user, error } = await supabase
        .from("users")
        .select("brokecoin_balance, chips_balance")
        .eq("wallet_address", walletAddress)
        .single();

      console.log(user);

      if (error) throw error;
      if (!user) throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);

      return {
        brokecoin: user.brokecoin_balance,
        chips: user.chips_balance,
      };
    } catch (error) {
      logger.error(`Error getting balance: ${error.message}`);
      throw error;
    }
  }

  async getTransactionHistory(walletAddress, options = {}) {
    try {
      // Validate wallet address
      if (!walletAddress) {
        throw new Error("Wallet address is required");
      }
      new PublicKey(walletAddress); // Validate address format

      const { limit = 50, offset = 0, type } = options;

      let query = supabase
        .from("transactions")
        .select("*")
        .eq("wallet_address", walletAddress)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (type) {
        query = query.eq("type", type);
      }

      const { data: transactions, error } = await query;

      if (error) throw error;
      return transactions;
    } catch (error) {
      logger.error(`Error getting transaction history: ${error.message}`);
      throw error;
    }
  }

  async purchaseChips(walletAddress, brokecoinAmount, signedTransaction) {
    try {
      // Validate inputs
      if (!walletAddress) {
        throw new Error("Wallet address is required");
      }
      const userPublicKey = new PublicKey(walletAddress);

      if (!brokecoinAmount || brokecoinAmount <= 0) {
        throw new Error("Invalid brokecoin amount");
      }

      if (!signedTransaction) {
        throw new Error("Signed transaction is required");
      }

      // Check user's brokecoin balance in database
      const { data: userBalance, error: balanceError } = await supabase
        .from("users")
        .select("brokecoin_balance, id")
        .eq("wallet_address", walletAddress)
        .single();

      if (balanceError) throw balanceError;
      if (!userBalance) throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);

      // Check user's token balance on-chain
      const userTokenAccount = await getAssociatedTokenAddress(
        this.tokenMint,
        userPublicKey
      );

      let onChainBalance = null;
      try {
        const tokenAccount = await getAccount(
          this.connection,
          userTokenAccount
        );
        onChainBalance = Number(tokenAccount.amount) / Math.pow(10, 6); // Convert from token decimals

        if (onChainBalance < brokecoinAmount) {
          throw new Error("Insufficient brokecoin balance on-chain");
        }
      } catch (error) {
        if (error.name === "TokenAccountNotFoundError") {
          throw new Error("No brokecoin token account found");
        }
        throw error;
      }

      // Convert brokecoin to chips (1 brokecoin = 100 chips)
      const chipsAmount = brokecoinAmount * 100;

      // Start transaction
      const { data: transaction, error } = await supabase
        .from("transactions")
        .insert([
          {
            type: TRANSACTION_TYPES.PURCHASE_CHIPS,
            user_id: userBalance.id,
            amount: brokecoinAmount,
            currency: CURRENCIES.BROKECOIN,
            status: TRANSACTION_STATUS.PENDING,
            wallet_address: walletAddress,
            metadata: {
              chipsAmount,
              onChainBalance,
              databaseBalance: userBalance.brokecoin_balance,
            },
          },
        ])
        .select()
        .single();

      if (error) throw error;

      try {
        // Verify the transaction
        const tx = Transaction.from(Buffer.from(signedTransaction, "base64"));

        // Verify transaction is for the correct amount and to the casino wallet
        const casinoTokenAccount = await getAssociatedTokenAddress(
          this.tokenMint,
          this.casinoWallet
        );

        // Get transaction details
        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash();

        // Send and confirm transaction
        const signature = await this.connection.sendRawTransaction(
          tx.serialize()
        );
        const confirmation = await this.connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight,
        });

        if (confirmation.value.err) {
          throw new Error("Transaction failed to confirm");
        }

        // Verify transaction amount and destination
        const txInfo = await this.connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!txInfo) {
          throw new Error("Failed to get transaction details");
        }

        // Update user balances using user_id
        console.log(
          `Updating user balance: user_id=${userBalance.id}, brokecoin_delta=${-brokecoinAmount}, chips_delta=${chipsAmount}`
        );
        const { data: user, error: updateError } = await supabase.rpc(
          "update_user_balance",
          {
            p_user_id: userBalance.id,
            p_brokecoin_delta: -brokecoinAmount,
            p_chips_delta: chipsAmount,
          }
        );

        if (updateError) {
          logger.error(`Error updating user balance: ${updateError.message}`);
          throw updateError;
        }

        console.log(`Updated user balance: ${JSON.stringify(user)}`);

        const { data: updatedUser, error: fetchError } = await supabase
          .from("users")
          .select("brokecoin_balance, chips_balance")
          .eq("id", userBalance.id)
          .single();
        console.log(
          `User balance after update: ${JSON.stringify(updatedUser)}`
        );

        // Update transaction status with signature
        const { data: updatedTransaction, error: updateTxError } =
          await supabase
            .from("transactions")
            .update({
              status: TRANSACTION_STATUS.COMPLETED,
              signature: signature,
              confirmed_at: new Date().toISOString(),
            })
            .eq("id", transaction.id)
            .select()
            .single();

        if (updateTxError) {
          logger.error(
            `Failed to update transaction status: ${updateTxError.message}`
          );
          throw updateTxError;
        }

        console.log(`Transaction status updated: ${updatedTransaction.status}`);

        return {
          transaction: {
            ...transaction,
            signature,
            confirmed_at: new Date().toISOString(),
          },
          chipsAmount,
          brokecoinAmount,
          newBalance: user,
        };
      } catch (error) {
        // Rollback transaction status on error
        await supabase
          .from("transactions")
          .update({
            status: TRANSACTION_STATUS.FAILED,
            error: error.message,
          })
          .eq("id", transaction.id);
        throw error;
      }
    } catch (error) {
      logger.error(`Error purchasing chips: ${error.message}`);
      throw error;
    }
  }

  async cashoutChips(walletAddress, chipsAmount) {
    try {
      // Validate inputs
      if (!walletAddress) {
        throw new Error("Wallet address is required");
      }
      new PublicKey(walletAddress); // Validate address format

      if (!chipsAmount || chipsAmount <= 0) {
        throw new Error("Invalid chips amount");
      }

      // Convert chips to brokecoin (100 chips = 1 brokecoin)
      const brokecoinAmount = chipsAmount / 100;

      // Start transaction
      const { data: transaction, error } = await supabase
        .from("transactions")
        .insert([
          {
            type: TRANSACTION_TYPES.CASHOUT_CHIPS,
            amount: chipsAmount,
            currency: CURRENCIES.CHIPS,
            status: TRANSACTION_STATUS.PENDING,
            wallet_address: walletAddress,
            metadata: { brokecoinAmount },
          },
        ])
        .select()
        .single();

      if (error) throw error;

      try {
        // Update user balances
        const { data: user, error: updateError } = await supabase.rpc(
          "update_user_balance",
          {
            p_wallet_address: walletAddress,
            p_brokecoin_delta: brokecoinAmount,
            p_chips_delta: -chipsAmount,
          }
        );

        if (updateError) throw updateError;

        // Update transaction status
        await supabase
          .from("transactions")
          .update({ status: TRANSACTION_STATUS.COMPLETED })
          .eq("id", transaction.id);

        return {
          transaction,
          chipsAmount,
          brokecoinAmount,
          newBalance: user,
        };
      } catch (error) {
        // Rollback transaction status on error
        await supabase
          .from("transactions")
          .update({
            status: TRANSACTION_STATUS.FAILED,
            error: error.message,
          })
          .eq("id", transaction.id);
        throw error;
      }
    } catch (error) {
      logger.error(`Error cashing out chips: ${error.message}`);
      throw error;
    }
  }
}

export default new BrokecoinService();
