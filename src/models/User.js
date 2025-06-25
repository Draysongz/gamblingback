import { supabase } from "../db/supabase.js";
import { AppError } from "../middleware/errorHandler.js";
import { logger } from "../utils/logger.js";
import bcrypt from "bcrypt";

class User {
  constructor(id, username, walletAddress) {
    this.id = id;
    this.username = username;
    this.walletAddress = walletAddress;
    this.balance = {
      brokecoin: 0,
      chips: 0,
    };
  }

  static async createUser(username, password, walletAddress) {
    try {
      // Check if username already exists
      const existingUser = await this.findByUsername(username);
      if (existingUser) {
        throw new AppError("Username already exists", 400);
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const { data, error } = await supabase
        .from("users")
        .insert([
          {
            username,
            password: hashedPassword,
            wallet_address: walletAddress,
            brokecoin_balance: 0,
            chips_balance: 0,
          },
        ])
        .select()
        .single();

      if (error) {
        logger.error("Supabase error creating user:", error);
        throw new AppError("Failed to create user", 500);
      }

      if (!data) {
        throw new AppError("Failed to create user", 500);
      }

      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("Error creating user:", error);
      throw new AppError("Failed to create user", 500);
    }
  }

  static async authenticate(username, password) {
    try {
      const user = await this.findByUsername(username);
      if (!user) {
        throw new AppError("Invalid credentials", 401);
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new AppError("Invalid credentials", 401);
      }

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("Error authenticating user:", error);
      throw new AppError("Authentication failed", 500);
    }
  }

  static async getUser(userId) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        logger.error("Supabase error fetching user:", error);
        throw new AppError("Failed to fetch user", 500);
      }

      if (!data) {
        throw new AppError("User not found", 404);
      }

      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("Error fetching user:", error);
      throw new AppError("Failed to fetch user", 500);
    }
  }

  static async findByUsername(username) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .single();

      if (error && error.code !== "PGRST116") {
        logger.error("Supabase error finding user:", error);
        throw new AppError("Failed to find user", 500);
      }

      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("Error finding user by username:", error);
      throw new AppError("Failed to find user", 500);
    }
  }

  static async updateProfile(userId, updates) {
    try {
      const { data, error } = await supabase
        .from("users")
        .update(updates)
        .eq("id", userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error("Error updating user profile:", error);
      throw new AppError("Failed to update profile", 500);
    }
  }

  static async updateBalance(userId, { brokecoinDelta=0, chipsDelta }) {
    try {
      const { data, error } = await supabase.rpc("update_user_balance", {
        p_user_id: userId,
        p_brokecoin_delta: brokecoinDelta,
        p_chips_delta: chipsDelta,
      });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error("Error updating user balance:", error);
      throw new AppError("Failed to update balance", 500);
    }
  }

  static async getUserStats(userId) {
    try {
      const { data, error } = await supabase
        .from("user_stats")
        .select(
          `
          total_games_played,
          games_won,
          games_lost,
          total_bets_placed,
          total_winnings,
          highest_win,
          favorite_game,
          last_played_at
        `
        )
        .eq("user_id", userId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error("Error fetching user stats:", error);
      throw new AppError("Failed to fetch user stats", 500);
    }
  }

  static async getLeaderboard(limit = 10) {
    try {
      const { data, error } = await supabase
        .from("user_stats")
        .select(
          `
          user_id,
          users:user_id (
            username,
            avatar
          ),
          total_winnings,
          games_won,
          total_games_played
        `
        )
        .order("total_winnings", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data.map((stat) => ({
        userId: stat.user_id,
        username: stat.users.username,
        avatar: stat.users.avatar,
        totalWinnings: stat.total_winnings,
        gamesWon: stat.games_won,
        totalGamesPlayed: stat.total_games_played,
        winRate:
          stat.total_games_played > 0
            ? ((stat.games_won / stat.total_games_played) * 100).toFixed(2)
            : 0,
      }));
    } catch (error) {
      logger.error("Error fetching leaderboard:", error);
      throw new AppError("Failed to fetch leaderboard", 500);
    }
  }
}

export default User;
