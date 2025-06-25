import Redis from "ioredis";
import { logger } from "../utils/logger.js";
import config from "../config/config.js";
import { GAME_TYPES, GAME_STATUS } from "../utils/constants.js";

class RedisService {
  constructor() {
    // Parse Upstash URL if provided
    let redisConfig = {};
    if (config.redis.url) {
      const url = new URL(config.redis.url);
      redisConfig = {
        host: url.hostname,
        port: url.port,
        username: url.username,
        password: url.password,
        tls: {
          rejectUnauthorized: false,
        },
        retryStrategy: (times) => {
          const delay = Math.min(times * 1000, 5000);
          console.log(`Redis retry attempt ${times} with delay ${delay}ms`);
          return delay;
        },
        maxRetriesPerRequest: 1, // Reduce retries for faster failure
        enableReadyCheck: false, // Disable ready check for Upstash
        connectTimeout: 5000, // Reduce timeout
        commandTimeout: 3000, // Reduce command timeout
        keepAlive: 5000, // Reduce keepalive
        family: 0, // IPv4
        db: 0,
        lazyConnect: true, // Don't connect immediately
        showFriendlyErrorStack: true,
      };
    } else {
      // Fallback to individual config parameters
      redisConfig = {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        tls: {
          rejectUnauthorized: false,
        },
        retryStrategy: (times) => {
          const delay = Math.min(times * 1000, 5000);
          console.log(`Redis retry attempt ${times} with delay ${delay}ms`);
          return delay;
        },
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        connectTimeout: 5000,
        commandTimeout: 3000,
        keepAlive: 5000,
        family: 0,
        db: 0,
        lazyConnect: true,
        showFriendlyErrorStack: true,
      };
    }

    this.client = new Redis(redisConfig);
    this.subscribers = new Map();
    this.isConnected = false;

    this.client.on("error", (error) => {
      logger.error("Redis connection error:", error);
      this.isConnected = false;
    });

    this.client.on("connect", () => {
      console.log("Redis connected successfully");
      this.isConnected = true;
    });

    this.client.on("reconnecting", () => {
      console.log("Redis reconnecting...");
      this.isConnected = false;
    });

    this.client.on("ready", () => {
      console.log("Redis client ready");
      this.isConnected = true;
      // Initialize game-specific keys after connection is ready
      this.initializeGameKeys().catch((error) => {
        logger.error("Error initializing game keys:", error);
      });
    });

    // Connect immediately
    this.client.connect().catch((error) => {
      logger.error("Error connecting to Redis:", error);
    });
  }

  async initializeGameKeys() {
    try {
      // Initialize game type sets
      for (const gameType of Object.values(GAME_TYPES)) {
        await this.client.sadd("game_types", gameType);
      }

      // Initialize game status sets
      for (const status of Object.values(GAME_STATUS)) {
        await this.client.sadd("game_statuses", status);
      }
    } catch (error) {
      logger.error("Error initializing game keys:", error);
    }
  }

  // Game Room Management
  async setGameRoom(roomId, roomData) {
    try {
      const key = `room:${roomId}`;
      await this.client.hmset(key, {
        ...roomData,
        lastUpdated: Date.now(),
      });
      await this.client.expire(key, 3600); // 1 hour expiry

      // Add to game type index
      await this.client.sadd(`rooms:${roomData.game_type}`, roomId);
      // Add to status index
      await this.client.sadd(`rooms:${roomData.status}`, roomId);
    } catch (error) {
      logger.error("Error setting game room:", error);
      throw error;
    }
  }

  async getGameRoom(roomId) {
    try {
      const key = `room:${roomId}`;
      const room = await this.client.hgetall(key);
      return room;
    } catch (error) {
      logger.error("Error getting game room:", error);
      throw error;
    }
  }

  async removeGameRoom(roomId) {
    try {
      const key = `room:${roomId}`;
      const room = await this.getGameRoom(roomId);

      if (room) {
        // Remove from indexes
        await this.client.srem(`rooms:${room.game_type}`, roomId);
        await this.client.srem(`rooms:${room.status}`, roomId);
      }

      await this.client.del(key);
    } catch (error) {
      logger.error("Error removing game room:", error);
      throw error;
    }
  }

  // Player Session Management
  async setPlayerSession(playerId, sessionData) {
    try {
      const key = `player:${playerId}`;
      await this.client.hmset(key, {
        ...sessionData,
        lastActive: Date.now(),
      });
      await this.client.expire(key, 86400); // 24 hours expiry

      // Add to online players set
      await this.client.sadd("online_players", playerId);
    } catch (error) {
      logger.error("Error setting player session:", error);
      throw error;
    }
  }

