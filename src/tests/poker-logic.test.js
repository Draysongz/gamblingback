import { expect } from "chai";
import EnhancedPokerService from "../services/EnhancedPokerService.js";

// Mock Redis and WebSocket services
const mockRedis = {
  client: {
    set: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    keys: () => Promise.resolve([]),
  },
};

const mockWebSocket = {
  broadcastToRoom: () => {},
};

// Mock the services
EnhancedPokerService.prototype.redis = mockRedis;
EnhancedPokerService.prototype.ws = mockWebSocket;

describe("EnhancedPokerService Logic Tests", () => {
  let pokerService;

  beforeEach(() => {
    pokerService = new EnhancedPokerService();
  });

  describe("Room Creation", () => {
    it("should create a room with proper initial state", async () => {
      const roomOptions = {
        name: "Test Room",
        creatorId: "user1",
        maxPlayers: 6,
        minBet: 10,
        maxBet: 1000,
      };

      const room = await pokerService.createRoom(roomOptions);

      expect(room.id).to.match(/^poker_\d+_[a-z0-9]+$/);
      expect(room.name).to.equal("Test Room");
      expect(room.creator.id).to.equal("user1");
      expect(room.maxPlayers).to.equal(6);
      expect(room.minBet).to.equal(10);
      expect(room.maxBet).to.equal(1000);
      expect(room.status).to.equal("waiting");
      expect(room.phase).to.equal("waiting");
      expect(room.players).to.be.an("array").that.is.empty;
      expect(room.pot).to.equal(0);
      expect(room.currentBet).to.equal(0);
      expect(room.smallBlind).to.equal(5);
      expect(room.bigBlind).to.equal(10);
    });
  });

  describe("Player Actions", () => {
    let room;

    beforeEach(() => {
      room = {
        id: "test-room",
        status: "playing",
        phase: "preflop",
        currentTurn: "user1",
        currentBet: 10,
        lastRaise: 10,
        pot: 15,
        minBet: 10,
        maxBet: 1000,
        players: [
          {
            id: "user1",
            username: "Player1",
            chips: 1000,
            bet: 0,
            totalBet: 0,
            folded: false,
            allIn: false,
          },
          {
            id: "user2",
            username: "Player2",
            chips: 990,
            bet: 10,
            totalBet: 10,
            folded: false,
            allIn: false,
            isBigBlind: true,
          },
        ],
      };
    });

    it("should handle check action correctly", () => {
      room.currentBet = 0; // No current bet, can check
      const player = room.players[0];

      pokerService.executePlayerAction(room, player, "check");

      expect(player.bet).to.equal(0);
      expect(player.chips).to.equal(1000);
    });

    it("should handle call action correctly", () => {
      const player = room.players[0];

      pokerService.executePlayerAction(room, player, "call");

      expect(player.bet).to.equal(10);
      expect(player.chips).to.equal(990);
      expect(player.totalBet).to.equal(10);
      expect(room.pot).to.equal(25);
    });

    it("should handle raise action correctly", () => {
      const player = room.players[0];

      pokerService.executePlayerAction(room, player, "raise", 30);

      expect(player.bet).to.equal(30);
      expect(player.chips).to.equal(970);
      expect(player.totalBet).to.equal(30);
      expect(room.currentBet).to.equal(30);
      expect(room.pot).to.equal(45);
    });

    it("should handle fold action correctly", () => {
      const player = room.players[0];

      pokerService.executePlayerAction(room, player, "fold");

      expect(player.folded).to.be.true;
      expect(player.isActive).to.be.false;
    });

    it("should handle all-in action correctly", () => {
      const player = room.players[0];
      player.chips = 50; // Low chips for all-in test

      pokerService.executePlayerAction(room, player, "all-in");

      expect(player.chips).to.equal(0);
      expect(player.allIn).to.be.true;
      expect(player.bet).to.equal(50);
      expect(player.totalBet).to.equal(50);
      expect(room.pot).to.equal(65);
    });

    it("should not allow check when there is a bet to call", () => {
      const player = room.players[0];

      expect(() => {
        pokerService.executePlayerAction(room, player, "check");
      }).to.throw("Cannot check when there's a bet to call");
    });

    it("should not allow raise below minimum", () => {
      const player = room.players[0];

      expect(() => {
        pokerService.executePlayerAction(room, player, "raise", 15);
      }).to.throw("Raise must be higher than current bet");
    });
  });

  describe("Turn Management", () => {
    it("should move to next player correctly", () => {
      const room = {
        players: [
          { id: "user1", folded: false },
          { id: "user2", folded: false },
          { id: "user3", folded: false },
        ],
        currentTurn: "user1",
      };

      pokerService.moveToNextPlayer(room);
      expect(room.currentTurn).to.equal("user2");

      pokerService.moveToNextPlayer(room);
      expect(room.currentTurn).to.equal("user3");

      pokerService.moveToNextPlayer(room);
      expect(room.currentTurn).to.equal("user1"); // Should wrap around
    });

    it("should handle folded players correctly", () => {
      const room = {
        players: [
          { id: "user1", folded: false },
          { id: "user2", folded: true },
          { id: "user3", folded: false },
        ],
        currentTurn: "user1",
      };

      pokerService.moveToNextPlayer(room);
      expect(room.currentTurn).to.equal("user3"); // Should skip user2
    });

    it("should handle single active player", () => {
      const room = {
        players: [
          { id: "user1", folded: false },
          { id: "user2", folded: true },
        ],
        currentTurn: "user1",
      };

      pokerService.moveToNextPlayer(room);
      expect(room.currentTurn).to.equal("user1"); // Should stay on single active player
    });
  });

  describe("Round Completion Logic", () => {
    it("should detect round completion when all players have matched the bet", () => {
      const room = {
        players: [
          { id: "user1", folded: false, bet: 10, allIn: false },
          { id: "user2", folded: false, bet: 10, allIn: false },
        ],
        currentBet: 10,
        currentTurn: "user1", // Back to the bettor
      };

      const isComplete = pokerService.isRoundComplete(room);
      expect(isComplete).to.be.true;
    });

    it("should detect round completion when only one player remains", () => {
      const room = {
        players: [
          { id: "user1", folded: false, bet: 10, allIn: false },
          { id: "user2", folded: true, bet: 0, allIn: false },
        ],
        currentBet: 10,
        currentTurn: "user1",
      };

      const isComplete = pokerService.isRoundComplete(room);
      expect(isComplete).to.be.true;
    });

    it("should detect round completion when all players are all-in", () => {
      const room = {
        players: [
          { id: "user1", folded: false, bet: 10, allIn: true },
          { id: "user2", folded: false, bet: 10, allIn: true },
        ],
        currentBet: 10,
        currentTurn: "user1",
      };

      const isComplete = pokerService.isRoundComplete(room);
      expect(isComplete).to.be.true;
    });

    it("should not complete round when betting is still in progress", () => {
      const room = {
        players: [
          { id: "user1", folded: false, bet: 10, allIn: false },
          { id: "user2", folded: false, bet: 5, allIn: false },
        ],
        currentBet: 10,
        currentTurn: "user2",
      };

      const isComplete = pokerService.isRoundComplete(room);
      expect(isComplete).to.be.false;
    });
  });

  describe("Hand Evaluation", () => {
    it("should evaluate a royal flush correctly", () => {
      const playerHand = [
        { suit: "hearts", rank: "A" },
        { suit: "hearts", rank: "K" },
      ];
      const communityCards = [
        { suit: "hearts", rank: "Q" },
        { suit: "hearts", rank: "J" },
        { suit: "hearts", rank: "10" },
      ];

      const result = pokerService.evaluateHand(playerHand, communityCards);

      expect(result.name).to.equal("Royal Flush");
      expect(result.score).to.be.greaterThan(9000);
    });

    it("should evaluate a pair correctly", () => {
      const playerHand = [
        { suit: "hearts", rank: "A" },
        { suit: "diamonds", rank: "A" },
      ];
      const communityCards = [
        { suit: "clubs", rank: "2" },
        { suit: "spades", rank: "3" },
        { suit: "hearts", rank: "4" },
      ];

      const result = pokerService.evaluateHand(playerHand, communityCards);

      expect(result.name).to.equal("Pair");
      expect(result.score).to.be.greaterThan(1000);
    });

    it("should handle incomplete hands", () => {
      const playerHand = [{ suit: "hearts", rank: "A" }];
      const communityCards = [
        { suit: "diamonds", rank: "2" },
        { suit: "clubs", rank: "3" },
      ];

      const result = pokerService.evaluateHand(playerHand, communityCards);

      expect(result.name).to.equal("Incomplete Hand");
      expect(result.score).to.equal(0);
    });
  });

  describe("Side Pot Resolution", () => {
    it("should create side pots correctly", () => {
      const room = {
        players: [
          { id: "user1", folded: false, totalBet: 50 },
          { id: "user2", folded: false, totalBet: 100 },
          { id: "user3", folded: false, totalBet: 100 },
        ],
        pot: 250,
        sidePots: [],
      };

      pokerService.createSidePots(room);

      expect(room.sidePots).to.have.length(2);
      expect(room.sidePots[0].amount).to.equal(150); // (50 * 3) for first side pot
      expect(room.sidePots[1].amount).to.equal(100); // remaining chips
    });

    it("should distribute side pots correctly", () => {
      const room = {
        players: [
          { id: "user1", username: "Player1", chips: 0, wins: 0 },
          { id: "user2", username: "Player2", chips: 0, wins: 0 },
          { id: "user3", username: "Player3", chips: 0, wins: 0 },
        ],
        sidePots: [
          {
            amount: 150,
            eligiblePlayers: ["user1", "user2", "user3"],
          },
          {
            amount: 100,
            eligiblePlayers: ["user2", "user3"],
          },
        ],
      };

      const results = [
        { playerId: "user1", score: 1000 },
        { playerId: "user2", score: 2000 },
        { playerId: "user3", score: 2000 },
      ];

      pokerService.distributePots(room, results);

      expect(room.players[1].chips).to.equal(125); // 50 from first pot + 75 from second pot
      expect(room.players[2].chips).to.equal(125); // 50 from first pot + 75 from second pot
      expect(room.players[0].chips).to.equal(50); // 50 from first pot only
    });
  });

  describe("Game State Management", () => {
    it("should reset game state correctly", () => {
      const room = {
        status: "playing",
        phase: "river",
        bettingRound: "river",
        pot: 100,
        currentBet: 20,
        lastRaise: 10,
        currentTurn: "user1",
        sidePots: [{ amount: 50 }],
        lastAction: { playerId: "user1", action: "call" },
        players: [
          {
            id: "user1",
            hand: [{ suit: "hearts", rank: "A" }],
            bet: 20,
            totalBet: 50,
            folded: false,
            allIn: false,
            isDealer: true,
            isSmallBlind: false,
            isBigBlind: false,
          },
        ],
      };

      pokerService.resetGameState(room);

      expect(room.status).to.equal("waiting");
      expect(room.phase).to.equal("waiting");
      expect(room.bettingRound).to.equal("preflop");
      expect(room.pot).to.equal(0);
      expect(room.currentBet).to.equal(0);
      expect(room.lastRaise).to.equal(0);
      expect(room.currentTurn).to.be.null;
      expect(room.sidePots).to.be.an("array").that.is.empty;
      expect(room.lastAction).to.be.null;

      const player = room.players[0];
      expect(player.hand).to.be.an("array").that.is.empty;
      expect(player.bet).to.equal(0);
      expect(player.totalBet).to.equal(0);
      expect(player.folded).to.be.false;
      expect(player.allIn).to.be.false;
      expect(player.isDealer).to.be.false;
      expect(player.isSmallBlind).to.be.false;
      expect(player.isBigBlind).to.be.false;
    });
  });
});
