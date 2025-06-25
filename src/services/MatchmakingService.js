import { supabase } from "../db/supabase.js";
import { logger } from "../utils/logger.js";
import {
  GAME_TYPES,
  GAME_STATUS,
  GAME_MODES,
  ERROR_MESSAGES,
} from "../utils/constants.js";

class MatchmakingService {
  constructor() {
    this.activeRooms = new Map(); // In-memory cache of active rooms
    this.playerQueue = new Map(); // Queue of players waiting for matches
  }

  async createRoom(gameType, gameMode, creatorWallet) {
    try {
      // Validate inputs
      if (!Object.values(GAME_TYPES).includes(gameType)) {
        throw new Error("Invalid game type");
      }
      if (!Object.values(GAME_MODES).includes(gameMode)) {
        throw new Error("Invalid game mode");
      }
      if (!creatorWallet) {
        throw new Error("Creator wallet is required");
      }

      // Create room in database
      const { data: room, error } = await supabase
        .from("game_rooms")
        .insert([
          {
            game_type: gameType,
            game_mode: gameMode,
            creator_wallet: creatorWallet,
            status: GAME_STATUS.WAITING,
            current_players: 1,
            max_players: this.getMaxPlayers(gameType, gameMode),
            metadata: {
              created_at: new Date().toISOString(),
              last_activity: new Date().toISOString(),
            },
          },
        ])
        .select()
        .single();

      if (error) throw error;

      // Add to active rooms
      this.activeRooms.set(room.id, {
        ...room,
        players: [creatorWallet],
      });

      console.log("Game room created", {
        roomId: room.id,
        gameType,
        gameMode,
        creatorWallet,
      });

      return room;
    } catch (error) {
      logger.error("Error creating game room:", error);
      throw error;
    }
  }

