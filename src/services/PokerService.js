import RedisService from "./RedisService.js";
import WebSocketService from "./WebSocketService.js";
import { logger } from "../utils/logger.js";


class PokerService {
  constructor() {
    this.redis = RedisService;
    this.ws = WebSocketService;
    this.rooms = new Map();
    this.playerTimeouts = new Map();
  }

  // Room Management
  async createRoom(options) {
    const {
      name,
      creatorId,
      maxPlayers = 6,
      minBet = 10,
      maxBet = 1000,
    } = options;

    const roomId = `poker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const room = {
      id: roomId,
      name: name,
      creator: { id: creatorId },
      players: [],
      maxPlayers,
      minBet,
      maxBet,
      status: "waiting",
      state: "waiting",
      pot: 0,
      community: [],
      currentTurn: null,
      currentBet: 0,
      deck: [],
      phase: "waiting", // waiting, preflop, flop, turn, river, showdown
      dealerIndex: null, // 🔥 Track dealer for blinds
      smallBlind: minBet,
      bigBlind: minBet * 2,
      timeouts: {}, // 🔥 To track timeouts per player
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store in Redis
    await this.redis.client.set(`poker:room:${roomId}`, JSON.stringify(room));
    await this.redis.client.sadd("poker:rooms", roomId);

    console.log(`Poker room created: ${roomId} by user ${creatorId}`);
    return room;
  }

  async getRoom(roomId) {
    const roomData = await this.redis.client.get(`poker:room:${roomId}`);
    if (!roomData) {
      throw new Error("Room not found");
    }
    return JSON.parse(roomData);
  }

  async getAvailableRooms() {
    const roomIds = await this.redis.client.smembers("poker:rooms");
    const rooms = [];

    for (const roomId of roomIds) {
      try {
        const room = await this.getRoom(roomId);
        if (
          room.status === "waiting" &&
          room.players.length < room.maxPlayers
        ) {
          rooms.push({
            id: room.id,
            name: room.name,
            creator: room.creator,
            players: room.players,
            maxPlayers: room.maxPlayers,
            minBet: room.minBet,
            maxBet: room.maxBet,
            status: room.status,
            createdAt: room.createdAt,
            currentPlayers: room.players.length,
          });
        }
      } catch (error) {
        logger.error(`Error getting room ${roomId}:`, error);
      }
    }

    return rooms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async joinRoom(roomId, playerId) {
    const room = await this.getRoom(roomId);

    if (room.status !== "waiting") {
      throw new Error("Room is not accepting players");
    }

    if (room.players.length >= room.maxPlayers) {
      throw new Error("Room is full");
    }

    // Check if player is already in room
    const existingPlayer = room.players.find((p) => p.id === playerId);
    if (existingPlayer) {
      // Player is already in room, just return the room data
      console.log(
        `Player ${playerId} already in room ${roomId}, returning existing room`
      );
      return room;
    }

    // Add player to room
    const player = {
      id: playerId,
      chips: 1000, // Default starting chips
      bet: 0,
      status: "active",
      hand: [],
      folded: false,
      allIn: false,
    };

    room.players.push(player);
    room.updatedAt = new Date().toISOString();

    // Update room in Redis
    await this.redis.client.set(`poker:room:${roomId}`, JSON.stringify(room));

    // Notify other players via WebSocket
    this.ws.broadcastToRoom(roomId, {
      type: "player_joined",
      player: player,
      room: room,
    });

    console.log(`Player ${playerId} joined poker room ${roomId}`);
    return room;
  }

  async leaveRoom(roomId, playerId) {
    const room = await this.getRoom(roomId);

    const playerIndex = room.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) {
      throw new Error("Player not in room");
    }

    room.players.splice(playerIndex, 1);
    room.updatedAt = new Date().toISOString();

    // If no players left, remove room
    if (room.players.length === 0) {
      await this.redis.client.del(`poker:room:${roomId}`);
      await this.redis.client.srem("poker:rooms", roomId);
      console.log(`Poker room ${roomId} removed (no players left)`);
    } else {
      // Update room in Redis
      await this.redis.client.set(`poker:room:${roomId}`, JSON.stringify(room));

      // Notify other players via WebSocket
      this.ws.broadcastToRoom(roomId, {
        type: "player_left",
        playerId: playerId,
        room: room,
      });
    }

     this.clearPlayerTimeout(roomId, playerId);

    console.log(`Player ${playerId} left poker room ${roomId}`);
  }

  // Game Logic
  async startGame(roomId, playerId) {
    const room = await this.getRoom(roomId);

    if (room.creator.id !== playerId) {
      throw new Error("Only room creator can start the game");
    }

    if (room.players.length < 2) {
      throw new Error("Need at least 2 players to start");
    }

    // Initialize game
    room.status = "playing";
    room.state = "playing";
    room.phase = "preflop";
    room.pot = 0;
    room.community = [];
    room.currentBet = 0;
    room.deck = this.createDeck();
    room.deck = this.shuffleDeck(room.deck);



    // Deal cards to players
    for (let i = 0; i < 2; i++) {
      for (const player of room.players) {
        player.hand.push(room.deck.pop());
      }
    }

    // Set first player as current turn
    room.currentTurn = room.players[0].id;
    room.updatedAt = new Date().toISOString();

    // Update room in Redis
    await this.redis.client.set(`poker:room:${roomId}`, JSON.stringify(room));

    // Notify all players via WebSocket
    this.ws.broadcastToRoom(roomId, {
      type: "game_started",
      room: room,
    });

    console.log(`Poker game started in room ${roomId}`);
    return room;
  }


  setPlayerTimeout(roomId, playerId, duration = 30000) {
              // Clear any existing timeout
    if (!this.playerTimeouts.has(roomId)) this.playerTimeouts.set(roomId, {});
    const timeouts = this.playerTimeouts.get(roomId);
    if (timeouts[playerId]) clearTimeout(timeouts[playerId]);

    timeouts[playerId] = setTimeout(async () => {
      try {
        console.log(
          `Player ${playerId} timed out in room ${roomId}, auto-folding.`
        );
        await this.playerAction(roomId, playerId, "fold");
      } catch (err) {
        logger.error("Error auto-folding player:", err);
      }
    }, duration);
  }

  clearPlayerTimeout(roomId, playerId) {
    if (!this.playerTimeouts.has(roomId)) return;
    const timeouts = this.playerTimeouts.get(roomId);
    if (timeouts[playerId]) {
      clearTimeout(timeouts[playerId]);
      delete timeouts[playerId];
    }
  }

  async playerAction(roomId, playerId, action, amount = 0) {
    const room = await this.getRoom(roomId);

    if (room.currentTurn !== playerId) {
      throw new Error("Not your turn");
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error("Player not found");
    }

    if (player.folded) {
      throw new Error("Player has folded");
    }

    // Check if player is already all-in
    if (player.allIn) {
      throw new Error("Player is already all-in");
    }
    this.clearPlayerTimeout(roomId, playerId);

    // Process action
    switch (action) {
      case "fold":
        player.folded = true;
        break;

      case "check":
        if (room.currentBet > player.bet) {
          throw new Error("Cannot check when there is a bet to call");
        }
        break;

      case "call":
        const callAmount = room.currentBet - player.bet;
        if (callAmount >= player.chips) {
          // All in
          const actualCallAmount = Math.min(callAmount, player.chips);
          player.bet += actualCallAmount;
          room.pot += actualCallAmount;
          player.chips = 0;
          player.allIn = true;
        } else {
          player.bet += callAmount;
          room.pot += callAmount;
          player.chips -= callAmount;
        }
        break;

      case "bet":
        if (amount > player.chips) {
          throw new Error("Not enough chips");
        }
        if (amount < room.minBet) {
          throw new Error(`Bet must be at least ${room.minBet}`);
        }
        if (amount > room.maxBet) {
          throw new Error(`Bet cannot exceed ${room.maxBet}`);
        }
        if (room.currentBet > 0) {
          throw new Error("Cannot bet when there is already a bet to call");
        }
        player.bet += amount;
        room.pot += amount;
        player.chips -= amount;
        room.currentBet = player.bet;
        break;

      case "raise":
        if (amount <= room.currentBet) {
          throw new Error("Raise must be higher than current bet");
        }
        if (amount > player.chips) {
          throw new Error("Not enough chips");
        }
        const raiseAmount = amount - player.bet;
        player.bet = amount;
        room.pot += raiseAmount;
        player.chips -= raiseAmount;
        room.currentBet = amount;
        break;

      case "allin":
        if (player.chips <= 0) {
          throw new Error("No chips to go all-in with");
        }
        room.pot += player.chips;
        player.bet += player.chips;
        room.currentBet = Math.max(room.currentBet, player.bet);
        player.chips = 0;
        player.allIn = true;
        break;

      default:
        throw new Error("Invalid action");
    }

    // Check if only one player remains (others folded)
    const activePlayers = room.players.filter((p) => !p.folded);
    if (activePlayers.length === 1) {
      // Last player wins automatically
      await this.showdown(room);
      // Optionally, end the game after showdown if desired:
      await this.endGame(room.id, room.creator.id);
      return room;
    }

    // Check if all remaining players are all-in
    const allInPlayers = activePlayers.filter((p) => p.allIn);
    if (
      allInPlayers.length === activePlayers.length &&
      activePlayers.length > 1
    ) {
      // All players are all-in, deal remaining community cards and showdown
      await this.dealRemainingCommunityCards(room);
      await this.showdown(room);
      return room;
    }

    if (room.status === "playing") {
      this.setPlayerTimeout(roomId, room.currentTurn);
    }

    // Move to next player
    this.moveToNextPlayer(room);

    // Check if round is complete
    if (this.isRoundComplete(room)) {
      console.log(
        `Round complete in room ${roomId}, moving to next phase. Current phase: ${room.phase}`
      );
      await this.nextPhase(roomId, playerId);
    } else {
      console.log(
        `Round not complete in room ${roomId}. Current phase: ${room.phase}, current bet: ${room.currentBet}, current turn: ${room.currentTurn}`
      );
    }

    room.updatedAt = new Date().toISOString();

    // Update room in Redis
    await this.redis.client.set(`poker:room:${roomId}`, JSON.stringify(room));

    // Notify all players via WebSocket
    this.ws.broadcastToRoom(roomId, {
      type: "player_action",
      playerId: playerId,
      action: action,
      amount: amount,
      room: room,
    });

    console.log(
      `Player ${playerId} performed action ${action} in room ${roomId}`
    );
    return room;
  }

  async nextPhase(roomId, playerId) {
    const room = await this.getRoom(roomId);

    console.log(
      `nextPhase called for room ${roomId}, current phase: ${room.phase}, community cards: ${room.community.length}`
    );

    // Deal community cards based on phase
    switch (room.phase) {
      case "preflop":
        // Deal flop (3 cards)
        for (let i = 0; i < 3; i++) {
          if (room.deck.length > 0) {
            room.community.push(room.deck.pop());
          }
        }
        room.phase = "flop";
        console.log(`Dealt flop: ${room.community.length} community cards`);
        break;

      case "flop":
        // Deal turn (1 card)
        if (room.deck.length > 0) {
          room.community.push(room.deck.pop());
        }
        room.phase = "turn";
        console.log(`Dealt turn: ${room.community.length} community cards`);
        break;

      case "turn":
        // Deal river (1 card)
        if (room.deck.length > 0) {
          room.community.push(room.deck.pop());
        }
        room.phase = "river";
        console.log(`Dealt river: ${room.community.length} community cards`);
        break;

      case "river":
        // Showdown
        room.phase = "showdown";
        console.log(`Moving to showdown phase`);
        await this.showdown(room);
        return room;
    }

    // Reset bets for new phase (but keep community cards!)
    room.currentBet = 0;
    for (const player of room.players) {
      player.bet = 0;
    }

    // Set first active player as current turn
    const activePlayers = room.players.filter((p) => !p.folded);
    if (activePlayers.length > 0) {
      room.currentTurn = activePlayers[0].id;
    }

    room.updatedAt = new Date().toISOString();

    // Update room in Redis
    await this.redis.client.set(`poker:room:${roomId}`, JSON.stringify(room));

    // Notify all players via WebSocket
    this.ws.broadcastToRoom(roomId, {
      type: "phase_change",
      phase: room.phase,
      community: room.community,
      room: room,
    });

    console.log(
      `Poker room ${roomId} moved to ${room.phase} phase with ${room.community.length} community cards`
    );
    return room;
  }

  async dealRemainingCommunityCards(room) {
    // Deal remaining community cards based on current phase
    switch (room.phase) {
      case "preflop":
        // Deal flop (3 cards)
        for (let i = 0; i < 3; i++) {
          if (room.deck.length > 0) {
            room.community.push(room.deck.pop());
          }
        }
        room.phase = "flop";
        break;

      case "flop":
        // Deal turn (1 card)
        if (room.deck.length > 0) {
          room.community.push(room.deck.pop());
        }
        room.phase = "turn";
        break;

      case "turn":
        // Deal river (1 card)
        if (room.deck.length > 0) {
          room.community.push(room.deck.pop());
        }
        room.phase = "river";
        break;
    }

    // Move to showdown phase
    room.phase = "showdown";
    console.log(
      `Dealt remaining community cards for all-in situation in room ${room.id}`
    );
  }

  async showdown(room) {
    // Evaluate hands and determine winner
    const activePlayers = room.players.filter((p) => !p.folded);
    const results = [];

    for (const player of activePlayers) {
      const handValue = this.evaluateHand(player.hand, room.community);
      results.push({
        playerId: player.id,
        hand: player.hand,
        handValue: handValue,
        score: handValue.score,
      });
    }

    // Sort by score (highest wins)
    results.sort((a, b) => b.score - a.score);

    // Award pot to winner(s)
    const winners = results.filter((r) => r.score === results[0].score);
    const winAmount = Math.floor(room.pot / winners.length);

    for (const winner of winners) {
      const player = room.players.find((p) => p.id === winner.playerId);
      if (player) {
        player.chips += winAmount;
      }
    }

    // Reset game state
    room.status = "waiting";
    room.state = "waiting";
    room.phase = "waiting";
    room.pot = 0;
    room.community = [];
    room.currentBet = 0;
    room.currentTurn = null;

    // Reset player states
    for (const player of room.players) {
      player.hand = [];
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
    }

    // Notify all players via WebSocket
    this.ws.broadcastToRoom(room.id, {
      type: "showdown",
      results: results,
      winners: winners,
      winAmount: winAmount,
      room: room,
    });

    console.log(
      `Poker showdown completed in room ${room.id}. Winners: ${winners.map((w) => w.playerId).join(", ")}`
    );
  }

  async endGame(roomId, playerId) {
    const room = await this.getRoom(roomId);

    if (room.creator.id !== playerId) {
      throw new Error("Only room creator can end the game");
    }

    // Force showdown if game is in progress
    if (room.status === "playing") {
      await this.showdown(room);
    }

    room.status = "finished";
    room.state = "finished";
    room.updatedAt = new Date().toISOString();

    // Update room in Redis
    await this.redis.client.set(`poker:room:${roomId}`, JSON.stringify(room));

    // Notify all players via WebSocket
    this.ws.broadcastToRoom(roomId, {
      type: "game_ended",
      room: room,
    });


    if (this.playerTimeouts.has(roomId)) {
      const timeouts = this.playerTimeouts.get(roomId);
      Object.values(timeouts).forEach(clearTimeout);
      this.playerTimeouts.delete(roomId);
    }

    console.log(`Poker game ended in room ${roomId}`);
    return room;
  }

  // Helper methods
  createDeck() {
    const suits = ["hearts", "diamonds", "clubs", "spades"];
    const ranks = [
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "J",
      "Q",
      "K",
      "A",
    ];
    const deck = [];

    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank });
      }
    }

    return deck;
  }

  shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  moveToNextPlayer(room) {
    const activePlayers = room.players.filter((p) => !p.folded);

    // If no active players, return (should trigger showdown)
    if (activePlayers.length === 0) {
      return;
    }

    // If only one active player, they win automatically
    if (activePlayers.length === 1) {
      room.currentTurn = activePlayers[0].id;
      return;
    }

    const currentIndex = activePlayers.findIndex(
      (p) => p.id === room.currentTurn
    );

    // If current player not found in active players, start with first active player
    if (currentIndex === -1) {
      room.currentTurn = activePlayers[0].id;
      return;
    }

    const nextIndex = (currentIndex + 1) % activePlayers.length;
    room.currentTurn = activePlayers[nextIndex].id;
  }

  isRoundComplete(room) {
    const activePlayers = room.players.filter((p) => !p.folded);

    // If only one active player, round is complete
    if (activePlayers.length <= 1) {
      console.log(
        `Round complete: Only ${activePlayers.length} active player(s)`
      );
      return true;
    }

    // Check if all active players are all-in
    const allAllIn = activePlayers.every((p) => p.allIn);
    if (allAllIn) {
      console.log(`Round complete: All players are all-in`);
      return true;
    }

    // Check if all active players have matched the current bet
    const allBetsEqual = activePlayers.every(
      (p) => p.bet === room.currentBet || p.allIn
    );

    // If all bets are equal and there's no current bet (everyone checked), round is complete
    if (room.currentBet === 0) {
      console.log(`Round complete: No current bet and all bets equal`);
      return allBetsEqual;
    }

    // If all bets are equal and there is a current bet, check if betting has gone around
    if (allBetsEqual) {
      // Find the player who made the current bet
      const bettor = activePlayers.find((p) => p.bet === room.currentBet);

      // If current turn is back to the bettor, round is complete
      if (bettor && room.currentTurn === bettor.id) {
        console.log(`Round complete: Turn back to bettor ${bettor.id}`);
        return true;
      }
    }

    console.log(
      `Round not complete: currentBet=${room.currentBet}, currentTurn=${room.currentTurn}, allBetsEqual=${allBetsEqual}`
    );
    return false;
  }

  evaluateHand(playerHand, communityCards) {
    const allCards = [...playerHand, ...communityCards];

    if (allCards.length < 5) {
      return { name: "Incomplete Hand", score: 0 };
    }

    // Convert cards to standardized format
    const cards = allCards.map((card) => ({
      rank: card.rank,
      suit: card.suit,
      value: this.getRankValue(card.rank),
    }));

    // Sort cards by value (descending)
    const sortedCards = cards.sort((a, b) => b.value - a.value);

    // Check for each hand type in order of strength
    const royalFlush = this.checkRoyalFlush(sortedCards);
    if (royalFlush) return royalFlush;

    const straightFlush = this.checkStraightFlush(sortedCards);
    if (straightFlush) return straightFlush;

    const fourOfAKind = this.checkFourOfAKind(sortedCards);
    if (fourOfAKind) return fourOfAKind;

    const fullHouse = this.checkFullHouse(sortedCards);
    if (fullHouse) return fullHouse;

    const flush = this.checkFlush(sortedCards);
    if (flush) return flush;

    const straight = this.checkStraight(sortedCards);
    if (straight) return straight;

    const threeOfAKind = this.checkThreeOfAKind(sortedCards);
    if (threeOfAKind) return threeOfAKind;

    const twoPair = this.checkTwoPair(sortedCards);
    if (twoPair) return twoPair;

    const pair = this.checkPair(sortedCards);
    if (pair) return pair;

    return this.checkHighCard(sortedCards);
  }

  getRankValue(rank) {
    switch (rank) {
      case "A":
        return 14;
      case "K":
        return 13;
      case "Q":
        return 12;
      case "J":
        return 11;
      case "10":
        return 10;
      default:
        return parseInt(rank);
    }
  }

  checkRoyalFlush(cards) {
    const straightFlush = this.checkStraightFlush(cards);
    if (straightFlush && straightFlush.cards[0].value === 14) {
      return {
        name: "Royal Flush",
        score: 9000 + straightFlush.cards[0].value,
        cards: straightFlush.cards,
        description: `Royal Flush in ${straightFlush.cards[0].suit}`,
      };
    }
    return null;
  }

  checkStraightFlush(cards) {
    const flush = this.checkFlush(cards);
    if (!flush) return null;

    const straight = this.checkStraight(flush.cards);
    if (!straight) return null;

    return {
      name: "Straight Flush",
      score: 8000 + straight.cards[0].value,
      cards: straight.cards,
      description: `Straight Flush, ${straight.cards[0].rank} high`,
    };
  }

  checkFourOfAKind(cards) {
    const groups = this.groupByRank(cards);
    const fourOfAKind = Object.entries(groups).find(
      ([_, cards]) => cards.length === 4
    );

    if (!fourOfAKind) return null;

    const [rank, fourCards] = fourOfAKind;
    const kicker = cards.find((card) => card.value !== fourCards[0].value);

    return {
      name: "Four of a Kind",
      score: 7000 + fourCards[0].value,
      cards: kicker ? [...fourCards, kicker] : fourCards,
      description: `Four ${rank}s`,
    };
  }

  checkFullHouse(cards) {
    const groups = this.groupByRank(cards);
    const threeOfAKind = Object.entries(groups).find(
      ([_, cards]) => cards.length === 3
    );
    const pair = Object.entries(groups).find(
      ([_, cards]) => cards.length >= 2 && cards !== threeOfAKind?.[1]
    );

    if (!threeOfAKind || !pair) return null;

    const [threeRank, threeCards] = threeOfAKind;
    const [pairRank, pairCards] = pair;

    return {
      name: "Full House",
      score: 6000 + threeCards[0].value * 100 + pairCards[0].value,
      cards: [...threeCards, ...pairCards.slice(0, 2)],
      description: `${threeRank}s full of ${pairRank}s`,
    };
  }

  checkFlush(cards) {
    const suitGroups = this.groupBySuit(cards);
    const flushSuit = Object.entries(suitGroups).find(
      ([_, cards]) => cards.length >= 5
    );

    if (!flushSuit) return null;

    const [suit, flushCards] = flushSuit;
    const bestFlushCards = flushCards.slice(0, 5);

    return {
      name: "Flush",
      score:
        5000 +
        bestFlushCards.reduce(
          (sum, card, index) => sum + card.value * Math.pow(10, 4 - index),
          0
        ),
      cards: bestFlushCards,
      description: `${suit} flush`,
    };
  }

  checkStraight(cards) {
    const uniqueValues = [...new Set(cards.map((card) => card.value))].sort(
      (a, b) => b - a
    );

    // Check for regular straight
    for (let i = 0; i <= uniqueValues.length - 5; i++) {
      const sequence = uniqueValues.slice(i, i + 5);
      if (this.isConsecutive(sequence)) {
        const straightCards = sequence.map((value) =>
          cards.find((card) => card.value === value)
        );
        return {
          name: "Straight",
          score: 4000 + sequence[0],
          cards: straightCards,
          description: `Straight, ${straightCards[0].rank} high`,
        };
      }
    }

    // Check for A-2-3-4-5 straight (wheel)
    if (
      uniqueValues.includes(14) &&
      uniqueValues.includes(5) &&
      uniqueValues.includes(4) &&
      uniqueValues.includes(3) &&
      uniqueValues.includes(2)
    ) {
      const wheelCards = [5, 4, 3, 2, 14].map((value) =>
        cards.find((card) => card.value === value)
      );
      return {
        name: "Straight",
        score: 4000 + 5, // 5-high straight
        cards: wheelCards,
        description: "Straight, 5 high",
      };
    }

    return null;
  }

  checkThreeOfAKind(cards) {
    const groups = this.groupByRank(cards);
    const threeOfAKind = Object.entries(groups).find(
      ([_, cards]) => cards.length === 3
    );

    if (!threeOfAKind) return null;

    const [rank, threeCards] = threeOfAKind;
    const kickers = cards
      .filter((card) => card.value !== threeCards[0].value)
      .slice(0, 2);

    return {
      name: "Three of a Kind",
      score:
        3000 +
        threeCards[0].value * 100 +
        kickers.reduce((sum, card) => sum + card.value, 0),
      cards: [...threeCards, ...kickers],
      description: `Three ${rank}s`,
    };
  }

  checkTwoPair(cards) {
    const groups = this.groupByRank(cards);
    const pairs = Object.entries(groups).filter(
      ([_, cards]) => cards.length >= 2
    );

    if (pairs.length < 2) return null;

    // Sort pairs by card value
    pairs.sort((a, b) => b[1][0].value - a[1][0].value);

    const [highPairRank, highPairCards] = pairs[0];
    const [lowPairRank, lowPairCards] = pairs[1];
    const kicker = cards.find(
      (card) =>
        card.value !== highPairCards[0].value &&
        card.value !== lowPairCards[0].value
    );

    const handCards = [
      ...highPairCards.slice(0, 2),
      ...lowPairCards.slice(0, 2),
    ];
    if (kicker) handCards.push(kicker);

    return {
      name: "Two Pair",
      score:
        2000 +
        highPairCards[0].value * 100 +
        lowPairCards[0].value * 10 +
        (kicker?.value || 0),
      cards: handCards,
      description: `${highPairRank}s and ${lowPairRank}s`,
    };
  }

  checkPair(cards) {
    const groups = this.groupByRank(cards);
    const pair = Object.entries(groups).find(([_, cards]) => cards.length >= 2);

    if (!pair) return null;

    const [rank, pairCards] = pair;
    const kickers = cards
      .filter((card) => card.value !== pairCards[0].value)
      .slice(0, 3);

    return {
      name: "Pair",
      score:
        1000 +
        pairCards[0].value * 100 +
        kickers.reduce(
          (sum, card, index) => sum + card.value * Math.pow(10, 2 - index),
          0
        ),
      cards: [...pairCards.slice(0, 2), ...kickers],
      description: `Pair of ${rank}s`,
    };
  }

  checkHighCard(cards) {
    const bestCards = cards.slice(0, 5);

    return {
      name: "High Card",
      score: bestCards.reduce(
        (sum, card, index) => sum + card.value * Math.pow(10, 4 - index),
        0
      ),
      cards: bestCards,
      description: `${bestCards[0].rank} high`,
    };
  }

  groupByRank(cards) {
    const groups = {};
    for (const card of cards) {
      if (!groups[card.rank]) {
        groups[card.rank] = [];
      }
      groups[card.rank].push(card);
    }
    return groups;
  }

  groupBySuit(cards) {
    const groups = {};
    for (const card of cards) {
      if (!groups[card.suit]) {
        groups[card.suit] = [];
      }
      groups[card.suit].push(card);
    }
    return groups;
  }

  isConsecutive(values) {
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] - 1) {
        return false;
      }
    }
    return true;
  }
}

export default PokerService;
