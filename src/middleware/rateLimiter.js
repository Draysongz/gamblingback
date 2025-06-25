import rateLimit from "express-rate-limit";

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: (req) => {
    return req.ip; // Use IP address as the key
  }
});

// Stricter limiter for game actions
export const gameActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 30 requests per windowMs
  message: "Too many game actions from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: (req) => {
    return req.ip; // Use IP address as the key
  }
});

// Stricter limiter for wallet actions
export const walletActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 10 requests per windowMs
  message: "Too many wallet actions from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: (req) => {
    return req.ip; // Use IP address as the key
  }
});
