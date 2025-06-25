import express from "express";
import GameService from "../services/GameService.js";
import { authenticate } from "../middleware/auth.js";
import validate, { gameSchemas } from "../middleware/validation.js";
import { logger } from "../utils/logger.js";
import { SUCCESS_MESSAGES, ERROR_MESSAGES } from "../utils/constants.js";
import Game from "../models/Game.js";
import Room from "../models/Room.js";
import MultiplayerRouletteService from "../services/MultiplayerRouletteService.js";

const router = express.Router();

// ✅ Start a new game (private room creation)
router.post(
  "/start",
  authenticate,
  validate(gameSchemas.startGame),
  async (req, res) => {
    try {
      const {
        gameType,
        gameMode,
        betAmount,
        isPrivate = false,
        maxPlayers = 1,
      } = req.body;
      const userId = req.user.id;

      console.log(
        `Creating new ${isPrivate ? "private" : "public"} game: ${gameType} by user ${userId} with a bet of ${betAmount}`
      );

      const game = await GameService.startGame(
        gameType,
        gameMode,
        userId,
        betAmount,
        isPrivate,
        maxPlayers
      );

      res.json({ ...game, message: SUCCESS_MESSAGES.GAME_STARTED });
    } catch (error) {
      logger.error(`Error starting game: ${error.message}`);
      res
        .status(400)
        .json({ error: error.message || ERROR_MESSAGES.GAME_NOT_FOUND });
    }
  }
);

