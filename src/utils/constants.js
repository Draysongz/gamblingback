export const GAME_TYPES = {
  SLOTS: "slots",
  BLACKJACK: "blackjack",
  ROULETTE: "roulette",
  POKER: "poker",
};

export const GAME_MODES = {
  SINGLE: "single",
  MULTIPLAYER: "multiplayer",
};

export const GAME_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export const ROOM_STATUS = {
  WAITING: "waiting",
  ACTIVE: "active",
  FULL: "full",
  CLOSED: "closed",
};

export const TRANSACTION_TYPES = {
  PURCHASE_CHIPS: "purchase_chips",
  CASHOUT_CHIPS: "cashout_chips",
  BET: "bet",
  WIN: "win",
  REFUND: "refund",
};

export const TRANSACTION_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export const CURRENCIES = {
  BROKECOIN: "brokecoin",
  CHIPS: "chips",
};

export const ERROR_MESSAGES = {
  INSUFFICIENT_BALANCE: "Insufficient balance",
  INVALID_BET_AMOUNT: "Invalid bet amount",
  GAME_NOT_FOUND: "Game not found",
  ROOM_NOT_FOUND: "Room not found",
  ROOM_FULL: "Room is full",
  USER_NOT_FOUND: "User not found",
  INVALID_TOKEN: "Invalid token",
  TOKEN_EXPIRED: "Token expired",
  WALLET_NOT_CONNECTED: "Wallet not connected",
  ADMIN_AUTH_REQUIRED: "Admin authentication required",
  INVALID_ADMIN_API_KEY: "Invalid admin API key",
  ADMIN_NOT_FOUND: "Admin not found",
  TASK_NOT_FOUND: "Task not found",
  INVALID_TASK_STATUS: "Invalid task status",
  INVALID_TASK_PRIORITY: "Invalid task priority",
  FILE_UPLOAD_FAILED: "File upload failed",
  INVALID_FILE_TYPE: "Invalid file type",
  FILE_SIZE_EXCEEDED: "File size exceeded",
  TRANSACTION_NOT_FOUND: "Transaction not found",
  USERNAME_EXISTS: "Username already exists",
  WALLET_EXISTS: "Wallet address already exists",
  INVALID_CREDENTIALS: "Invalid credentials",
  UNAUTHORIZED: "Unauthorized access",
  INVALID_REQUEST: "Invalid request",
  SERVER_ERROR: "Server error",
};

export const SUCCESS_MESSAGES = {
  GAME_STARTED: "Game started successfully",
  BET_PLACED: "Bet placed successfully",
  GAME_COMPLETED: "Game completed successfully",
  ROOM_JOINED: "Successfully joined room",
  ROOM_LEFT: "Successfully left room",
  CHIPS_PURCHASED: "Chips purchased successfully",
  CHIPS_CASHED_OUT: "Chips cashed out successfully",
};

export const TASK_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export const TASK_PRIORITY = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  URGENT: "urgent",
};

export const ADMIN_ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  MODERATOR: "moderator",
};

export const POKER_WS_MESSAGES = {
  PLAYER_JOINED: "player_joined",
  PLAYER_LEFT: "player_left",
  GAME_STARTED: "game_started",
  PLAYER_ACTION: "player_action",
  PHASE_CHANGE: "phase_change",
  SHOWDOWN: "showdown",
  GAME_ENDED: "game_ended",
};
