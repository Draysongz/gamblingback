import { TRANSACTION_STATUS } from "../utils/constants.js";
import { supabase } from "../db/supabase.js";

class Transaction {
  constructor(type, amount, userId, gameId = null) {
    this.type = type;
    this.amount = amount;
    this.userId = userId;
    this.gameId = gameId;
    this.status = TRANSACTION_STATUS.PENDING;
  }

  static async createTransaction(type, amount, userId, gameId, currency) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("transactions")
      .insert([
        {
          type,
          amount,
          user_id: userId,
          game_id: gameId,
          currency,
          status: TRANSACTION_STATUS.PENDING,
          created_at: now,
          updated_at: now,
        },
      ])
      .select();

    if (error) throw error;
    return data[0];
  }

  static async updateTransactionStatus(transactionId, status) {
    const { data, error } = await supabase
      .from("transactions")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transactionId)
      .select();

    if (error) throw error;
    return data[0];
  }

  static async getUserTransactions(userId, limit = 50) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        *,
        games (
          game_type,
          status
        )
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  static async getGameTransactions(gameId) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        *,
        users (
          username
        )
      `
      )
      .eq("game_id", gameId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  }

  // ✅ Added method to get pending transactions
  static async getPendingTransactions(userId) {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", TRANSACTION_STATUS.PENDING)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  }

  // ✅ Added method to process pending transactions
  static async processPendingTransaction(transactionId) {
    try {
      const { data: transaction, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", transactionId)
        .single();

      if (error) throw error;

      if (transaction.status !== TRANSACTION_STATUS.PENDING) {
        throw new Error("Transaction is not pending");
      }

      // Update status to completed
      return await this.updateTransactionStatus(
        transactionId,
        TRANSACTION_STATUS.COMPLETED
      );
    } catch (error) {
      // Mark as failed if processing fails
      await this.updateTransactionStatus(
        transactionId,
        TRANSACTION_STATUS.FAILED
      );
      throw error;
    }
  }

  // ✅ Added method to get transaction summary
  static async getTransactionSummary(userId, startDate, endDate) {
    const { data, error } = await supabase
      .from("transactions")
      .select("type, amount, status")
      .eq("user_id", userId)
      .eq("status", TRANSACTION_STATUS.COMPLETED)
      .gte("created_at", startDate)
      .lte("created_at", endDate);

    if (error) throw error;

    const summary = {
      totalBets: 0,
      totalWins: 0,
      totalTransactions: data.length,
      netAmount: 0,
    };

    data.forEach((transaction) => {
      if (transaction.type === "bet") {
        summary.totalBets += transaction.amount;
        summary.netAmount -= transaction.amount;
      } else if (transaction.type === "win") {
        summary.totalWins += transaction.amount;
        summary.netAmount += transaction.amount;
      }
    });

    return summary;
  }
}

export default Transaction;
