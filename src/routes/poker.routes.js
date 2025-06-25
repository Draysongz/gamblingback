import express from "express";
import catchAsync from "../utils/catchAsync.js";
import { authenticate } from "../middleware/auth.js";
import EnhancedPokerService from "../services/EnhancedPokerService.js";

const router = express.Router();

// Initialize enhanced poker service
const pokerService = new EnhancedPokerService();

// Get available rooms
router.get(
  "/rooms",
  authenticate,
  catchAsync(async (req, res) => {
    const rooms = await pokerService.getAvailableRooms();
    res.json({
      success: true,
      rooms: rooms,
    });
  })
);

// Get room details
router.get(
  "/rooms/:roomId",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const room = await pokerService.getRoom(roomId);
    res.json({
      success: true,
      room: room,
    });
  })
);

// Create a new room
router.post(
  "/create",
  authenticate,
  catchAsync(async (req, res) => {
    const { name, maxPlayers = 6, minBet = 10, maxBet = 1000 } = req.body;
    const creatorId = req.user.id;

    const room = await pokerService.createRoom({
      name: name || `Room ${Date.now()}`,
      creatorId,
      maxPlayers,
      minBet,
      maxBet,
    });

    res.json({
      success: true,
      id: room.id,
      room: room,
    });
  })
);

// Join a room
router.post(
  "/:roomId/join",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const playerId = req.user.id;
    const username = req.user.username;

    const room = await pokerService.joinRoom(roomId, playerId, username);

    res.json({
      success: true,
      id: roomId,
      room: room,
    });
  })
);

// Leave a room
router.post(
  "/:roomId/leave",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const playerId = req.user.id;

    await pokerService.leaveRoom(roomId, playerId);

    res.json({
      success: true,
      message: "Left room successfully",
    });
  })
);

// Get room state
router.get(
  "/:roomId",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const room = await pokerService.getRoom(roomId);

    res.json({
      success: true,
      room: room,
    });
  })
);

// Start game
router.post(
  "/:roomId/start",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const playerId = req.user.id;

    const room = await pokerService.startGame(roomId, playerId);

    res.json({
      success: true,
      room: room,
    });
  })
);

// Player action
router.post(
  "/:roomId/action",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const { action, amount } = req.body;
    const playerId = req.user.id;

    const room = await pokerService.playerAction(
      roomId,
      playerId,
      action,
      amount
    );

    res.json({
      success: true,
      room: room,
    });
  })
);

// Next phase (for testing)
router.post(
  "/:roomId/next",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const playerId = req.user.id;

    const room = await pokerService.nextPhase(roomId, playerId);

    res.json({
      success: true,
      room: room,
    });
  })
);

// End game
router.post(
  "/:roomId/end",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId } = req.params;
    const playerId = req.user.id;

    const results = await pokerService.endGame(roomId, playerId);

    res.json({
      success: true,
      results: results,
    });
  })
);

export default router;
