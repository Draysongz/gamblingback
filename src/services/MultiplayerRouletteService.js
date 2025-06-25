import redisService from "./RedisService.js";
import webSocketService from "./WebSocketService.js";
import { GAME_STATUS, GAME_TYPES } from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import { supabase } from "../db/supabase.js";

class MultiplayerRouletteService {
  constructor() {
    this.gamePhases = {
      WAITING: "waiting",
      BETTING: "betting",
      SPINNING: "spinning",
      RESULTS: "results",
      FINISHED: "finished",
    };

    this.phaseDurations = {
      BETTING: 30000, // 30 seconds for betting
      SPINNING: 10000, // 10 seconds for spinning
      RESULTS: 5000, // 5 seconds to show results
    };

    this.betTypes = {
      NUMBER: "number",
      RED: "red",
      BLACK: "black",
      EVEN: "even",
      ODD: "odd",
      LOW: "1-18",
      HIGH: "19-36",
    };

    this.redNumbers = [
      1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
    ];
    this.blackNumbers = [
      2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
    ];
  }

  // Database Operations
  async createGameInDatabase(creatorId, betAmount, maxPlayers) {
    try {
      const { data: game, error } = await supabase
        .from("games")
        .insert({
          type: GAME_TYPES.ROULETTE,
          mode: "multiplayer",
          status: GAME_STATUS.WAITING,
          creator_id: creatorId,
          user_id: creatorId,
          bet_amount: betAmount,
          max_players: maxPlayers,
          current_players: 1,
          game_data: {
            rounds: [],
            current_round: 0,
            phase: this.gamePhases.WAITING,
          },
        })
        .select()
        .single();

      if (error) throw error;
      return game;
    } catch (error) {
      logger.error("Error creating game in database:", error);
      throw error;
    }
  }

  async addPlayerToGame(gameId, playerId) {
    try {
      const { error } = await supabase.from("game_players").insert({
        game_id: gameId,
        user_id: playerId,
        joined_at: new Date().toISOString(),
        status: "active",
      });

      if (error) throw error;
    } catch (error) {
      logger.error("Error adding player to game:", error);
      throw error;
    }
  }

  async removePlayerFromGame(gameId, playerId) {
    try {
      const { error } = await supabase
        .from("game_players")
        .delete()
        .match({ game_id: gameId, player_id: playerId });

      if (error) throw error;
    } catch (error) {
      logger.error("Error removing player from game:", error);
      throw error;
    }
  }

  async updateGameStatus(gameId, status) {
    try {
      const { error } = await supabase
        .from("games")
        .update({ status })
        .eq("id", gameId);

      if (error) throw error;
    } catch (error) {
      logger.error("Error updating game status:", error);
      throw error;
    }
  }

  async processBetTransaction(gameId, playerId, betAmount) {
    try {
      const { error } = await supabase.rpc("process_bet", {
        p_game_id: gameId,
        p_player_id: playerId,
        p_bet_amount: betAmount,
      });

      if (error) throw error;
    } catch (error) {
      logger.error("Error processing bet transaction:", error);
      throw error;
    }
  }

  async processGameResults(gameId, results) {
    try {
      const { error } = await supabase.rpc("process_game_results", {
        p_game_id: gameId,
        p_results: results,
      });

      if (error) throw error;
    } catch (error) {
      logger.error("Error processing game results:", error);
      throw error;
    }
  }

  // Game Logic
  async createMultiplayerGame(creatorId, betAmount, maxPlayers = 8) {
    try {
      // Create game in database
      const game = await this.createGameInDatabase(
        creatorId,
        betAmount,
        maxPlayers
      );

      // Initialize game state in Redis
      const gameState = {
        gameId: game.id,
        phase: this.gamePhases.WAITING,
        players: [creatorId],
        bets: {},
        currentRound: 0,
        winningNumber: null,
        phaseEndTime: null,
        createdAt: Date.now(),
        betAmount: betAmount,
        maxPlayers: maxPlayers,
      };

      // Create game room first
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .insert({
          game_id: game.id,
          creator_id: creatorId,
          game_type: GAME_TYPES.ROULETTE,
          status: GAME_STATUS.WAITING,
          min_bet: betAmount,
          max_bet: betAmount,
          current_players: 1,
          max_players: maxPlayers,
        })
        .select()
        .single();

      if (roomError) throw roomError;

      // Then set game state
      await redisService.setGameState(game.id, gameState);

      // Add creator to room
      await redisService.addPlayerToRoom(game.id, creatorId);

      console.log(`Multiplayer roulette game created: ${game.id}`);
      return { ...game, gameState, room };
    } catch (error) {
      logger.error("Error creating multiplayer roulette game:", error);
      throw error;
    }
  }