  async joinRoom(roomId, playerWallet) {
    try {
      // Validate inputs
      if (!roomId) throw new Error("Room ID is required");
      if (!playerWallet) throw new Error("Player wallet is required");

      // Get room from database
      const { data: room, error } = await supabase
        .from("game_rooms")
        .select("*")
        .eq("id", roomId)
        .single();

      if (error) throw error;
      if (!room) throw new Error(ERROR_MESSAGES.ROOM_NOT_FOUND);
      if (room.status !== GAME_STATUS.WAITING) {
        throw new Error("Room is not accepting players");
      }
      if (room.current_players >= room.max_players) {
        throw new Error("Room is full");
      }

      // Update room in database
      const { data: updatedRoom, error: updateError } = await supabase
        .from("game_rooms")
        .update({
          current_players: room.current_players + 1,
          metadata: {
            ...room.metadata,
            last_activity: new Date().toISOString(),
          },
        })
        .eq("id", roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Update active rooms
      const activeRoom = this.activeRooms.get(roomId);
      if (activeRoom) {
        activeRoom.players.push(playerWallet);
        activeRoom.current_players = updatedRoom.current_players;
      }

      console.log("Player joined room", {
        roomId,
        playerWallet,
        currentPlayers: updatedRoom.current_players,
      });

      // Check if room is full and start game
      if (updatedRoom.current_players >= updatedRoom.max_players) {
        await this.startGame(roomId);
      }

      return updatedRoom;
    } catch (error) {
      logger.error("Error joining room:", error);
      throw error;
    }
  }

  async leaveRoom(roomId, playerWallet) {
    try {
      // Validate inputs
      if (!roomId) throw new Error("Room ID is required");
      if (!playerWallet) throw new Error("Player wallet is required");

      // Get room from database
      const { data: room, error } = await supabase
        .from("game_rooms")
        .select("*")
        .eq("id", roomId)
        .single();

      if (error) throw error;
      if (!room) throw new Error(ERROR_MESSAGES.ROOM_NOT_FOUND);

      // Update room in database
      const { data: updatedRoom, error: updateError } = await supabase
        .from("game_rooms")
        .update({
          current_players: Math.max(0, room.current_players - 1),
          metadata: {
            ...room.metadata,
            last_activity: new Date().toISOString(),
          },
        })
        .eq("id", roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Update active rooms
      const activeRoom = this.activeRooms.get(roomId);
      if (activeRoom) {
        activeRoom.players = activeRoom.players.filter(
          (p) => p !== playerWallet
        );
        activeRoom.current_players = updatedRoom.current_players;
      }

      console.log("Player left room", {
        roomId,
        playerWallet,
        currentPlayers: updatedRoom.current_players,
      });

      // If room is empty, close it
      if (updatedRoom.current_players === 0) {
        await this.closeRoom(roomId);
      }

      return updatedRoom;
    } catch (error) {
      logger.error("Error leaving room:", error);
      throw error;
    }
  }

  async startGame(roomId) {
    try {
      const { data: room, error } = await supabase
        .from("game_rooms")
        .update({
          status: GAME_STATUS.IN_PROGRESS,
          metadata: {
            game_started_at: new Date().toISOString(),
          },
        })
        .eq("id", roomId)
        .select()
        .single();

      if (error) throw error;

      console.log("Game started", {
        roomId,
        players: this.activeRooms.get(roomId)?.players,
      });

      return room;
    } catch (error) {
      logger.error("Error starting game:", error);
      throw error;
    }
  }

  async closeRoom(roomId) {
    try {
      const { error } = await supabase
        .from("game_rooms")
        .update({
          status: GAME_STATUS.CLOSED,
          metadata: {
            closed_at: new Date().toISOString(),
          },
        })
        .eq("id", roomId);

      if (error) throw error;

      // Remove from active rooms
      this.activeRooms.delete(roomId);

      console.log("Room closed", { roomId });
    } catch (error) {
      logger.error("Error closing room:", error);
      throw error;
    }
  }

  async findMatch(gameType, gameMode, playerWallet) {
    try {
      // Validate inputs
      if (!Object.values(GAME_TYPES).includes(gameType)) {
        throw new Error("Invalid game type");
      }
      if (!Object.values(GAME_MODES).includes(gameMode)) {
        throw new Error("Invalid game mode");
      }
      if (!playerWallet) throw new Error("Player wallet is required");

      // Find available room
      const { data: availableRoom, error } = await supabase
        .from("game_rooms")
        .select("*")
        .eq("game_type", gameType)
        .eq("game_mode", gameMode)
        .eq("status", GAME_STATUS.WAITING)
        .lt("current_players", "max_players")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (error && error.code !== "PGRST116") throw error;

      if (availableRoom) {
        // Join existing room
        return await this.joinRoom(availableRoom.id, playerWallet);
      } else {
        // Create new room
        return await this.createRoom(gameType, gameMode, playerWallet);
      }
    } catch (error) {
      logger.error("Error finding match:", error);
      throw error;
    }
  }

  getMaxPlayers(gameType, gameMode) {
    // Define max players based on game type and mode
    const maxPlayers = {
      [GAME_TYPES.SLOTS]: {
        [GAME_MODES.SOLO]: 1,
        [GAME_MODES.MULTI]: 4,
      },
      [GAME_TYPES.BLACKJACK]: {
        [GAME_MODES.SOLO]: 1,
        [GAME_MODES.MULTI]: 7,
      },
      [GAME_TYPES.ROULETTE]: {
        [GAME_MODES.SOLO]: 1,
        [GAME_MODES.MULTI]: 8,
      },
    };

    return maxPlayers[gameType]?.[gameMode] || 1;
  }

  // Cleanup method to remove stale rooms
  async cleanupStaleRooms() {
    try {
      const staleTimeout = 30 * 60 * 1000; // 30 minutes
      const now = new Date();

      for (const [roomId, room] of this.activeRooms.entries()) {
        const lastActivity = new Date(room.metadata.last_activity);
        if (now - lastActivity > staleTimeout) {
          await this.closeRoom(roomId);
        }
      }
    } catch (error) {
      logger.error("Error cleaning up stale rooms:", error);
    }
  }
}

export default new MatchmakingService();
