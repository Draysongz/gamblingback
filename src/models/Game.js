import { supabase } from "../db/supabase.js";
import { GAME_STATUS } from "../utils/constants.js";

class Game {
  constructor(gameType, gameMode) {
    this.gameType = gameType;
    this.gameMode = gameMode;
    this.status = GAME_STATUS.WAITING;
    this.players = [];
    this.bets = {};
    this.gameData = {};
  }

  static async createGame(
    gameType,
    gameMode,
    creatorId,
    maxPlayers = 1,
    betAmount
  ) {
    try {
      // First, let's check what columns exist in the games table
      const { data: tableInfo, error: tableError } = await supabase
        .from("games")
        .select("*")
        .limit(0);

      if (tableError) {
        console.error("Error checking games table:", tableError);
        throw new Error(`Database table error: ${tableError.message}`);
      }

      // Prepare the basic insert data
      const insertData = {
        type: gameType,
        mode: gameMode,
        bet_amount: betAmount,
        status: GAME_STATUS.PENDING,
        created_at: new Date().toISOString(),
      };

      console.log("insertdata:", insertData);

      // Add creator_id if we can
      if (creatorId) {
        insertData.creator_id = creatorId;
      }

      // Add optional fields if they might exist
      if (maxPlayers) {
        insertData.max_players = maxPlayers;
      }

      insertData.current_players = 0;

      console.log("Attempting to insert game with data:", insertData);

      const { data, error } = await supabase
        .from("games")
        .insert([insertData])
        .select();

      if (error) {
        console.error("Error creating game:", error);

        // If it's a column not found error, try with minimal data
        if (
          error.message.includes("creator_id") ||
          error.message.includes("column")
        ) {
          console.log("Trying with minimal data...");
          const minimalData = {
            type: gameType,
            mode: gameMode,
            status: GAME_STATUS.PENDING,
          };

          const { data: retryData, error: retryError } = await supabase
            .from("games")
            .insert([minimalData])
            .select();

          if (retryError) {
            throw retryError;
          }

          return retryData[0];
        }

        throw error;
      }

      return data[0];
    } catch (error) {
      console.error("Failed to create game:", error);
      throw new Error(`Failed to create game: ${error.message}`);
    }
  }

