import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { authenticate, optionalAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import config from "../config/config.js";
import { logger } from "../utils/logger.js";
import validate from "../middleware/validation.js";
import Joi from "joi";

const router = express.Router();

// Validation schemas
const userSchemas = {
  register: Joi.object({
    username: Joi.string().min(3).max(30).required(),
    password: Joi.string().min(6).required(),
    walletAddress: Joi.string().required(),
  }),
  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
  }),
  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),
  updateProfile: Joi.object({
    username: Joi.string().min(3).max(30),
    avatar: Joi.string().uri(),
    chips_balance: Joi.number().min(0),
  }),
};

// Helper function to format user response consistently
const formatUserResponse = (user) => ({
  id: user.id,
  username: user.username,
  walletAddress: user.wallet_address,
  brokecoinBalance: user.brokecoin_balance,
  chipsBalance: user.chips_balance, // ✅ Always map to camelCase
  createdAt: user.created_at,
});

// Register new user
router.post(
  "/register",
  validate(userSchemas.register),
  async (req, res, next) => {
    try {
      const { username, password, walletAddress } = req.body;

      // Create user
      const user = await User.createUser(username, password, walletAddress);

      // Generate tokens
      const token = jwt.sign({ id: user.id }, config.jwt.secret, {
        expiresIn: `${config.jwt.accessExpirationMinutes}m`,
      });

      const refreshToken = jwt.sign({ id: user.id }, config.jwt.secret, {
        expiresIn: `${config.jwt.refreshExpirationDays}d`,
      });

      console.log(`New user registered: ${username}`);
      res.status(201).json({
        user: formatUserResponse(user), // ✅ Consistent formatting
        token,
        refreshToken,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Login user
router.post("/login", validate(userSchemas.login), async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Authenticate user
    const user = await User.authenticate(username, password);

    // Generate tokens
    const token = jwt.sign({ id: user.id }, config.jwt.secret, {
      expiresIn: `${config.jwt.accessExpirationMinutes}m`,
    });

    const refreshToken = jwt.sign({ id: user.id }, config.jwt.secret, {
      expiresIn: `${config.jwt.refreshExpirationDays}d`,
    });

    console.log(`User logged in: ${username}`);
    res.json({
      user: formatUserResponse(user), // ✅ Consistent formatting
      token,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post(
  "/refresh-token",
  validate(userSchemas.refreshToken),
  async (req, res, next) => {
    try {
      const { refreshToken } = req.body;

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, config.jwt.secret);

      // Get user from database
      const user = await User.getUser(decoded.id);
      if (!user) {
        throw new AppError("User not found", 401);
      }

      // Generate new tokens
      const token = jwt.sign({ id: user.id }, config.jwt.secret, {
        expiresIn: `${config.jwt.accessExpirationMinutes}m`,
      });

      const newRefreshToken = jwt.sign({ id: user.id }, config.jwt.secret, {
        expiresIn: `${config.jwt.refreshExpirationDays}d`,
      });

      console.log(`Token refreshed for user: ${user.username}`);
      res.json({
        token,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      if (error.name === "JsonWebTokenError") {
        next(new AppError("Invalid refresh token", 401));
      } else if (error.name === "TokenExpiredError") {
        next(new AppError("Refresh token expired", 401));
      } else {
        next(error);
      }
    }
  }
);

// Get user profile
router.get("/profile", authenticate, async (req, res, next) => {
  try {
    const user = await User.getUser(req.user.id);
    res.json(formatUserResponse(user)); // ✅ Consistent formatting
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.patch(
  "/profile",
  authenticate,
  validate(userSchemas.updateProfile),
  async (req, res, next) => {
    try {
      const { username, avatar, chips_balance } = req.body;

      let user;

      // If chips_balance is provided, use updateBalance
      if (chips_balance !== undefined) {
        const currentUser = await User.getUser(req.user.id);
        const chipsDelta = chips_balance - currentUser.chips_balance;
        user = await User.updateBalance(req.user.id, { chipsDelta });
      } else {
        // Otherwise update profile normally
        user = await User.updateProfile(req.user.id, {
          username,
          avatar,
        });
      }

      // Return consistently formatted user profile
      res.json(formatUserResponse(user)); // ✅ Consistent formatting
    } catch (error) {
      next(error);
    }
  }
);

// Get user stats
router.get("/stats", authenticate, async (req, res, next) => {
  try {
    const stats = await User.getUserStats(req.user.id);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get leaderboard
router.get("/leaderboard", optionalAuth, async (req, res, next) => {
  try {
    const leaderboard = await User.getLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    next(error);
  }
});

export default router;
