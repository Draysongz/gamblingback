import express from "express";
import Joi from "joi";
import { joinRoom, createGame, endGame } from "../services/RouletteService.js";
import { authenticate } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

// ========== Joi Validation Schemas ==========

const joinRoomSchema = Joi.object({
  betAmount: Joi.number().positive().required(),
});

// ========== Routes ==========

// ✅ Join or Create Game
router.post("/join", authenticate, async (req, res) => {
  try {
    const { error, value } = joinRoomSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const userId = req.user.id;
    const { betAmount } = value;

    const result = await joinRoom(userId, betAmount);

    res.json({
      success: true,
      message: result.message,
      gameId: result.gameId || null,
      roomId: result.roomId,
    });
  } catch (err) {
    logger.error("Join/Create Room Error:", err);
    res.status(400).json({ error: err.message });
  }
});

// ✅ End Game (You might trigger this manually or via game timer logic)
router.post("/:gameId/end", authenticate, async (req, res) => {
  const { gameId } = req.params;
  if (!gameId) return res.status(400).json({ error: "Game ID is required" });

  try {
    // You can validate resultData structure here if needed
    const resultData = req.body.result || "spin result placeholder";

    const result = await endGame(gameId, resultData);

    res.json({ success: true, message: result.message });
  } catch (err) {
    logger.error("End Game Error:", err);
    res.status(400).json({ error: err.message });
  }
});

export default router