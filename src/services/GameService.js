import Game from "../models/Game.js";
import Room from "../models/Room.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import {
  GAME_TYPES,
  GAME_MODES,
  GAME_STATUS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUS,
  ERROR_MESSAGES,
  CURRENCIES,
} from "../utils/constants.js";

class GameService {
  constructor() {
    this.games = {
      [GAME_TYPES.POKER]: this.pokerLogic,
      [GAME_TYPES.BLACKJACK]: this.blackjackLogic,
      [GAME_TYPES.SLOTS]: this.slotsLogic,
      [GAME_TYPES.ROULETTE]: this.rouletteLogic,
    };
  }

  async startGame(
    gameType,
    gameMode,
    userId,
    betAmount,
    isPrivate = false,
    maxPlayers = 1
  ) {
    try {
      // Validate user has enough balance
      const user = await User.getUser(userId);
      if (!user) {
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }

      if (user.chips_balance < betAmount) {
        throw new Error(ERROR_MESSAGES.INSUFFICIENT_BALANCE);
      }

      console.log(
        `gotten a bet of ${betAmount}, proceeding to create the game`
      );
      // Create game with user as creator (room owner)
      const game = await Game.createGame(
        gameType,
        gameMode,
        userId,
        maxPlayers,
        betAmount
      );

      // Add the creator as the first player
      await Game.addPlayerToGame(game.id, userId);

      // Create and process bet transaction for the creator
      const betTransaction = await Transaction.createTransaction(
        TRANSACTION_TYPES.BET,
        betAmount,
        userId,
        game.id,
        CURRENCIES.CHIPS
      );

      // Deduct chips from user balance
      await User.updateBalance(userId, { chipsDelta: -betAmount });

      // Update transaction status to completed
      await Transaction.updateTransactionStatus(
        betTransaction.id,
        TRANSACTION_STATUS.COMPLETED
      );

      // For single player games, start immediately
      if (gameMode === GAME_MODES.SINGLE) {
        await Game.updateGameStatus(game.id, GAME_STATUS.ACTIVE);
      } else {
        // For multiplayer, wait for other players
        await Game.updateGameStatus(game.id, GAME_STATUS.WAITING);
      }

      // If multiplayer and not private, create or join room
      let room = null;
      if (
        gameMode === GAME_MODES.MULTIPLAYER &&
        !isPrivate &&
        gameType !== GAME_TYPES.ROULETTE
      ) {
        // Only create rooms for non-roulette multiplayer games
        room = await Room.findMatch(gameType, userId);
        await Game.updateGame(game.id, { room_id: room.id });
      }

      return {
        ...game,
        room,
        betAmount,
        userBalance: user.chips_balance - betAmount,
        isCreator: true,
      };
    } catch (error) {
      console.error("StartGame error:", error);
      throw new Error(`Failed to start game: ${error.message}`);
    }
  }

  async placeBet(gameId, userId, betAmount) {
    try {
      const game = await Game.getGame(gameId);
      if (!game) throw new Error(ERROR_MESSAGES.GAME_NOT_FOUND);

      if (game.status !== GAME_STATUS.ACTIVE) {
        throw new Error("Game is not active");
      }

      // Validate user has enough balance
      const user = await User.getUser(userId);
      if (user.chips_balance < betAmount) {
        throw new Error(ERROR_MESSAGES.INSUFFICIENT_BALANCE);
      }

      // Create and process bet transaction
      const transaction = await Transaction.createTransaction(
        TRANSACTION_TYPES.BET,
        betAmount,
        userId,
        gameId
      );

      // Deduct chips from user balance
      await User.updateBalance(userId, { chipsDelta: -betAmount });

      // Update transaction status
      await Transaction.updateTransactionStatus(
        transaction.id,
        TRANSACTION_STATUS.COMPLETED
      );

      return {
        ...transaction,
        userBalance: user.chips_balance - betAmount,
      };
    } catch (error) {
      throw new Error(`Failed to place bet: ${error.message}`);
    }
  }