  async getPlayerSession(playerId) {
    try {
      const key = `player:${playerId}`;
      const session = await this.client.hgetall(key);
      return session;
    } catch (error) {
      logger.error("Error getting player session:", error);
      throw error;
    }
  }

  async removePlayerSession(playerId) {
    try {
      const key = `player:${playerId}`;
      await this.client.del(key);
      await this.client.srem("online_players", playerId);
    } catch (error) {
      logger.error("Error removing player session:", error);
      throw error;
    }
  }

  // Game State Management
  async setGameState(gameId, state) {
    try {
      const key = `game:${gameId}`;

      // Convert objects to JSON strings
      const redisState = {
        ...state,
        players: JSON.stringify(state.players),
        bets: JSON.stringify(state.bets),
        phaseEndTime: state.phaseEndTime?.toString(),
        createdAt: state.createdAt?.toString(),
        currentRound: state.currentRound?.toString(),
        winningNumber: state.winningNumber?.toString(),
        betAmount: state.betAmount?.toString(),
        maxPlayers: state.maxPlayers?.toString(),
      };

      await this.client.hmset(key, {
        ...redisState,
        lastUpdated: Date.now().toString(),
      });
      await this.client.expire(key, 1800); // 30 minutes expiry

      // Add to game type index if game_type exists
      if (state.game_type) {
        await this.client.sadd(`games:${state.game_type}`, gameId);
      }
      // Add to status index if status exists
      if (state.status) {
        await this.client.sadd(`games:${state.status}`, gameId);
      }
    } catch (error) {
      logger.error("Error setting game state:", error);
      throw error;
    }
  }

  async getGameState(gameId) {
    try {
      const key = `game:${gameId}`;
      const state = await this.client.hgetall(key);

      if (!state || Object.keys(state).length === 0) {
        logger.error(`No game state found for game ${gameId}`);
        return null;
      }

      // Parse JSON fields
      const parsedState = {
        ...state,
        players: state.players ? JSON.parse(state.players) : [],
        bets: state.bets ? JSON.parse(state.bets) : {},
        phaseEndTime: state.phaseEndTime ? parseInt(state.phaseEndTime) : null,
        createdAt: state.createdAt ? parseInt(state.createdAt) : Date.now(),
        currentRound: state.currentRound ? parseInt(state.currentRound) : 0,
        winningNumber: state.winningNumber
          ? parseInt(state.winningNumber)
          : null,
        betAmount: state.betAmount ? parseInt(state.betAmount) : 0,
        maxPlayers: state.maxPlayers ? parseInt(state.maxPlayers) : 0,
      };

      return parsedState;
    } catch (error) {
      logger.error("Error getting game state:", error);
      throw error;
    }
  }

  // Game Statistics
  async incrementGameStats(gameType, stat, value = 1) {
    try {
      const key = `stats:${gameType}`;
      await this.client.hincrby(key, stat, value);
      await this.client.expire(key, 86400); // 24 hours expiry
    } catch (error) {
      logger.error("Error incrementing game stats:", error);
      throw error;
    }
  }

  async getGameStats(gameType) {
    try {
      const key = `stats:${gameType}`;
      return await this.client.hgetall(key);
    } catch (error) {
      logger.error("Error getting game stats:", error);
      throw error;
    }
  }

  // Player Statistics
  async updatePlayerStats(playerId, gameType, stats) {
    try {
      const key = `player_stats:${playerId}:${gameType}`;
      await this.client.hmset(key, stats);
      await this.client.expire(key, 86400); // 24 hours expiry
    } catch (error) {
      logger.error("Error updating player stats:", error);
      throw error;
    }
  }

  async getPlayerStats(playerId, gameType) {
    try {
      const key = `player_stats:${playerId}:${gameType}`;
      return await this.client.hgetall(key);
    } catch (error) {
      logger.error("Error getting player stats:", error);
      throw error;
    }
  }

  // Caching
  async setCache(key, value, expiry = 300) {
    try {
      await this.client.set(key, JSON.stringify(value), "EX", expiry);
    } catch (error) {
      logger.error("Error setting cache:", error);
      throw error;
    }
  }