  static async getGame(gameId) {
    try {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("id", gameId)
        .single();

      if (error) {
        console.error("Error getting game:", error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error("Failed to get game:", error);
      throw new Error(`Failed to get game: ${error.message}`);
    }
  }

  static async updateGameStatus(gameId, status) {
    try {
      const { data, error } = await supabase
        .from("games")
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", gameId)
        .select();

      if (error) {
        console.error("Error updating game status:", error);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error("Failed to update game status:", error);
      throw new Error(`Failed to update game status: ${error.message}`);
    }
  }

  static async updateGame(gameId, updates) {
    try {
      const { data, error } = await supabase
        .from("games")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", gameId)
        .select();

      if (error) {
        console.error("Error updating game:", error);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error("Failed to update game:", error);
      throw new Error(`Failed to update game: ${error.message}`);
    }
  }

  static async getUserActiveGames(userId) {
    try {
      // Try to get games by creator_id first
      const query = supabase
        .from("games")
        .select("*")
        .in("status", [GAME_STATUS.PENDING, GAME_STATUS.ACTIVE])
        .order("created_at", { ascending: false });

      // Try with creator_id if it exists
      try {
        const { data, error } = await query.eq("creator_id", userId);
        if (!error) {
          return data;
        }
      } catch (creatorError) {
        console.log("creator_id column doesn't exist, trying user_id...");
      }

      // Fallback to user_id if creator_id doesn't exist
      const { data, error } = await query.eq("user_id", userId);
      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error in getUserActiveGames:", error);
      throw error;
    }
  }

  static async getGameHistory(userId, limit = 20) {
    try {
      const query = supabase
        .from("games")
        .select(
          `
          *,
          transactions (
            type,
            amount,
            status
          )
        `
        )
        .eq("status", GAME_STATUS.COMPLETED)
        .order("created_at", { ascending: false })
        .limit(limit);

      // Try with creator_id first
      try {
        const { data, error } = await query.eq("creator_id", userId);
        if (!error) {
          return data;
        }
      } catch (creatorError) {
        console.log("creator_id column doesn't exist, trying user_id...");
      }

      // Fallback to user_id
      const { data, error } = await query.eq("user_id", userId);
      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error in getGameHistory:", error);
      throw error;
    }
  }

  static async addPlayerToGame(gameId, userId) {
    try {
      // Check if game exists and has space
      const game = await this.getGame(gameId);
      if (!game) throw new Error("Game not found");

      if (game.current_players >= game.max_players) {
        throw new Error("Game is full");
      }

      // Check if user is already in the game
      const { data: existingPlayer, error: checkError } = await supabase
        .from("game_players")
        .select("*")
        .eq("game_id", gameId)
        .eq("user_id", userId)
        .single();

      if (checkError && checkError.code !== "PGRST116") {
        // PGRST116 = no rows returned
        throw checkError;
      }

      if (existingPlayer) {
        throw new Error("User is already in this game");
      }

      // Add player to game_players table
      const { data: playerData, error: playerError } = await supabase
        .from("game_players")
        .insert([
          {
            game_id: gameId,
            user_id: userId,
            joined_at: new Date().toISOString(),
            status: "active",
          },
        ])
        .select();

      if (playerError) {
        // If error is duplicate, user is already in game
        if (playerError.code === "23505") {
          throw new Error("User is already in this game");
        }
        throw playerError;
      }

      // Update current_players count in games table
      await this.updateGame(gameId, {
        current_players: game.current_players + 1,
      });

      return playerData[0];
    } catch (error) {
      throw new Error(`Failed to add player to game: ${error.message}`);
    }
  }

  static async removePlayerFromGame(gameId, userId) {
    try {
      // Remove player from game_players table
      const { data, error } = await supabase
        .from("game_players")
        .delete()
        .eq("game_id", gameId)
        .eq("user_id", userId)
        .select();

      if (error) throw error;

      // Update current_players count in games table
      const game = await this.getGame(gameId);
      if (game) {
        await this.updateGame(gameId, {
          current_players: Math.max(0, game.current_players - 1),
        });
      }

      return data[0];
    } catch (error) {
      throw new Error(`Failed to remove player from game: ${error.message}`);
    }
  }

  static async canUserJoinGame(gameId, userId) {
    try {
      const game = await this.getGame(gameId);
      if (!game) return { canJoin: false, reason: "Game not found" };

      // Check if game is full
      if (game.current_players >= game.max_players) {
        return { canJoin: false, reason: "Game is full" };
      }

      // Check if user is already in game
      const isAlreadyPlayer = game.game_players.some(
        (player) => player.user_id === userId
      );
      if (isAlreadyPlayer) {
        return { canJoin: false, reason: "Already in game" };
      }

      // Check game status
      if (![GAME_STATUS.PENDING, GAME_STATUS.WAITING].includes(game.status)) {
        return { canJoin: false, reason: "Game already started" };
      }

      return { canJoin: true, reason: "Can join" };
    } catch (error) {
      return { canJoin: false, reason: error.message };
    }
  }

  static async getCreatedGames(creatorId, status = null, gameType) {
    try {
      let query = supabase
        .from("games")
        .select(
          `
          *,
          game_players (
            user_id,
            joined_at,
            status,
            users (
              id,
              username,
              chips_balance
            )
          )
        `
        )
        .eq("creator_id", creatorId)
        .order("created_at", { ascending: false });

      if (status) {
        query = query.eq("status", status);
      }

      if (gameType) {
        query = query.eq("type", gameType);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error getting created games:", error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error("Failed to get created games:", error);
      throw new Error(`Failed to get created games: ${error.message}`);
    }
  }

  static async getUserGames(userId, status = null) {
    try {
      // Step 1: Get game_players + games
      let query = supabase
        .from("game_players")
        .select(
          `
        *,
        games (*)
        `
        )
        .eq("user_id", userId);

      if (status) {
        query = query.eq("games.status", status);
      }

      const { data: gamePlayers, error } = await query.order("joined_at", {
        ascending: false,
      });

      if (error) throw error;

      // Step 2: Get all unique creator_ids
      const creatorIds = [
        ...new Set(
          gamePlayers.map((item) => item.games?.creator_id).filter(Boolean)
        ),
      ];

      // Step 3: Fetch all creator users
      const { data: creators, error: creatorError } = await supabase
        .from("users") // or whatever table holds the creator info
        .select("id, username")
        .in("id", creatorIds);

      if (creatorError) throw creatorError;

      // Step 4: Map creators by ID for fast lookup
      const creatorMap = new Map(creators.map((user) => [user.id, user]));

      // Step 5: Assemble final result
      return gamePlayers.map((item) => ({
        ...item.games,
        creator: creatorMap.get(item.games?.creator_id) || null,
        player_joined_at: item.joined_at,
        player_status: item.status,
      }));
    } catch (error) {
      throw new Error(`Failed to get user games: ${error.message}`);
    }
  }

  static async getJoinableGames(gameType, userId) {
    try {
      const { data, error } = await supabase
        .from("games")
        .select(
          `
          *,
          creator:creator_id (
            id,
            username
          ),
          game_players (
            user_id,
            users (
              username
            )
          )
        `
        )
        .eq("type", gameType)
        .eq("mode", "multiplayer")
        .in("status", [GAME_STATUS.PENDING, GAME_STATUS.WAITING])
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Filter games that user can join
      return data.filter((game) => {
        const isCreator = game.creator_id === userId;
        const isPlayer = game.game_players.some(
          (player) => player.user_id === userId
        );
        const hasSpace = game.current_players < game.max_players;

        return !isPlayer && hasSpace; // User not already in game and has space
      });
    } catch (error) {
      throw new Error(`Failed to get joinable games: ${error.message}`);
    }
  }

  static async getGamePlayers(gameId) {
    try {
      const { data, error } = await supabase
        .from("game_players")
        .select(
          `
          *,
          users (
            id,
            username,
            chips_balance
          )
        `
        )
        .eq("game_id", gameId);

      if (error) throw error;
      return data;
    } catch (error) {
      throw new Error(`Failed to get game players: ${error.message}`);
    }
  }
}

export default Game;
