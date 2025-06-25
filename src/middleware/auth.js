import jwt from "jsonwebtoken";
import { AppError } from "./errorHandler.js";
import User from "../models/user.js";
import config from "../config/config.js";
import { supabase } from "../db/supabase.js";
import { logger } from "../utils/logger.js";
import { ERROR_MESSAGES } from "../utils/constants.js";

export const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("No token provided", 401);
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Get user from database
    const user = await User.getUser(decoded.id);
    if (!user) {
      throw new AppError("User not found", 401);
    }

    // Check if user's wallet is still valid
    if (!user.wallet_address) {
      throw new AppError("Wallet not connected", 401);
    }

    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      next(new AppError("Invalid token", 401));
    } else if (error.name === "TokenExpiredError") {
      next(new AppError("Token expired", 401));
    } else {
      next(error);
    }
  }
};

// Optional authentication - doesn't throw error if no token
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = await User.getUser(decoded.id);

    if (user) {
      req.user = user;
    }
    next();
  } catch (error) {
    // Just continue without user if token is invalid
    next();
  }
};

// Admin authentication
export const validateAdminAccess = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: ERROR_MESSAGES.ADMIN_AUTH_REQUIRED });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Get admin from database
    const { data: admin, error } = await supabase
      .from("admins")
      .select("id, username, email, role")
      .eq("id", decoded.id)
      .single();

    if (error || !admin) {
      return res.status(401).json({ error: ERROR_MESSAGES.ADMIN_NOT_FOUND });
    }

    // Attach admin info to request
    req.admin = admin;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    } else if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    logger.error(`Error in validateAdminAccess: ${error.message}`);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
};