  async joinGame(roomId, playerId) {
    try {
      console.log(`User ${playerId} joining room ${roomId}`);

      // First get the room
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select()
        .eq("id", roomId)
        .single();

      if (roomError) {
        logger.error(`Room not found: ${roomError.message}`);
        throw new Error("Room not found");
      }

      // Check if room is full
      if (room.current_players >= room.max_players) {
        throw new Error("Room is full");
      }

      let gameState;
      let gameId;

      // Check if there's an active game in the room
      if (room.game_id) {
        // Get the active game
        const { data: activeGame, error: gameError } = await supabase
          .from("games")
          .select(
            `
            *,
            game_players (
              user_id,
              joined_at,
              status
            )
          `
          )
          .eq("id", room.game_id)
          .single();

        if (gameError) {
          logger.error(`Error getting active game: ${gameError.message}`);
          throw gameError;
        }

        if (!activeGame) {
          logger.error(`No game found with id ${room.game_id}`);
          throw new Error("Game not found");
        }

        gameId = activeGame.id;
        gameState = await redisService.getGameState(gameId);

        // If no game state exists in Redis, reconstruct it from database
        if (!gameState) {
          console.log(
            `Reconstructing game state for game ${gameId} from database`
          );

          // Get all active players from game_players
          const activePlayers = activeGame.game_players
            .filter((p) => p.status === "active")
            .map((p) => p.user_id);

          // Get game data from database
          const gameData = activeGame.game_data || {};

          // Reconstruct game state
          gameState = {
            gameId: gameId,
            phase: gameData.phase || this.gamePhases.WAITING,
            players: activePlayers,
            bets: gameData.bets || {},
            currentRound: gameData.current_round || 0,
            winningNumber: gameData.winning_number || null,
            phaseEndTime: gameData.phase_end_time || null,
            createdAt: new Date(activeGame.created_at).getTime(),
            betAmount: activeGame.bet_amount,
            maxPlayers: activeGame.max_players,
            roomId: roomId,
            game_type: GAME_TYPES.ROULETTE,
            status: activeGame.status,
          };

          // Set reconstructed state in Redis
          await redisService.setGameState(gameId, gameState);
          console.log(`Game state reconstructed: ${JSON.stringify(gameState)}`);
        }

        // Ensure players is an array
        if (typeof gameState.players === "string") {
          gameState.players = [gameState.players];
        }

        // Check if player is already in game
        const isPlayerInGame = gameState.players.includes(playerId);

        // If player is not in game, add them
        if (!isPlayerInGame) {
          if (gameState.phase !== this.gamePhases.WAITING) {
            throw new Error("Game already started");
          }

          if (gameState.players.length >= gameState.maxPlayers) {
            throw new Error("Game is full");
          }

          gameState.players.push(playerId);
          await redisService.setGameState(gameId, gameState);
          console.log(
            `Player added to existing game: ${JSON.stringify(gameState)}`
          );

          // Add player to game_players
          const { error: playerError } = await supabase
            .from("game_players")
            .insert({
              game_id: gameId,
              user_id: playerId,
              joined_at: new Date().toISOString(),
              status: "active",
            });

          if (playerError) {
            logger.error(`Error adding player to game: ${playerError.message}`);
            throw playerError;
          }

          // Update room in database
          const { error: updateError } = await supabase
            .from("rooms")
            .update({
              current_players: room.current_players + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", roomId);

          if (updateError) {
            logger.error(`Error updating room: ${updateError.message}`);
            throw updateError;
          }

          // Add player to room in Redis
          await redisService.addPlayerToRoom(roomId, playerId);

          webSocketService.broadcastToRoom(roomId, {
            type: "player_joined",
            data: {
              playerId,
              playerCount: gameState.players.length,
              maxPlayers: gameState.maxPlayers,
            },
          });

          // Start game if enough players
          if (gameState.players.length >= 2) {
            await this.startBettingPhase(gameId);
          }
        }
      } else {
        // No game_id in room, create new game
        console.log("No game found in room, creating new game");

        // Create new game in database
        const { data: game, error: gameError } = await supabase
          .from("games")
          .insert({
            type: GAME_TYPES.ROULETTE,
            mode: "multiplayer",
            status: GAME_STATUS.WAITING,
            creator_id: playerId,
            user_id: playerId,
            bet_amount: room.min_bet,
            max_players: room.max_players,
            current_players: 1,
            game_data: {
              room_id: roomId,
              rounds: [],
              current_round: 0,
              phase: this.gamePhases.WAITING,
            },
          })
          .select()
          .single();

        if (gameError) {
          logger.error(`Error creating game: ${gameError.message}`);
          throw gameError;
        }

        gameId = game.id;

        // Update room with new game ID
        const { error: updateRoomError } = await supabase
          .from("rooms")
          .update({
            game_id: gameId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", roomId);

        if (updateRoomError) {
          logger.error(
            `Error updating room with game ID: ${updateRoomError.message}`
          );
          throw updateRoomError;
        }

        // Initialize game state
        gameState = {
          gameId: game.id,
          phase: this.gamePhases.WAITING,
          players: [playerId],
          bets: {},
          currentRound: 0,
          winningNumber: null,
          phaseEndTime: null,
          createdAt: Date.now(),
          betAmount: room.min_bet,
          maxPlayers: room.max_players,
          roomId: roomId,
          game_type: GAME_TYPES.ROULETTE,
          status: GAME_STATUS.WAITING,
        };

        await redisService.setGameState(gameId, gameState);
        console.log(`New game state created: ${JSON.stringify(gameState)}`);

        // Add creator to game_players
        const { error: playerError } = await supabase
          .from("game_players")
          .insert({
            game_id: gameId,
            user_id: playerId,
            joined_at: new Date().toISOString(),
            status: "active",
          });

        if (playerError) {
          logger.error(`Error adding creator to game: ${playerError.message}`);
          throw playerError;
        }
      }

      // Get the latest game state after all updates
      const finalGameState = await this.getGameState(gameId);
      if (!finalGameState) {
        throw new Error("Failed to get game state after join");
      }

      return {
        game: finalGameState.game,
        gameState: finalGameState.gameState,
        room: finalGameState.room,
      };
    } catch (error) {
      logger.error(`Error joining multiplayer roulette game: ${error.message}`);
      throw error;
    }
  }

  async startBettingPhase(gameId) {
    try {
      const gameState = await redisService.getGameState(gameId);
      if (!gameState) throw new Error("Game not found");

      gameState.phase = this.gamePhases.BETTING;
      gameState.phaseEndTime = Date.now() + this.phaseDurations.BETTING;
      gameState.currentRound += 1;
      gameState.bets = {};

      await redisService.setGameState(gameId, gameState);
      await this.updateGameStatus(gameId, GAME_STATUS.ACTIVE);

      webSocketService.broadcastToRoom(gameId, {
        type: "betting_phase_started",
        data: {
          phase: gameState.phase,
          phaseEndTime: gameState.phaseEndTime,
          round: gameState.currentRound,
          duration: this.phaseDurations.BETTING,
        },
      });

      setTimeout(() => {
        this.startSpinningPhase(gameId);
      }, this.phaseDurations.BETTING);

      console.log(`Betting phase started for game ${gameId}`);
    } catch (error) {
      logger.error("Error starting betting phase:", error);
      throw error;
    }
  }

  async placeBet(gameId, playerId, betType, betValue, betAmount) {
    try {
      const gameState = await redisService.getGameState(gameId);
      if (!gameState) throw new Error("Game not found");

      if (gameState.phase !== this.gamePhases.BETTING) {
        throw new Error("Betting phase is not active");
      }

      if (!gameState.players.includes(playerId)) {
        throw new Error("Player not in game");
      }

      if (betAmount !== gameState.betAmount) {
        throw new Error(`Bet amount must be ${gameState.betAmount}`);
      }

      await this.processBetTransaction(gameId, playerId, betAmount);

      if (!gameState.bets[playerId]) {
        gameState.bets[playerId] = [];
      }

      const bet = {
        type: betType,
        value: betValue,
        amount: betAmount,
        timestamp: Date.now(),
      };

      gameState.bets[playerId].push(bet);
      await redisService.setGameState(gameId, gameState);

      webSocketService.broadcastToRoom(gameId, {
        type: "bet_placed",
        data: {
          playerId,
          bet,
          totalBets: Object.keys(gameState.bets).length,
        },
      });

      return bet;
    } catch (error) {
      logger.error("Error placing bet:", error);
      throw error;
    }
  }

  async startSpinningPhase(gameId) {
    try {
      const gameState = await redisService.getGameState(gameId);
      if (!gameState) throw new Error("Game not found");

      gameState.phase = this.gamePhases.SPINNING;
      gameState.phaseEndTime = Date.now() + this.phaseDurations.SPINNING;
      gameState.winningNumber = Math.floor(Math.random() * 37);

      await redisService.setGameState(gameId, gameState);

      webSocketService.broadcastToRoom(gameId, {
        type: "spinning_phase_started",
        data: {
          phase: gameState.phase,
          phaseEndTime: gameState.phaseEndTime,
          duration: this.phaseDurations.SPINNING,
        },
      });

      setTimeout(() => {
        this.revealResults(gameId);
      }, this.phaseDurations.SPINNING);

      console.log(
        `Spinning phase started for game ${gameId}, winning number: ${gameState.winningNumber}`
      );
    } catch (error) {
      logger.error("Error starting spinning phase:", error);
      throw error;
    }
  }

  async revealResults(gameId) {
    try {
      const gameState = await redisService.getGameState(gameId);
      if (!gameState) throw new Error("Game not found");

      gameState.phase = this.gamePhases.RESULTS;
      gameState.phaseEndTime = Date.now() + this.phaseDurations.RESULTS;

      await redisService.setGameState(gameId, gameState);

      const results = [];
      for (const [playerId, playerBets] of Object.entries(gameState.bets)) {
        for (const bet of playerBets) {
          const result = this.calculateBetResult(bet, gameState.winningNumber);
          results.push({
            userId: playerId,
            bet: bet.type,
            betValue: bet.value,
            betAmount: bet.amount,
            number: gameState.winningNumber,
            win: result.win,
            amount: result.winAmount,
          });
        }
      }

      if (results.length > 0) {
        await this.processGameResults(gameId, results);
      }

      webSocketService.broadcastToRoom(gameId, {
        type: "results_revealed",
        data: {
          phase: gameState.phase,
          winningNumber: gameState.winningNumber,
          results: results,
          phaseEndTime: gameState.phaseEndTime,
        },
      });

      setTimeout(() => {
        this.startNextRoundOrFinish(gameId);
      }, this.phaseDurations.RESULTS);

      console.log(
        `Results revealed for game ${gameId}, winning number: ${gameState.winningNumber}`
      );
    } catch (error) {
      logger.error("Error revealing results:", error);
      throw error;
    }
  }

  calculateBetResult(bet, winningNumber) {
    let win = false;
    let multiplier = 0;

    switch (bet.type) {
      case this.betTypes.NUMBER:
        win = bet.value === winningNumber;
        multiplier = win ? 35 : 0;
        break;
      case this.betTypes.RED:
        win = this.redNumbers.includes(winningNumber);
        multiplier = win ? 1 : 0;
        break;
      case this.betTypes.BLACK:
        win = this.blackNumbers.includes(winningNumber);
        multiplier = win ? 1 : 0;
        break;
      case this.betTypes.EVEN:
        win = winningNumber > 0 && winningNumber % 2 === 0;
        multiplier = win ? 1 : 0;
        break;
      case this.betTypes.ODD:
        win = winningNumber % 2 === 1;
        multiplier = win ? 1 : 0;
        break;
      case this.betTypes.LOW:
        win = winningNumber >= 1 && winningNumber <= 18;
        multiplier = win ? 1 : 0;
        break;
      case this.betTypes.HIGH:
        win = winningNumber >= 19 && winningNumber <= 36;
        multiplier = win ? 1 : 0;
        break;
      default:
        win = false;
        multiplier = 0;
    }

    return {
      win,
      winAmount: win ? bet.amount * multiplier : 0,
    };
  }

  async startNextRoundOrFinish(gameId) {
    try {
      const gameState = await redisService.getGameState(gameId);
      if (!gameState) return;

      if (gameState.currentRound >= 3) {
        await this.finishGame(gameId);
      } else {
        await this.startBettingPhase(gameId);
      }
    } catch (error) {
      logger.error("Error starting next round:", error);
    }
  }

  async finishGame(gameId) {
    try {
      const gameState = await redisService.getGameState(gameId);
      if (!gameState) return;

      gameState.phase = this.gamePhases.FINISHED;
      await redisService.setGameState(gameId, gameState);

      // Update game in database
      const { error: gameError } = await supabase
        .from("games")
        .update({
          status: GAME_STATUS.COMPLETED,
          updated_at: new Date().toISOString(),
        })
        .eq("id", gameId);

      if (gameError) throw gameError;

      // Update room in database
      const { error: roomError } = await supabase
        .from("rooms")
        .update({
          status: GAME_STATUS.COMPLETED,
          updated_at: new Date().toISOString(),
        })
        .eq("game_id", gameId);

      if (roomError) throw roomError;

      webSocketService.broadcastToRoom(gameId, {
        type: "game_finished",
        data: {
          phase: gameState.phase,
          totalRounds: gameState.currentRound,
        },
      });

      // Clean up Redis data after some time
      setTimeout(async () => {
        await redisService.removeGameRoom(gameId);
        await redisService.removeGameState(gameId);
      }, 60000);

      console.log(
        `Game ${gameId} finished after ${gameState.currentRound} rounds`
      );
    } catch (error) {
      logger.error("Error finishing game:", error);
    }
  }

  async leaveGame(gameId, playerId) {
    try {
      const gameState = await redisService.getGameState(gameId);
      if (!gameState) throw new Error("Game not found");

      await this.removePlayerFromGame(gameId, playerId);

      // Update game state
      gameState.players = gameState.players.filter((id) => id !== playerId);
      if (gameState.bets[playerId]) {
        delete gameState.bets[playerId];
      }
      await redisService.setGameState(gameId, gameState);

      // Update game in database
      const { data: game, error: gameError } = await supabase
        .from("games")
        .update({
          current_players: gameState.players.length,
          updated_at: new Date().toISOString(),
        })
        .eq("id", gameId)
        .select()
        .single();

      if (gameError) throw gameError;

      // Update room in database
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .update({
          current_players: gameState.players.length,
          updated_at: new Date().toISOString(),
        })
        .eq("game_id", gameId)
        .select()
        .single();

      if (roomError) throw roomError;

      // Remove player from room
      await redisService.removePlayerFromRoom(gameId, playerId);

      webSocketService.broadcastToRoom(gameId, {
        type: "player_left",
        data: {
          playerId,
          playerCount: gameState.players.length,
        },
      });

      if (gameState.players.length === 0) {
        await this.finishGame(gameId);
      }

      return { gameState, game, room };
    } catch (error) {
      logger.error("Error leaving game:", error);
      throw error;
    }
  }

  async getGameState(gameId) {
    try {
      console.log(`Getting game state for game ${gameId}`);

      const gameState = await redisService.getGameState(gameId);
      console.log(`Redis game state: ${JSON.stringify(gameState)}`);

      if (!gameState) {
        logger.error(`No game state found for game ${gameId}`);
        return null;
      }

      // Get game from database
      const { data: games, error: gameError } = await supabase
        .from("games")
        .select()
        .eq("id", gameId);

      if (gameError) {
        logger.error(`Error getting game: ${gameError.message}`);
        throw gameError;
      }

      console.log(`Database games: ${JSON.stringify(games)}`);

      // If no game found, return null
      if (!games || games.length === 0) {
        console.log(`No game found with id ${gameId}`);
        return null;
      }

      const game = games[0];
      console.log(`Found game: ${JSON.stringify(game)}`);

      // Get room using the room_id from game_data
      const roomId = game.game_data?.room_id;
      console.log(`Room ID from game data: ${roomId}`);

      if (!roomId) {
        logger.error(`No room_id found in game data for game ${gameId}`);
        return null;
      }

      const { data: rooms, error: roomError } = await supabase
        .from("rooms")
        .select()
        .eq("id", roomId);

      if (roomError) {
        logger.error(`Error getting room: ${roomError.message}`);
        throw roomError;
      }

      console.log(`Database rooms: ${JSON.stringify(rooms)}`);

      // If no room found, return null
      if (!rooms || rooms.length === 0) {
        console.log(`No room found with id ${roomId} for game ${gameId}`);
        return null;
      }

      const room = rooms[0];
      console.log(`Found room: ${JSON.stringify(room)}`);

      const result = { gameState, game, room };
      console.log(`Returning game state: ${JSON.stringify(result)}`);

      return result;
    } catch (error) {
      logger.error("Error getting game state:", error);
      throw error;
    }
  }
}

export default new MultiplayerRouletteService();