  async getGame(gameId) {
    try {
      const game = await Game.getGame(gameId);
      if (!game) throw new Error(ERROR_MESSAGES.GAME_NOT_FOUND);

      // Get game transactions
      const transactions = await Transaction.getGameTransactions(gameId);

      // Get room info if multiplayer
      let room = null;
      if (game.room_id) {
        const roomPlayers = await Room.getRoomPlayers(game.room_id);
        room = { players: roomPlayers };
      }

      return {
        ...game,
        transactions,
        room,
      };
    } catch (error) {
      throw new Error(`Failed to get game: ${error.message}`);
    }
  }

  async processGameResult(gameId, results) {
    try {
      console.log("Processing game result for gameId:", gameId);
      console.log("Results received:", results);

      // Validate inputs
      if (!gameId) {
        throw new Error("Game ID is required");
      }

      if (!results || !Array.isArray(results) || results.length === 0) {
        throw new Error("Results must be a non-empty array");
      }

      const game = await Game.getGame(gameId);
      if (!game) {
        throw new Error("Game not found");
      }

      console.log("Game found:", game);

      if (game.status !== GAME_STATUS.ACTIVE) {
        throw new Error(`Game is not active. Current status: ${game.status}`);
      }

      // Validate game type
      if (!game.type || !this.games[game.type]) {
        throw new Error(`Invalid or unsupported game type: ${game.game_type}`);
      }

      // Process results based on game type
      const gameLogic = this.games[game.type];
      console.log("Using game logic for:", game.type);

      // Validate each result before processing
      for (const result of results) {
        if (!result.userId) {
          throw new Error("Each result must have a userId");
        }
        if (typeof result.betAmount !== "number" || result.betAmount <= 0) {
          throw new Error("Each result must have a valid betAmount");
        }
      }

      const processedResults = await gameLogic.call(this, results, game);
      console.log("Processed results:", processedResults);

      // Update game status to completed
      await Game.updateGameStatus(gameId, GAME_STATUS.COMPLETED);

      // Process transactions for each result
      const transactionPromises = [];

      for (const result of processedResults) {
        if (!result.userId) {
          console.warn("Skipping result without userId:", result);
          continue;
        }

        // Handle wins
        if (result.win && result.amount > 0) {
          console.log(
            `Processing win for user ${result.userId}: ${result.amount} chips`
          );

          const winTransactionPromise = this.processWinTransaction(
            result.userId,
            result.amount,
            gameId
          );
          transactionPromises.push(winTransactionPromise);
        }

        // Handle push (return bet) - for blackjack pushes
        if (result.outcome === "push" && result.betAmount) {
          console.log(
            `Processing push for user ${result.userId}: returning ${result.betAmount} chips`
          );

          const pushTransactionPromise = this.processPushTransaction(
            result.userId,
            result.betAmount,
            gameId
          );
          transactionPromises.push(pushTransactionPromise);
        }
      }

      // Wait for all transactions to complete
      await Promise.all(transactionPromises);

      console.log("All transactions processed successfully");
      return processedResults;
    } catch (error) {
      console.error("Error in processGameResult:", error);
      throw new Error(`Failed to process game result: ${error.message}`);
    }
  }

  // ✅ Helper method for processing win transactions
  async processWinTransaction(userId, amount, gameId) {
    try {
      // Create win transaction
      const winTransaction = await Transaction.createTransaction(
        TRANSACTION_TYPES.WIN,
        amount,
        userId,
        gameId,
        CURRENCIES.CHIPS
      );

      console.log("fetching user with userId: ", userId);
      const user = await User.getUser(userId);
      console.log("user gotten :", user);

      // Add chips to user balance
      const winAMount = amount * 2;

      await User.updateBalance(userId, { chipsDelta: winAMount });

      // Update transaction status
      await Transaction.updateTransactionStatus(
        winTransaction.id,
        TRANSACTION_STATUS.COMPLETED
      );

      return winTransaction;
    } catch (error) {
      console.error(
        `Error processing win transaction for user ${userId}:`,
        error
      );
      throw error;
    }
  }

  // ✅ Helper method for processing push transactions (return bet)
  async processPushTransaction(userId, amount, gameId) {
    try {
      // Create refund transaction for push
      const pushTransaction = await Transaction.createTransaction(
        TRANSACTION_TYPES.REFUND,
        amount,
        userId,
        gameId,
        CURRENCIES.CHIPS
      );

      // Add chips back to user balance
      await User.updateBalance(userId, { chipsDelta: amount });

      // Update transaction status
      await Transaction.updateTransactionStatus(
        pushTransaction.id,
        TRANSACTION_STATUS.COMPLETED
      );

      return pushTransaction;
    } catch (error) {
      console.error(
        `Error processing push transaction for user ${userId}:`,
        error
      );
      throw error;
    }
  }

