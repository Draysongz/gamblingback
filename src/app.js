import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import config from "./config/config.js";
import { stream, loggingMiddleware } from "./utils/logger.js";
import {
  apiLimiter,
  gameActionLimiter,
  walletActionLimiter,
} from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import gameRoutes from "./routes/game.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import userRoutes from "./routes/user.routes.js";
import adminAuthRoutes from "./routes/adminAuth.js";
import adminRoutes from "./routes/admin.js";
import TaskRoutes from "./routes/tasks.routes.js";
import MultiplayeRoutes from "./routes/roulette.routes.js";
import pokerRoutes from "./routes/poker.routes.js";
import { createServer } from "http";
import dotenv from "dotenv";
import webSocketService from "./services/WebSocketService.js";
import { logger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, "../.env") });

// Create logs directory if it doesn't exist
const logsDir = join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const app = express();
const httpServer = createServer(app);

// Trust proxy - important for rate limiting behind a proxy
app.set("trust proxy", 1);

// Initialize WebSocket service
webSocketService.initialize(httpServer);

// Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
  })
); // Security headers with adjusted CORS settings
app.use(
  cors({
    origin: true, // Allow all origins in development
    credentials: true, // Allow credentials
  })
); // Enable CORS
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Logging
app.use(morgan("combined", { stream }));
app.use(loggingMiddleware);

// Rate Limiting - Apply to specific routes only
app.use("/api/users/register", apiLimiter);
app.use("/api/users/login", apiLimiter);
app.use("/api/games/", gameActionLimiter);
app.use("/api/wallet/", walletActionLimiter);
app.use("/api/multiplayer-roulette", MultiplayeRoutes);

// Routes
app.use("/api/games", gameRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tasks", TaskRoutes);
app.use("/api/poker", pokerRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    environment: config.env,
    timestamp: new Date().toISOString(),
  });
});

// Error handling
app.use(errorHandler);

// Handle 404 routes
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: `Can't find ${req.originalUrl} on this server!`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
