#!/usr/bin/env node

import Redis from "ioredis";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, "../.env") });

class RedisClearer {
  constructor() {
    this.client = null;
    this.clearedKeys = [];
    this.clearedPatterns = [];
  }

  async connect() {
    try {
      let redisConfig = {};

      if (process.env.REDIS_URL) {
        const url = new URL(process.env.REDIS_URL);
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
      } else {
        redisConfig = {
          host: process.env.REDIS_HOST || "localhost",
          port: process.env.REDIS_PORT || 6379,
          password: process.env.REDIS_PASSWORD,
          tls: {
            rejectUnauthorized: false,
          },
          retryStrategy: (times) => {
            const delay = Math.min(times * 1000, 5000);
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

      this.client.on("error", (error) => {
        console.error("Redis connection error:", error);
      });

      this.client.on("connect", () => {
        console.log("✅ Connected to Redis successfully");
      });

      await this.client.connect();
      return true;
    } catch (error) {
      console.error("❌ Failed to connect to Redis:", error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      console.log("🔌 Disconnected from Redis");
    }
  }

  async clearAll() {
    console.log("🧹 Starting Redis data clearing process...");

    try {
      // Clear all keys (nuclear option)
      const allKeys = await this.client.keys("*");
      if (allKeys.length > 0) {
        await this.client.del(...allKeys);
        console.log(`🗑️  Cleared all ${allKeys.length} keys from Redis`);
        this.clearedKeys.push(...allKeys);
      } else {
        console.log("ℹ️  No keys found in Redis");
      }
    } catch (error) {
      console.error("❌ Error clearing all keys:", error.message);
    }
  }

  async clearGameData() {
    console.log("🎮 Clearing game-specific data...");

    try {
      // Game room patterns
      const gamePatterns = [
        "room:*",
        "poker:room:*",
        "game:*",
        "player:*",
        "online_players",
        "rooms:*",
        "game_types",
        "game_statuses",
        "game_stats:*",
        "player_stats:*",
        "leaderboard:*",
        "matchmaking:*",
        "notifications:*",
        "achievements:*",
        "game_history:*",
        "analytics:*",
        "rate_limit:*",
        "cache:*",
        "session:*",
        "presence:*",
        "chat:*",
        "invite:*",
        "ready:*",
      ];

      for (const pattern of gamePatterns) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(...keys);
          console.log(
            `🗑️  Cleared ${keys.length} keys matching pattern: ${pattern}`
          );
          this.clearedPatterns.push({ pattern, count: keys.length });
        }
      }
    } catch (error) {
      console.error("❌ Error clearing game data:", error.message);
    }
  }

  async clearPokerData() {
    console.log("🃏 Clearing poker-specific data...");

    try {
      const pokerPatterns = [
        "poker:room:*",
        "poker:rooms",
        "poker:player:*",
        "poker:game:*",
        "poker:deck:*",
        "poker:bet:*",
        "poker:action:*",
      ];

      for (const pattern of pokerPatterns) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(...keys);
          console.log(
            `🗑️  Cleared ${keys.length} keys matching pattern: ${pattern}`
          );
          this.clearedPatterns.push({ pattern, count: keys.length });
        }
      }
    } catch (error) {
      console.error("❌ Error clearing poker data:", error.message);
    }
  }

  async clearUserSessions() {
    console.log("👤 Clearing user sessions...");

    try {
      const sessionPatterns = [
        "player:*",
        "session:*",
        "online_players",
        "presence:*",
      ];

      for (const pattern of sessionPatterns) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(...keys);
          console.log(
            `🗑️  Cleared ${keys.length} keys matching pattern: ${pattern}`
          );
          this.clearedPatterns.push({ pattern, count: keys.length });
        }
      }
    } catch (error) {
      console.error("❌ Error clearing user sessions:", error.message);
    }
  }

  async showCurrentData() {
    console.log("📊 Current Redis data summary:");

    try {
      const allKeys = await this.client.keys("*");
      console.log(`Total keys in Redis: ${allKeys.length}`);

      if (allKeys.length > 0) {
        const keyTypes = {};
        allKeys.forEach((key) => {
          const prefix = key.split(":")[0];
          keyTypes[prefix] = (keyTypes[prefix] || 0) + 1;
        });

        console.log("Key types breakdown:");
        Object.entries(keyTypes).forEach(([type, count]) => {
          console.log(`  ${type}: ${count} keys`);
        });
      }
    } catch (error) {
      console.error("❌ Error getting current data:", error.message);
    }
  }

  async showClearedSummary() {
    console.log("\n📋 Clearing Summary:");
    console.log(`Total keys cleared: ${this.clearedKeys.length}`);
    console.log(`Patterns cleared: ${this.clearedPatterns.length}`);

    if (this.clearedPatterns.length > 0) {
      console.log("Patterns cleared:");
      this.clearedPatterns.forEach(({ pattern, count }) => {
        console.log(`  ${pattern}: ${count} keys`);
      });
    }
  }
}

async function main() {
  const clearer = new RedisClearer();

  // Parse command line arguments
  const args = process.argv.slice(2);
  const command = args[0] || "all";

  console.log("🚀 Redis Data Clearer");
  console.log("=====================");

  // Connect to Redis
  const connected = await clearer.connect();
  if (!connected) {
    process.exit(1);
  }

  try {
    switch (command) {
      case "all":
        console.log("🗑️  Clearing ALL Redis data...");
        await clearer.clearAll();
        break;

      case "games":
        console.log("🎮 Clearing game data only...");
        await clearer.clearGameData();
        break;

      case "poker":
        console.log("🃏 Clearing poker data only...");
        await clearer.clearPokerData();
        break;

      case "sessions":
        console.log("👤 Clearing user sessions only...");
        await clearer.clearUserSessions();
        break;

      case "status":
        console.log("📊 Showing current Redis data...");
        await clearer.showCurrentData();
        break;

      default:
        console.log("❌ Unknown command. Available commands:");
        console.log("  all      - Clear all Redis data");
        console.log("  games    - Clear game data only");
        console.log("  poker    - Clear poker data only");
        console.log("  sessions - Clear user sessions only");
        console.log("  status   - Show current Redis data");
        break;
    }

    if (command !== "status") {
      await clearer.showClearedSummary();
    }
  } catch (error) {
    console.error("❌ Error during clearing process:", error.message);
  } finally {
    await clearer.disconnect();
  }
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, cleaning up...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, cleaning up...");
  process.exit(0);
});

// Run the script
main().catch(console.error);