  // ✅ Enhanced blackjack logic with better error handling
  async blackjackLogic(results, game) {
    try {
      console.log("Processing blackjack logic for results:", results);

      return results.map((result, index) => {
        try {
          const { userId, playerHand, dealerHand, betAmount } = result;

          // Validate required fields
          if (!userId) throw new Error(`Result ${index}: userId is required`);
          if (!playerHand || !Array.isArray(playerHand)) {
            throw new Error(`Result ${index}: playerHand must be an array`);
          }
          if (!dealerHand || !Array.isArray(dealerHand)) {
            throw new Error(`Result ${index}: dealerHand must be an array`);
          }
          if (typeof betAmount !== "number" || betAmount <= 0) {
            throw new Error(
              `Result ${index}: betAmount must be a positive number`
            );
          }

          const playerScore = this.calculateBlackjackScore(playerHand);
          const dealerScore = this.calculateBlackjackScore(dealerHand);

          let win = false;
          let amount = 0;
          let outcome = "";

          // Determine winner
          if (playerScore > 21) {
            // Player busted
            win = false;
            amount = 0;
            outcome = "bust";
          } else if (dealerScore > 21) {
            // Dealer busted - player wins
            win = true;
            amount = betAmount;
            outcome = "dealer_bust";
          } else if (playerScore === 21 && playerHand.length === 2) {
            // Blackjack (3:2 payout)
            win = true;
            amount = Math.floor(betAmount * 1.5);
            outcome = "blackjack";
          } else if (playerScore > dealerScore) {
            // Player wins
            win = true;
            amount = betAmount;
            outcome = "win";
          } else if (playerScore === dealerScore) {
            // Push - bet is returned (handled separately)
            win = false;
            amount = 0;
            outcome = "push";
          } else {
            // Dealer wins
            win = false;
            amount = 0;
            outcome = "lose";
          }

          return {
            userId,
            win,
            amount,
            outcome,
            playerScore,
            dealerScore,
            playerHand,
            dealerHand,
            betAmount, // Include betAmount for push handling
          };
        } catch (error) {
          console.error(`Error processing blackjack result ${index}:`, error);
          throw error;
        }
      });
    } catch (error) {
      console.error("Error in blackjackLogic:", error);
      throw error;
    }
  }

  // ✅ Enhanced calculateBlackjackScore with error handling
  calculateBlackjackScore(hand) {
    try {
      if (!hand || !Array.isArray(hand)) {
        throw new Error("Hand must be an array");
      }

      let score = 0;
      let aces = 0;

      for (const card of hand) {
        if (typeof card !== "string") {
          throw new Error(`Invalid card format: ${card}`);
        }

        const parts = card.split("_");
        if (parts.length < 1) {
          throw new Error(`Invalid card format: ${card}`);
        }

        const value = parts[0];
        if (["jack", "queen", "king"].includes(value)) {
          score += 10;
        } else if (value === "ace") {
          aces += 1;
          score += 11;
        } else {
          const numValue = Number.parseInt(value);
          if (isNaN(numValue) || numValue < 1 || numValue > 10) {
            throw new Error(`Invalid card value: ${value}`);
          }
          score += numValue;
        }
      }

      // Handle aces
      while (score > 21 && aces > 0) {
        score -= 10;
        aces -= 1;
      }

      return score;
    } catch (error) {
      console.error("Error calculating blackjack score:", error);
      throw error;
    }
  }

  async slotsLogic(results, game) {
    // Implement slots game logic
    return results.map((result) => {
      const { userId, symbols, betAmount } = result;
      const multiplier = this.calculateSlotsMultiplier(symbols);
      const win = multiplier > 0;
      const amount = win ? betAmount * multiplier : 0;

      return {
        userId,
        win,
        amount,
        symbols,
        multiplier,
      };
    });
  }

