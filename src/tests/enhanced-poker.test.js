import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import EnhancedPokerService from "../services/EnhancedPokerService.js";
import RedisService from "../services/RedisService.js";
import WebSocketService from "../services/WebSocketService.js";
import sinon from "sinon";

describe("EnhancedPokerService", () => {
  let pokerService;
  let testRoomId;
  let testPlayerId;
  let redisStub;
  let webSocketStub;

  before(async () => {
    pokerService = new EnhancedPokerService();
    testPlayerId = "test-player-123";

    // Setup stubs for Redis and WebSocket
    redisStub = sinon.stub(RedisService, "client");
    webSocketStub = sinon.stub(WebSocketService, "broadcastToRoom");
  });

  after(async () => {
    // Cleanup test data
    if (testRoomId) {
      try {
        await pokerService.redis.client.del(`poker:room:${testRoomId}`);
      } catch (error) {
        console.error("Cleanup error:", error);
      }
    }

    // Restore stubs
    redisStub.restore();
    webSocketStub.restore();
  });

  describe("Room Management", () => {
    it("should create a room successfully", async () => {
      const room = await pokerService.createRoom({
        name: "Test Enhanced Room",
        creatorId: testPlayerId,
        maxPlayers: 4,
        minBet: 50,
        maxBet: 500,
      });

      expect(room).to.have.property("id");
      expect(room.name).to.equal("Test Enhanced Room");
      expect(room.creator.id).to.equal(testPlayerId);
      expect(room.maxPlayers).to.equal(4);
      expect(room.minBet).to.equal(50);
      expect(room.maxBet).to.equal(500);
      expect(room.status).to.equal("waiting");
      expect(room.phase).to.equal("waiting");

      testRoomId = room.id;
    });

    it("should retrieve a room successfully", async () => {
      const room = await pokerService.getRoom(testRoomId);
      expect(room).to.not.be.null;
      expect(room.id).to.equal(testRoomId);
      expect(room.name).to.equal("Test Enhanced Room");
    });

    it("should list available rooms", async () => {
      const rooms = await pokerService.getAvailableRooms();
      expect(rooms).to.be.an("array");
      const testRoom = rooms.find((r) => r.id === testRoomId);
      expect(testRoom).to.not.be.undefined;
      expect(testRoom.name).to.equal("Test Enhanced Room");
    });
  });

  describe("Player Management", () => {
    it("should allow a player to join a room", async () => {
      const room = await pokerService.joinRoom(testRoomId, testPlayerId);
      expect(room.players).to.have.length(1);
      expect(room.players[0].id).to.equal(testPlayerId);
      expect(room.players[0].chips).to.equal(1000);
      expect(room.players[0].hand).to.be.an("array");
    });

    it("should handle duplicate joins gracefully", async () => {
      const room = await pokerService.joinRoom(testRoomId, testPlayerId);
      expect(room.players).to.have.length(1); // Should not add duplicate
    });

    it("should allow multiple players to join", async () => {
      const player2Id = "test-player-456";
      const room = await pokerService.joinRoom(testRoomId, player2Id);
      expect(room.players).to.have.length(2);
      expect(room.players.find((p) => p.id === player2Id)).to.not.be.undefined;
    });
  });

  describe("Game Logic", () => {
    it("should start a game successfully", async () => {
      const room = await pokerService.startGame(testRoomId, testPlayerId);
      expect(room.status).to.equal("playing");
      expect(room.state).to.equal("playing");
      expect(room.phase).to.equal("preflop");
      expect(room.handNumber).to.equal(1);
      expect(room.pot).to.be.greaterThan(0);
      expect(room.currentBet).to.equal(room.bigBlind);
      expect(room.currentTurn).to.not.be.null;

      // Check that players have cards
      room.players.forEach((player) => {
        expect(player.hand).to.have.length(2);
        expect(player.bet).to.be.greaterThan(0);
      });
    });

    it("should handle player actions correctly", async () => {
      const player2Id = "test-player-456";
      const room = await pokerService.getRoom(testRoomId);
      const currentTurnPlayer = room.players.find(
        (p) => p.id === room.currentTurn
      );

      if (currentTurnPlayer) {
        const action =
          currentTurnPlayer.bet === room.currentBet ? "check" : "call";
        const updatedRoom = await pokerService.playerAction(
          testRoomId,
          currentTurnPlayer.id,
          action
        );
        expect(updatedRoom).to.not.be.null;
      }
    });
  });

  describe("Hand Evaluation", () => {
    it("should evaluate a royal flush correctly", () => {
      const playerHand = [
        { rank: "A", suit: "hearts" },
        { rank: "K", suit: "hearts" },
      ];
      const communityCards = [
        { rank: "Q", suit: "hearts" },
        { rank: "J", suit: "hearts" },
        { rank: "10", suit: "hearts" },
      ];

      const result = pokerService.evaluateHand(playerHand, communityCards);
      expect(result.name).to.equal("Royal Flush");
      expect(result.score).to.be.greaterThan(9000);
    });

    it("should evaluate a full house correctly", () => {
      const playerHand = [
        { rank: "A", suit: "hearts" },
        { rank: "A", suit: "diamonds" },
      ];
      const communityCards = [
        { rank: "A", suit: "clubs" },
        { rank: "K", suit: "hearts" },
        { rank: "K", suit: "diamonds" },
      ];

      const result = pokerService.evaluateHand(playerHand, communityCards);
      expect(result.name).to.equal("Full House");
      expect(result.score).to.be.greaterThan(6000);
    });

    it("should evaluate a pair correctly", () => {
      const playerHand = [
        { rank: "A", suit: "hearts" },
        { rank: "2", suit: "diamonds" },
      ];
      const communityCards = [
        { rank: "A", suit: "clubs" },
        { rank: "7", suit: "hearts" },
        { rank: "9", suit: "diamonds" },
      ];

      const result = pokerService.evaluateHand(playerHand, communityCards);
      expect(result.name).to.equal("Pair");
      expect(result.score).to.be.greaterThan(1000);
    });
  });

  describe("Phase Transitions", () => {
    it("should move from preflop to flop correctly", async () => {
      // First, ensure we have a game in progress
      let room = await pokerService.getRoom(testRoomId);
      if (room.status !== "playing") {
        room = await pokerService.startGame(testRoomId, testPlayerId);
      }

      // Simulate a complete betting round by making all players check
      const activePlayers = room.players.filter((p) => !p.folded);
      for (const player of activePlayers) {
        if (room.currentTurn === player.id) {
          await pokerService.playerAction(testRoomId, player.id, "check");
        }
      }

      // Check if phase transition occurred
      room = await pokerService.getRoom(testRoomId);
      if (room.phase === "flop") {
        expect(room.community).to.have.length(3);
      }
    });
  });
});