// ✅ Join a private game
router.post("/:gameId/join", authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { betAmount } = req.body;
    const userId = req.user.id;

    console.log(`User ${userId} joining private game ${gameId}`);

    const result = await GameService.joinPrivateGame(gameId, userId, betAmount);
    res.json({ ...result, message: "Successfully joined private game" });
  } catch (error) {
    logger.error(`Error joining private game: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

router.post("/:roomId/join", authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    // const { betAmount } = req.body;
    const userId = req.user.id;

    console.log(`User ${userId} joining game room ${roomId}`);

    const result = await Room.joinRoom(roomId, userId);
    res.json({ ...result, message: "Successfully joined game room" });
  } catch (error) {
    logger.error(`Error joining game room: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// ✅ Leave a private game
router.post("/:gameId/leave", authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;

    console.log(`User ${userId} leaving private game ${gameId}`);

    const result = await GameService.leavePrivateGame(gameId, userId);
    res.json(result);
  } catch (error) {
    logger.error(`Error leaving private game: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// ✅ Get user's created games (private rooms they own)
router.get("/created", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameType } = req.query;
    const games = await GameService.getUserCreatedGames(userId, gameType);
    res.json(games);
  } catch (error) {
    logger.error(`Error getting created games: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// ✅ Get games user is participating in
router.get("/participating", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const games = await GameService.getUserParticipatingGames(userId);
    res.json(games);
  } catch (error) {
    logger.error(`Error getting participating games: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// ✅ Get joinable public games
router.get("/joinable/:gameType", authenticate, async (req, res) => {
  try {
    const { gameType } = req.params;
    console.log("gametype: ", gameType);
    const userId = req.user.id;
    const games = await GameService.getJoinableGames(gameType, userId);
    res.json(games);
  } catch (error) {
    logger.error(`Error getting joinable games: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

router.get("/rooms/:gameType", authenticate, async (req, res) => {
  try {
    const { gameType } = req.params;
    console.log("gametype: ", gameType);
    const userId = req.user.id;
    const rooms = await Room.getAvailableRooms(gameType);
    res.json(rooms);
  } catch (error) {
    logger.error(`Error getting joinable games: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// Place a bet (existing)
router.post(
  "/:gameId/bet",
  authenticate,
  validate(gameSchemas.placeBet),
  async (req, res) => {
    try {
      const { gameId } = req.params;
      const { betAmount } = req.body;
      const userId = req.user.id;

      console.log(
        `Placing bet: ${betAmount} for game ${gameId} by user ${userId}`
      );
      const transaction = await GameService.placeBet(gameId, userId, betAmount);
      res.json({ ...transaction, message: SUCCESS_MESSAGES.BET_PLACED });
    } catch (error) {
      logger.error(`Error placing bet: ${error.message}`);
      res
        .status(400)
        .json({ error: error.message || ERROR_MESSAGES.INVALID_BET_AMOUNT });
    }
  }
);

// Get game status (existing)
router.get("/:gameId", authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    console.log(`Getting game status for game ${gameId}`);

    const gameState = await MultiplayerRouletteService.getGameState(gameId);
    console.log(`Game state result: ${JSON.stringify(gameState)}`);

    if (!gameState) {
      logger.error(`No game state found for game ${gameId}`);
      return res.status(404).json({ error: "Game not found" });
    }
    res.json(gameState);
  } catch (error) {
    logger.error(`Error getting game status: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// Process game result (existing)
router.post("/:gameId/result", authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { results } = req.body;

    console.log(`Processing game result for game ${gameId}`);
    const processedResults = await GameService.processGameResult(
      gameId,
      results
    );
    res.json(processedResults);
  } catch (error) {
    logger.error(`Error processing game result: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// Room-related routes (existing)
router.get("/rooms/:gameType", authenticate, async (req, res) => {
  try {
    const { gameType } = req.params;
    const rooms = await GameService.getAvailableRooms(gameType);
    res.json(rooms);
  } catch (error) {
    logger.error(`Error getting available rooms: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// Join a room
router.post("/rooms/:roomId/join", authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`User ${userId} joining room ${roomId}`);

    const result = await MultiplayerRouletteService.joinGame(roomId, userId);
    res.json({
      success: true,
      message: "Successfully joined room",
      game: result.game,
      gameState: result.gameState,
      room: result.room,
    });
  } catch (error) {
    logger.error(`Error joining room: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

router.post("/rooms/:roomId/leave", authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`User ${userId} leaving room ${roomId}`);
    const result = await GameService.leaveRoom(roomId, userId);
    res.json(result);
  } catch (error) {
    logger.error(`Error leaving room: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

router.get("/user/history", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      limit,
      offset = 0,
      gameType,
      status,
      startDate,
      endDate,
      outcome,
    } = req.query;

    console.log(`Getting game history for user ${userId}`, {
      limit,
      offset,
      gameType,
      status,
    });

    // Use Game class methods to get user's game history
    let games = [];

    if (status === "completed" || !status) {
      // Get completed games from history
      const completedGames = await Game.getGameHistory(
        userId,
        Number.parseInt(limit)
      );
      games = games.concat(completedGames);
    }

    if (status === "active" || !status) {
      // Get active games
      const activeGames = await Game.getUserActiveGames(userId);
      games = games.concat(activeGames);
    }

    // Get games where user is a player (not creator)
    const playerGames = await Game.getUserGames(userId, status);
    games = games.concat(playerGames);

    // Remove duplicates based on game ID
    const uniqueGames = games.filter(
      (game, index, self) => index === self.findIndex((g) => g.id === game.id)
    );

    // Apply filters
    let filteredGames = uniqueGames;

    if (gameType) {
      filteredGames = filteredGames.filter(
        (game) => game.type === gameType || game.game_type === gameType
      );
    }

    if (startDate) {
      filteredGames = filteredGames.filter(
        (game) => new Date(game.created_at) >= new Date(startDate)
      );
    }

    if (endDate) {
      filteredGames = filteredGames.filter(
        (game) => new Date(game.created_at) <= new Date(endDate)
      );
    }

    // Apply pagination
    const paginatedGames = filteredGames.slice(
      Number.parseInt(offset),
      Number.parseInt(offset) + Number.parseInt(limit)
    );

    // Calculate statistics
    const totalGames = filteredGames.length;
    const completedGamesCount = filteredGames.filter(
      (game) => game.status === "completed"
    ).length;

    console.log(paginatedGames);

    res.json({
      games: paginatedGames,
      pagination: {
        limit: Number.parseInt(limit),
        offset: Number.parseInt(offset),
        total: totalGames,
        hasMore: Number.parseInt(offset) + Number.parseInt(limit) < totalGames,
      },
      stats: {
        totalGames,
        completedGames: completedGamesCount,
        activeGames: totalGames - completedGamesCount,
      },
    });
  } catch (error) {
    logger.error(`Error getting game history: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

router.patch("/:gameId/update", authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    const updates = req.body;
    if (!gameId || !updates || typeof updates !== "object") {
      return res
        .status(400)
        .json({ error: "gameId and updates object are required" });
    }
    const updatedGame = await GameService.updateGame(gameId, updates);
    res.json({ success: true, game: updatedGame });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/transaction/create", authenticate, async (req, res) => {
  try {
    const { userId, gameId, resultType, amount } = req.body;
    if (!userId || !gameId || !resultType || typeof amount !== "number") {
      return res
        .status(400)
        .json({ error: "userId, gameId, resultType, and amount are required" });
    }
    const transaction = await GameService.createResultTransaction(
      userId,
      gameId,
      resultType,
      amount
    );
    res.json({ success: true, transaction });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
