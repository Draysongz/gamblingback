import redisService from "../services/RedisService.js";
import { logger } from "../utils/logger.js";

// Helper function to add delay between operations
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testRedisConnection() {
  try {
    // Test 1: Basic Set/Get
    console.log("Test 1: Testing basic set/get operations...");
    await redisService.setCache("test:key", { message: "Hello Redis!" });
    await delay(500); // Add delay
    const result = await redisService.getCache("test:key");
    console.log("Basic set/get result:", result);
    await delay(500);

    // Test 2: Pub/Sub
    console.log("Test 2: Testing pub/sub functionality...");
    const testChannel = "test:channel";
    const testMessage = { type: "test", data: "Test message" };

    // Subscribe to channel
    const subscriber = await redisService.subscribe(testChannel, (message) => {
      console.log("Received message:", message);
    });
    await delay(500);

    // Publish message
    await redisService.publish(testChannel, testMessage);
    await delay(1000); // Wait for message to be received

    // Cleanup subscriber
    await subscriber.unsubscribe(testChannel);
    await subscriber.quit();
    await delay(500);

    // Test 3: Game Room Operations
    console.log("Test 3: Testing game room operations...");
    const roomId = "test:room:1";
    const roomData = {
      game_type: "slots",
      status: "waiting",
      players: ["player1", "player2"],
      created_at: Date.now(),
    };

    await redisService.setGameRoom(roomId, roomData);
    await delay(500);
    const room = await redisService.getGameRoom(roomId);
    console.log("Game room result:", room);
    await delay(500);

    // Test 4: Player Session
    console.log("Test 4: Testing player session...");
    const playerId = "test:player:1";
    const sessionData = {
      status: "online",
      lastActive: Date.now(),
      roomId: roomId,
    };

    await redisService.setPlayerSession(playerId, sessionData);
    await delay(500);
    const session = await redisService.getPlayerSession(playerId);
    console.log("Player session result:", session);
    await delay(500);

    // Test 5: Game History
    console.log("Test 5: Testing game history...");
    const gameId = "test:game:1";
    const gameData = {
      players: [playerId],
      result: "win",
      amount: 100,
      timestamp: Date.now(),
    };

    await redisService.addGameHistory(gameId, gameData);
    await delay(500);
    const history = await redisService.getGameHistory(gameId);
    console.log("Game history result:", history);
    await delay(500);

    // Test 6: Leaderboard
    console.log("Test 6: Testing leaderboard...");
    await redisService.updateLeaderboard("slots", playerId, 1000);
    await delay(500);
    const leaderboard = await redisService.getLeaderboard("slots");
    console.log("Leaderboard result:", leaderboard);
    await delay(500);

    // Test 7: Game Type Specific Tests
    console.log("Test 7: Testing different game types...");

    // Slots Game
    console.log("Testing Slots game...");
    const slotsRoom = "slots:room:1";
    await redisService.setGameRoom(slotsRoom, {
      game_type: "slots",
      status: "waiting",
      players: [],
      created_at: Date.now(),
      config: {
        min_bet: 10,
        max_bet: 1000,
        reels: 5,
        paylines: 20,
      },
    });
    await delay(500);

    // Blackjack Game
    console.log("Testing Blackjack game...");
    const blackjackRoom = "blackjack:room:1";
    await redisService.setGameRoom(blackjackRoom, {
      game_type: "blackjack",
      status: "waiting",
      players: [],
      created_at: Date.now(),
      config: {
        min_bet: 50,
        max_bet: 5000,
        decks: 6,
        max_players: 7,
      },
    });
    await delay(500);

    // Roulette Game
    console.log("Testing Roulette game...");
    const rouletteRoom = "roulette:room:1";
    await redisService.setGameRoom(rouletteRoom, {
      game_type: "roulette",
      status: "waiting",
      players: [],
      created_at: Date.now(),
      config: {
        min_bet: 20,
        max_bet: 2000,
        max_players: 8,
      },
    });
    await delay(500);

    // Test 8: Concurrent Player Actions
    console.log("Test 8: Testing concurrent player actions...");

    const concurrentPlayers = Array.from(
      { length: 5 },
      (_, i) => `player${i + 1}`
    );

    // Simulate concurrent joins with delays
    console.log("Testing concurrent player joins...");
    for (const player of concurrentPlayers) {
      await redisService.setPlayerSession(player, {
        status: "online",
        lastActive: Date.now(),
        balance: 1000,
      });
      await delay(200); // Add delay between each player
    }
    await delay(500);

    // Simulate concurrent bets with delays
    console.log("Testing concurrent bets...");
    for (const player of concurrentPlayers) {
      const bet = Math.floor(Math.random() * 100) + 10;
      await redisService.publish(`game:${player}`, {
        type: "place_bet",
        player,
        amount: bet,
        timestamp: Date.now(),
      });
      await delay(200); // Add delay between each bet
    }
    await delay(500);

    // Test 9: Cross-Room Matchmaking
    console.log("Test 9: Testing cross-room matchmaking...");

    // Create players with different preferences
    const matchmakingPlayers = [
      { id: "player1", game: "slots", minBet: 100, maxBet: 1000 },
      { id: "player2", game: "blackjack", minBet: 200, maxBet: 2000 },
      { id: "player3", game: "roulette", minBet: 50, maxBet: 500 },
    ];

    // Add players to matchmaking queues with delays
    for (const player of matchmakingPlayers) {
      await redisService.addToMatchmakingQueue(player.id, player.game, {
        min_bet: player.minBet,
        max_bet: player.maxBet,
      });
      await delay(200);
    }
    await delay(500);

    // Find matches for each game type
    const slotsMatches = await redisService.findMatch("slots");
    await delay(200);
    const blackjackMatches = await redisService.findMatch("blackjack");
    await delay(200);
    const rouletteMatches = await redisService.findMatch("roulette");
    await delay(200);

    console.log("Slots matches:", slotsMatches);
    console.log("Blackjack matches:", blackjackMatches);
    console.log("Roulette matches:", rouletteMatches);

    // Test 10: Real-time Chat and Room Communication
    console.log("Test 10: Testing real-time chat and room communication...");

    // Create chat rooms for each game
    const chatRooms = [slotsRoom, blackjackRoom, rouletteRoom];

    // Subscribe to all chat rooms
    const chatSubscribers = [];
    for (const room of chatRooms) {
      const subscriber = await redisService.subscribe(
        `chat:${room}`,
        (message) => {
          console.log(`Chat message in ${room}:`, message);
        }
      );
      chatSubscribers.push(subscriber);
      await delay(200);
    }
    await delay(500);

    // Simulate chat messages with delays
    const chatMessages = [
      { room: slotsRoom, player: "player1", message: "Anyone up for slots?" },
      {
        room: blackjackRoom,
        player: "player2",
        message: "Blackjack table is hot!",
      },
      { room: rouletteRoom, player: "player3", message: "Roulette anyone?" },
    ];

    for (const msg of chatMessages) {
      await delay(500);
      await redisService.publish(`chat:${msg.room}`, {
        type: "chat_message",
        player: msg.player,
        message: msg.message,
        timestamp: Date.now(),
      });
    }

    // Wait for messages to be processed
    await delay(1000);

    // Cleanup chat subscribers
    for (const subscriber of chatSubscribers) {
      await subscriber.quit();
      await delay(200);
    }

    // Test 11: Game State Synchronization
    console.log("Test 11: Testing game state synchronization...");

    // Simulate game state updates across rooms
    const gameStates = [
      { room: slotsRoom, state: { status: "spinning", current_round: 1 } },
      { room: blackjackRoom, state: { status: "dealing", current_round: 1 } },
      { room: rouletteRoom, state: { status: "spinning", current_round: 1 } },
    ];

    // Update game states with delays
    for (const game of gameStates) {
      await redisService.setGameState(game.room, {
        ...game.state,
        timestamp: Date.now(),
      });
      await delay(200);
    }
    await delay(500);

    // Verify game states with delays
    for (const game of gameStates) {
      const state = await redisService.getGameState(game.room);
      console.log(`Game state for ${game.room}:`, state);
      await delay(200);
    }

    // Cleanup with delays
    console.log("Cleaning up test data...");
    await redisService.client.del("test:key");
    await delay(200);

    for (const room of [slotsRoom, blackjackRoom, rouletteRoom]) {
      await redisService.removeGameRoom(room);
      await delay(200);
    }

    for (const player of [
      ...concurrentPlayers,
      ...matchmakingPlayers.map((p) => p.id),
    ]) {
      await redisService.removePlayerSession(player);
      await delay(200);
    }

    await redisService.client.del(`history:${gameId}`);
    await delay(200);
    await redisService.client.del("leaderboard:slots");
    await delay(200);
    await redisService.client.del("leaderboard:blackjack");
    await delay(200);
    await redisService.client.del("leaderboard:roulette");
    await delay(200);

    console.log("All tests completed successfully!");
  } catch (error) {
    logger.error("Test failed:", error);
    throw error; // Re-throw to ensure proper error handling
  } finally {
    // Close Redis connection
    try {
      await redisService.cleanup();
    } catch (error) {
      logger.error("Error during cleanup:", error);
    }
  }
}

// Run tests
testRedisConnection().catch((error) => {
  logger.error("Test suite failed:", error);
  process.exit(1);
});