  calculateSlotsMultiplier(symbols) {
    // Simple slots logic - 3 matching symbols
    if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
      const symbolMultipliers = {
        "🍒": 2,
        "🍋": 3,
        "🍊": 4,
        "🍇": 5,
        "💎": 10,
        "7️⃣": 20,
      };
      return symbolMultipliers[symbols[0]] || 1;
    }
    return 0;
  }

  async rouletteLogic(results, game) {
    // Implement roulette game logic
    return results.map((result) => {
      const { userId, bet, number, betAmount } = result;
      const win = this.checkRouletteBet(bet, number);
      const multiplier = this.getRouletteMultiplier(bet);
      const amount = win ? betAmount * multiplier : 0;

      return {
        userId,
        win,
        amount,
        bet,
        number,
        multiplier,
      };
    });
  }

  checkRouletteBet(bet, number) {
    if (typeof bet === "number") {
      return bet === number;
    }

    // Handle special bets
    switch (bet) {
      case "red":
        return [
          1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
        ].includes(number);
      case "black":
        return [
          2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
        ].includes(number);
      case "even":
        return number > 0 && number % 2 === 0;
      case "odd":
        return number % 2 === 1;
      case "low":
        return number >= 1 && number <= 18;
      case "high":
        return number >= 19 && number <= 36;
      default:
        return false;
    }
  }

  getRouletteMultiplier(bet) {
    if (typeof bet === "number") {
      return 35; // Straight up bet
    }

    // Even money bets
    if (["red", "black", "even", "odd", "low", "high"].includes(bet)) {
      return 1;
    }

    return 1;
  }

  async getAvailableRooms(gameType) {
    try {
      return await Room.getAvailableRooms(gameType);
    } catch (error) {
      throw new Error(`Failed to get available rooms: ${error.message}`);
    }
  }

  async joinRoom(roomId, userId) {
    try {
      const result = await Room.joinRoom(roomId, userId);
      return result;
    } catch (error) {
      throw new Error(`Failed to join room: ${error.message}`);
    }
  }

  async leaveRoom(roomId, userId) {
    try {
      const result = await Room.leaveRoom(roomId, userId);
      return result;
    } catch (error) {
      throw new Error(`Failed to leave room: ${error.message}`);
    }
  }

  async getUserCreatedGames(userId, gameType) {
    try {
      const games = await Game.getCreatedGames(userId, gameType);
      return games;
    } catch (error) {
      throw new Error(`Failed to get user created games: ${error.message}`);
    }
  }

  // ✅ NEW: Get joinable games for a specific game type
  async getJoinableGames(gameType, userId) {
    try {
      const games = await Game.getJoinableGames(gameType, userId);
      return games;
    } catch (error) {
      throw new Error(`Failed to get joinable games: ${error.message}`);
    }
  }

  async updateGame(gameId, updates) {
    try {
      if (!gameId || !updates || typeof updates !== "object") {
        throw new Error("gameId and updates object are required");
      }
      const updatedGame = await Game.updateGame(gameId, updates);
      return updatedGame;
    } catch (error) {
      console.error("Failed to update game:", error);
      throw new Error(`Failed to update game: ${error.message}`);
    }
  }

  /**
   * Create a transaction for the game result (win, push, blackjack, etc.)
   * @param {string} userId - The user receiving the result
   * @param {string} gameId - The game ID
   * @param {string} resultType - 'win', 'push', 'blackjack', etc.
   * @param {number} amount - The amount for the transaction
   * @returns {Promise<object>} The created transaction
   */
  async createResultTransaction(userId, gameId, resultType, amount) {
    try {
      let transactionType;
      switch (resultType) {
        case "win":
        case "blackjack":
          transactionType = TRANSACTION_TYPES.WIN;
          break;
        case "push":
          transactionType = TRANSACTION_TYPES.REFUND;
          break;
        default:
          throw new Error(`Unsupported resultType: ${resultType}`);
      }
      const transaction = await Transaction.createTransaction(
        transactionType,
        amount,
        userId,
        gameId,
        CURRENCIES.CHIPS
      );

      // Update transaction status
      await Transaction.updateTransactionStatus(
        transaction.id,
        TRANSACTION_STATUS.COMPLETED
      );
      
      return transaction;
    } catch (error) {
      console.error("Failed to create result transaction:", error);
      throw new Error(`Failed to create result transaction: ${error.message}`);
    }
  }
}

export default new GameService();
