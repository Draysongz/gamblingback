import winston from "winston";
import config from "../config/config.js";

// Define log format
const logFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
  level: config.env === "development" ? "debug" : "info",
  format: logFormat,
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
    }),
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

// If we're not in production, also log to the console
if (config.env !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

// Create a stream object for Morgan
const stream = {
  write: (message) => {
    console.log(message.trim());
  },
};

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Logging middleware
const loggingMiddleware = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log({
      method: req.method,
      url: req.url,
      status: res.statusCode,
    });
  });
  next();
};

export { logger, stream, loggingMiddleware, levels };