  async getCache(key) {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error("Error getting cache:", error);
      throw error;
    }
  }

  // Rate Limiting
  async incrementRateLimit(key, window) {
    try {
      const current = await this.client.incr(key);
      if (current === 1) {
        await this.client.expire(key, window);
      }
      return current;
    } catch (error) {
      logger.error("Error incrementing rate limit:", error);
      throw error;
    }
  }

  async getRateLimit(key) {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error("Error getting rate limit:", error);
      throw error;
    }
  }

  // Leaderboard Management
  async updateLeaderboard(gameType, playerId, score) {
    try {
      const key = `leaderboard:${gameType}`;
      await this.client.zadd(key, score, playerId);
      await this.client.expire(key, 86400); // 24 hours expiry
    } catch (error) {
      logger.error("Error updating leaderboard:", error);
      throw error;
    }
  }

  async getLeaderboard(gameType, start = 0, end = 9) {
    try {
      const key = `leaderboard:${gameType}`;
      return await this.client.zrevrange(key, start, end, "WITHSCORES");
    } catch (error) {
      logger.error("Error getting leaderboard:", error);
      throw error;
    }
  }

  // Pub/Sub for real-time updates
  async publish(channel, message) {
    try {
      if (!this.isConnected) {
        throw new Error("Redis client not connected");
      }
      await this.client.publish(channel, JSON.stringify(message));
    } catch (error) {
      logger.error("Error publishing message:", error);
      throw error;
    }
  }

  async subscribe(channel, callback) {
    try {
      // Check if we already have a subscriber for this channel
      if (this.subscribers.has(channel)) {
        const existingSubscriber = this.subscribers.get(channel);
        existingSubscriber.callbacks.push(callback);
        return existingSubscriber.subscriber;
      }

      const subscriber = new Redis({
        ...this.client.options,
        lazyConnect: true,
      });

      await subscriber.connect();
      await subscriber.subscribe(channel);

      // Store subscriber and its callbacks
      this.subscribers.set(channel, {
        subscriber,
        callbacks: [callback],
      });

      subscriber.on("message", (ch, message) => {
        if (ch === channel) {
          const callbacks = this.subscribers.get(channel)?.callbacks || [];
          callbacks.forEach((cb) => {
            try {
              cb(JSON.parse(message));
            } catch (error) {
              logger.error(
                `Error in subscriber callback for channel ${channel}:`,
                error
              );
            }
          });
        }
      });

      subscriber.on("error", (error) => {
        logger.error(`Redis subscriber error for channel ${channel}:`, error);
      });

      return subscriber;
    } catch (error) {
      logger.error("Error subscribing to channel:", error);
      throw error;
    }
  }

  // Cleanup
  async cleanup() {
    try {
      // Clean up all subscribers
      for (const [channel, { subscriber }] of this.subscribers.entries()) {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      }
      this.subscribers.clear();

      // Clean up main client
      await this.client.quit();
    } catch (error) {
      logger.error("Error cleaning up Redis connection:", error);
      throw error;
    }
  }

  // Game History
  async addGameHistory(gameId, gameData) {
    try {
      const key = `history:${gameId}`;
      await this.client.hmset(key, {
        ...gameData,
        timestamp: Date.now(),
      });
      await this.client.expire(key, 604800); // 7 days expiry

      // Add to player histories
      if (gameData.players) {
        for (const playerId of gameData.players) {
          await this.client.lpush(`player_history:${playerId}`, gameId);
          await this.client.ltrim(`player_history:${playerId}`, 0, 99); // Keep last 100 games
        }
      }
    } catch (error) {
      logger.error("Error adding game history:", error);
      throw error;
    }
  }

  async getGameHistory(gameId) {
    try {
      const key = `history:${gameId}`;
      return await this.client.hgetall(key);
    } catch (error) {
      logger.error("Error getting game history:", error);
      throw error;
    }
  }

  async getPlayerGameHistory(playerId, start = 0, end = 9) {
    try {
      const gameIds = await this.client.lrange(
        `player_history:${playerId}`,
        start,
        end
      );
      const histories = await Promise.all(
        gameIds.map(async (gameId) => this.getGameHistory(gameId))
      );
      return histories.filter(Boolean);
    } catch (error) {
      logger.error("Error getting player game history:", error);
      throw error;
    }
  }

  // Achievements
  async updateAchievement(playerId, achievementId, progress) {
    try {
      const key = `achievements:${playerId}`;
      await this.client.hset(key, achievementId, progress);
      await this.client.expire(key, 2592000); // 30 days expiry

      // If achievement is completed, add to completed achievements
      if (progress >= 100) {
        await this.client.sadd(
          `completed_achievements:${playerId}`,
          achievementId
        );
      }
    } catch (error) {
      logger.error("Error updating achievement:", error);
      throw error;
    }
  }

  async getPlayerAchievements(playerId) {
    try {
      const key = `achievements:${playerId}`;
      const achievements = await this.client.hgetall(key);
      const completed = await this.client.smembers(
        `completed_achievements:${playerId}`
      );
      return { achievements, completed };
    } catch (error) {
      logger.error("Error getting player achievements:", error);
      throw error;
    }
  }

  // Matchmaking
  async addToMatchmakingQueue(playerId, gameType, preferences) {
    try {
      const key = `matchmaking:${gameType}`;
      await this.client.zadd(
        key,
        Date.now(),
        JSON.stringify({
          playerId,
          preferences,
          timestamp: Date.now(),
        })
      );
      await this.client.expire(key, 300); // 5 minutes expiry
    } catch (error) {
      logger.error("Error adding to matchmaking queue:", error);
      throw error;
    }
  }

  async removeFromMatchmakingQueue(playerId, gameType) {
    try {
      const key = `matchmaking:${gameType}`;
      const queue = await this.client.zrange(key, 0, -1);
      for (const entry of queue) {
        const data = JSON.parse(entry);
        if (data.playerId === playerId) {
          await this.client.zrem(key, entry);
          break;
        }
      }
    } catch (error) {
      logger.error("Error removing from matchmaking queue:", error);
      throw error;
    }
  }

  async findMatch(gameType, maxWaitTime = 30000) {
    try {
      const key = `matchmaking:${gameType}`;
      const queue = await this.client.zrange(key, 0, -1);
      const matches = [];

      for (const entry of queue) {
        const data = JSON.parse(entry);
        if (Date.now() - data.timestamp > maxWaitTime) {
          // Remove stale entries
          await this.client.zrem(key, entry);
          continue;
        }
        matches.push(data);
      }

      return matches;
    } catch (error) {
      logger.error("Error finding match:", error);
      throw error;
    }
  }

  // Game Notifications
  async addNotification(playerId, notification) {
    try {
      const key = `notifications:${playerId}`;
      await this.client.lpush(
        key,
        JSON.stringify({
          ...notification,
          timestamp: Date.now(),
        })
      );
      await this.client.ltrim(key, 0, 99); // Keep last 100 notifications
      await this.client.expire(key, 604800); // 7 days expiry
    } catch (error) {
      logger.error("Error adding notification:", error);
      throw error;
    }
  }

  async getNotifications(playerId, start = 0, end = 9) {
    try {
      const key = `notifications:${playerId}`;
      const notifications = await this.client.lrange(key, start, end);
      return notifications.map((n) => JSON.parse(n));
    } catch (error) {
      logger.error("Error getting notifications:", error);
      throw error;
    }
  }

  async markNotificationRead(playerId, notificationId) {
    try {
      const key = `notifications:${playerId}`;
      const notifications = await this.client.lrange(key, 0, -1);
      for (const notification of notifications) {
        const data = JSON.parse(notification);
        if (data.id === notificationId) {
          data.read = true;
          await this.client.lrem(key, 0, notification);
          await this.client.lpush(key, JSON.stringify(data));
          break;
        }
      }
    } catch (error) {
      logger.error("Error marking notification as read:", error);
      throw error;
    }
  }

  // Game Analytics
  async trackGameEvent(eventType, data) {
    try {
      const key = `analytics:${eventType}:${Date.now()}`;
      await this.client.hmset(key, {
        ...data,
        timestamp: Date.now(),
      });
      await this.client.expire(key, 2592000); // 30 days expiry
    } catch (error) {
      logger.error("Error tracking game event:", error);
      throw error;
    }
  }

  async getGameAnalytics(eventType, startTime, endTime) {
    try {
      const pattern = `analytics:${eventType}:*`;
      const keys = await this.client.keys(pattern);
      const events = [];

      for (const key of keys) {
        const timestamp = parseInt(key.split(":")[2]);
        if (timestamp >= startTime && timestamp <= endTime) {
          const data = await this.client.hgetall(key);
          events.push(data);
        }
      }

      return events;
    } catch (error) {
      logger.error("Error getting game analytics:", error);
      throw error;
    }
  }
}

export default new RedisService();
