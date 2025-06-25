import RedisService from "./RedisService.js";
import WebSocketService from "./WebSocketService.js";
import { logger } from "../utils/logger.js";
import User from "../models/User.js";

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
      lastRaiser: null,
      dealerIndex: 0,
      smallBlind: null,
      bigBlind: null,
      playersActedThisRound: [], // Track who has acted this round
      timeouts: {},
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
      console.log(
        `Player ${playerId} already in room ${roomId}, returning existing room`
      );
      return room;
    }

    const user = await User.getUser(playerId);
    console.log("user", user);

    // Add player to room
    const player = {
      id: playerId,
      username: user.username,
      chips: 1000,
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

    // Reset all player states
    for (const player of room.players) {
      player.hand = [];
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
      player.status = "active";
    }

    // Set dealer and blinds
    this.assignDealerAndBlinds(room);

    // Deal cards to players (2 cards each)
    for (let i = 0; i < 2; i++) {
      for (const player of room.players) {
        if (room.deck.length > 0) {
          player.hand.push(room.deck.pop());
        }
      }
    }

    // Set first player after big blind as current turn
    const bigBlindIndex = room.players.findIndex((p) => p.id === room.bigBlind);
    const firstPlayerIndex = (bigBlindIndex + 1) % room.players.length;
    room.currentTurn = room.players[firstPlayerIndex].id;

    // Start timeout for first player
    this.setPlayerTimeout(roomId, room.currentTurn);

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

  assignDealerAndBlinds(room) {
    if (!room.players.length) return;

    // Move dealer index forward
    room.dealerIndex = room.dealerIndex % room.players.length;

    // Assign dealer
    const dealer = room.players[room.dealerIndex];

    // For heads-up (2 players), dealer is small blind
    if (room.players.length === 2) {
      room.smallBlind = dealer.id;
      room.bigBlind =
        room.players[(room.dealerIndex + 1) % room.players.length].id;
    } else {
      // For 3+ players, small blind is next after dealer
      const sbIndex = (room.dealerIndex + 1) % room.players.length;
      const bbIndex = (room.dealerIndex + 2) % room.players.length;

      room.smallBlind = room.players[sbIndex].id;
      room.bigBlind = room.players[bbIndex].id;
    }

    // Post blinds
    const sbPlayer = room.players.find((p) => p.id === room.smallBlind);
    const bbPlayer = room.players.find((p) => p.id === room.bigBlind);

    const sbAmount = Math.floor(room.minBet / 2);
    const bbAmount = room.minBet;

    // Deduct small blind
    const sbDeduct = Math.min(sbAmount, sbPlayer.chips);
    sbPlayer.chips -= sbDeduct;
    sbPlayer.bet = sbDeduct;
    room.pot += sbDeduct;
    if (sbPlayer.chips === 0) sbPlayer.allIn = true;

    // Deduct big blind
    const bbDeduct = Math.min(bbAmount, bbPlayer.chips);
    bbPlayer.chips -= bbDeduct;
    bbPlayer.bet = bbDeduct;
    room.pot += bbDeduct;
    if (bbPlayer.chips === 0) bbPlayer.allIn = true;

    // Current bet starts at big blind amount
    room.currentBet = bbPlayer.bet;
    room.lastRaiser = room.bigBlind; // Big blind is considered the initial raiser

    console.log(
      `Dealer: ${dealer.id}, SB: ${room.smallBlind} (${sbDeduct}), BB: ${room.bigBlind} (${bbDeduct})`
    );
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
    let room = await this.getRoom(roomId);

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error("Player not found");
    }

    if (room.currentTurn !== playerId) {
      throw new Error("Not your turn");
    }

    if (player.folded) {
      throw new Error("Player has folded");
    }

    if (player.allIn && action !== "fold") {
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
        if (callAmount > 0) {
          if (callAmount >= player.chips) {
            // All in
            room.pot += player.chips;
            player.bet += player.chips;
            player.chips = 0;
            player.allIn = true;
          } else {
            player.bet += callAmount;
            room.pot += callAmount;
            player.chips -= callAmount;
          }
        }
        break;

      case "bet":
        if (room.currentBet > 0) {
          throw new Error("Cannot bet when there is already a bet to call");
        }
        if (amount < room.minBet) {
          throw new Error(`Bet must be at least ${room.minBet}`);
        }
        if (amount > player.chips) {
          throw new Error("Not enough chips");
        }

        player.bet = amount;
        room.pot += amount;
        player.chips -= amount;
        room.currentBet = amount;
        room.lastRaiser = player.id;
        room.playersActedThisRound = []; // Reset acted players for new betting round
        room.playersActedThisRound.push(player.id);

        if (player.chips === 0) player.allIn = true;
        break;

      case "raise":
        const totalRaiseAmount = room.currentBet + amount;
        if (totalRaiseAmount > player.chips + player.bet) {
          throw new Error("Not enough chips");
        }
        if (amount < room.minBet) {
          throw new Error(`Raise must be at least ${room.minBet}`);
        }

        const additionalAmount = totalRaiseAmount - player.bet;
        player.bet = totalRaiseAmount;
        player.chips -= additionalAmount;
        room.pot += additionalAmount;
        room.currentBet = totalRaiseAmount;
        room.lastRaiser = player.id;
        room.playersActedThisRound = []; // Reset acted players for new betting round
        room.playersActedThisRound.push(player.id);

        if (player.chips === 0) player.allIn = true;
        break;

      case "allin":
        if (player.chips <= 0) {
          throw new Error("No chips to go all-in with");
        }

        const allInAmount = player.chips;
        room.pot += allInAmount;
        player.bet += allInAmount;
        player.chips = 0;
        player.allIn = true;

        if (player.bet > room.currentBet) {
          room.currentBet = player.bet;
          room.lastRaiser = player.id;
          room.playersActedThisRound = []; // Reset acted players for new betting round
        }
        room.playersActedThisRound.push(player.id);
        break;

      default:
        throw new Error("Invalid action");
    }

    // Add player to acted set
    if (!room.playersActedThisRound.includes(player.id)) {
      room.playersActedThisRound.push(player.id);
    }

    // Check if only one player remains (others folded)
    const activePlayers = room.players.filter((p) => !p.folded);
    if (activePlayers.length === 1) {
      await this.showdown(room);
      return room;
    }

    // Check if all remaining players are all-in
    const playingPlayers = activePlayers.filter((p) => !p.allIn);
    if (playingPlayers.length <= 1 && activePlayers.length > 1) {
      // All players are all-in or only one can still act, deal remaining cards and showdown
      await this.dealRemainingCommunityCards(room);
      await this.showdown(room);
      return room;
    }

    // Move to next player
    this.moveToNextPlayer(room);

    // Check if round is complete
    if (this.isRoundComplete(room)) {
      console.log(
        `Round complete in room ${roomId}, moving to next phase. Current phase: ${room.phase}`
      );
      room = await this.nextPhase(roomId);
    } else {
      // Set timeout for next player
      if (room.status === "playing" && room.currentTurn) {
        this.setPlayerTimeout(roomId, room.currentTurn);
      }
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

  async nextPhase(roomId) {
    const room = await this.getRoom(roomId);

    console.log(
      `nextPhase called for room ${roomId}, current phase: ${room.phase}, community cards: ${room.community.length}`
    );

    // Deal community cards based on phase
    switch (room.phase) {
      case "preflop":
        // Burn one card, then deal flop (3 cards)
        if (room.deck.length > 3) {
          room.deck.pop(); // Burn card
          room.community.push(
            room.deck.pop(),
            room.deck.pop(),
            room.deck.pop()
          );
        }
        room.phase = "flop";
        console.log(`Dealt flop: ${room.community.length} community cards`);
        break;

      case "flop":
        // Burn one card, then deal turn (1 card)
        if (room.deck.length > 1) {
          room.deck.pop(); // Burn card
          room.community.push(room.deck.pop());
        }
        room.phase = "turn";
        console.log(`Dealt turn: ${room.community.length} community cards`);
        break;

      case "turn":
        // Burn one card, then deal river (1 card)
        if (room.deck.length > 1) {
          room.deck.pop(); // Burn card
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

    // Reset for new betting round

    room.currentBet = 0;
    room.lastRaiser = null;
    room.playersActedThisRound = [];

    // Reset player bets for new round
    for (const player of room.players) {
      player.bet = 0;
    }

    // Set first active player as current turn
    const activePlayers = room.players.filter((p) => !p.folded && !p.allIn);
    if (activePlayers.length > 0) {
      room.currentTurn = activePlayers[0].id;
      this.setPlayerTimeout(roomId, room.currentTurn);
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
    const neededCards = 5 - room.community.length;

    for (let i = 0; i < neededCards; i++) {
      if (room.deck.length >= 2) {
        room.deck.pop(); // Burn card
        room.community.push(room.deck.pop()); // Deal card
      } else if (room.deck.length === 1) {
        room.community.push(room.deck.pop()); // Last card, no burn
      }
    }

    room.phase = "showdown";
    console.log(
      `Dealt ${neededCards} remaining community cards for all-in situation in room ${room.id}`
    );
  }

  async showdown(room) {
    const activePlayers = room.players.filter((p) => !p.folded);

    if (activePlayers.length === 1) {
      // Only one player left, they win the pot
      const winner = activePlayers[0];
      winner.chips += room.pot;

      this.ws.broadcastToRoom(room.id, {
        type: "showdown",
        results: [
          {
            playerId: winner.id,
            hand: winner.hand,
            handValue: { name: "Winner by default", score: 0 },
            score: 0,
          },
        ],
        winners: [{ playerId: winner.id, winAmount: room.pot }],
        room: room,
      });
    } else {
      // Multiple players, evaluate hands
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

      // Find all winners (players with highest score)
      const winners = results.filter((r) => r.score === results[0].score);
      console.log("winners", winners);

      // Calculate win amount per winner
      const winAmount = Math.floor(room.pot / winners.length);
      const remainder = room.pot % winners.length;

      // Award pot to winner(s)
      const winnersWithAmount = [];
      for (let i = 0; i < winners.length; i++) {
        const winner = winners[i];
        const player = room.players.find((p) => p.id === winner.playerId);
        console.log("Awarding chips to player: ", player?.id);

        if (player) {
          // First winner(s) get any remainder chips
          const amount = winAmount + (i < remainder ? 1 : 0);
          player.chips += amount;
          winnersWithAmount.push({
            playerId: winner.playerId,
            winAmount: amount,
          });
        }
      }

      // Notify all players via WebSocket
      this.ws.broadcastToRoom(room.id, {
        type: "showdown",
        results: results,
        winners: winnersWithAmount,
        room: room,
      });
    }

    // Reset game state
    this.resetGameState(room);

    console.log(`Poker showdown completed in room ${room.id}`);
  }

  resetGameState(room) {
    room.status = "waiting";
    room.state = "waiting";
    room.phase = "waiting";
    room.pot = 0;
    room.community = [];
    room.currentBet = 0;
    room.currentTurn = null;
    room.lastRaiser = null;
    room.playersActedThisRound = [];

    // Only move dealer if we have enough players for next hand
    const activePlayers = room.players.filter((p) => p.chips > 0);
    if (activePlayers.length >= 2) {
      room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
    }

    // Reset player states
    for (const player of room.players) {
      player.hand = [];
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
    }

    // Remove players with no chips
    room.players = room.players.filter((p) => p.chips > 0);
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

    // Clear all timeouts for this room
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
    const activePlayers = room.players.filter((p) => !p.folded && !p.allIn);

    if (activePlayers.length <= 1) {
      room.currentTurn =
        activePlayers.length === 1 ? activePlayers[0].id : null;
      return;
    }

    const currentIndex = activePlayers.findIndex(
      (p) => p.id === room.currentTurn
    );

    if (currentIndex === -1) {
      room.currentTurn = activePlayers[0].id;
      return;
    }

    const nextIndex = (currentIndex + 1) % activePlayers.length;
    room.currentTurn = activePlayers[nextIndex].id;
  }

  isRoundComplete(room) {
    const activePlayers = room.players.filter((p) => !p.folded);

    // Only one player remains
    if (activePlayers.length <= 1) {
      return true;
    }

    // All active players are all-in
    const playingPlayers = activePlayers.filter((p) => !p.allIn);
    if (playingPlayers.length <= 1) {
      return true;
    }

    const playersNeedingAction = playingPlayers.filter((p) => {
      const hasActed = room.playersActedThisRound.includes(p.id);
      const needsToMatchBet = room.currentBet > 0 && p.bet < room.currentBet;
      return !hasActed || needsToMatchBet;
    });

    if (playersNeedingAction.length > 0) {
      console.log(
        `🕓 Waiting on:`,
        playersNeedingAction.map((p) => p.id)
      );
    }

    return playersNeedingAction.length === 0;
  }

  // Hand evaluation methods (keeping your existing implementation)
  evaluateHand(playerHand, communityCards) {
    const allCards = [...playerHand, ...communityCards];

    if (allCards.length < 5) {
      return { name: "Incomplete Hand", score: 0 };
    }

    const cards = allCards.map((card) => ({
      rank: card.rank,
      suit: card.suit,
      value: this.getRankValue(card.rank),
    }));

    const sortedCards = cards.sort((a, b) => b.value - a.value);

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
