import PokerService from "./src/services/EnhancedPokerService.js";

// Mock dependencies
const mockRedisClient = {
  data: new Map(),
  sets: new Map(),

  async set(key, value) {
    this.data.set(key, value);
    return "OK";
  },

  async get(key) {
    return this.data.get(key) || null;
  },

  async del(key) {
    return this.data.delete(key) ? 1 : 0;
  },

  async sadd(key, value) {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    this.sets.get(key).add(value);
    return 1;
  },

  async srem(key, value) {
    if (this.sets.has(key)) {
      return this.sets.get(key).delete(value) ? 1 : 0;
    }
    return 0;
  },

  async smembers(key) {
    return this.sets.has(key) ? Array.from(this.sets.get(key)) : [];
  },
};

const mockWebSocketService = {
  broadcastToRoom(roomId, message) {
    console.log(`[WebSocket] Room ${roomId}:`, message.type, message);
  },
};

const mockRedisService = {
  client: mockRedisClient,
};

const mockLogger = {
  error: console.error,
};

// Mock the imports
global.RedisService = mockRedisService;
global.WebSocketService = mockWebSocketService;
global.logger = mockLogger;

class SmartBot {
  constructor(id, name, aggressiveness = 0.5, bluffChance = 0.1) {
    this.id = id;
    this.name = name;
    this.aggressiveness = aggressiveness; // 0-1, how aggressive the bot is
    this.bluffChance = bluffChance; // 0-1, chance to bluff with weak hands
    this.raisesThisRound = 0; // Track raises per round
    this.maxRaisesPerRound = 2; // Limit raises to prevent infinite loops
  }

  // Reset raise counter for new betting round
  resetRoundStats() {
    this.raisesThisRound = 0;
  }

  // Evaluate hand strength (0-1)
  evaluateHandStrength(hand, community, pokerService) {
    if (!hand || hand.length !== 2) return 0;

    const allCards = [...hand, ...community];
    const handValue = pokerService.evaluateHand(hand, community);

    // Normalize score to 0-1 range
    let strength = 0;

    if (handValue.score >= 9000)
      strength = 1.0; // Royal flush
    else if (handValue.score >= 8000)
      strength = 0.95; // Straight flush
    else if (handValue.score >= 7000)
      strength = 0.9; // Four of a kind
    else if (handValue.score >= 6000)
      strength = 0.85; // Full house
    else if (handValue.score >= 5000)
      strength = 0.75; // Flush
    else if (handValue.score >= 4000)
      strength = 0.65; // Straight
    else if (handValue.score >= 3000)
      strength = 0.55; // Three of a kind
    else if (handValue.score >= 2000)
      strength = 0.45; // Two pair
    else if (handValue.score >= 1000)
      strength = 0.35; // Pair
    else strength = Math.max(0.1, handValue.score / 10000); // High card

    // Adjust for pre-flop play
    if (community.length === 0) {
      strength = this.evaluatePreFlopStrength(hand);
    }

    return Math.min(1.0, strength);
  }

  evaluatePreFlopStrength(hand) {
    const [card1, card2] = hand;
    const val1 = this.getCardValue(card1.rank);
    const val2 = this.getCardValue(card2.rank);
    const isPair = val1 === val2;
    const isSuited = card1.suit === card2.suit;
    const isConnected = Math.abs(val1 - val2) <= 1;
    const highCard = Math.max(val1, val2);

    let strength = 0;

    if (isPair) {
      if (highCard >= 10)
        strength = 0.8 + (highCard - 10) * 0.05; // High pairs
      else if (highCard >= 7)
        strength = 0.6 + (highCard - 7) * 0.05; // Medium pairs
      else strength = 0.4 + (highCard - 2) * 0.02; // Low pairs
    } else {
      // High cards - Fixed: K2 should not be strong!
      if (highCard >= 12 && Math.min(val1, val2) >= 10) {
        strength = 0.6 + (highCard - 12) * 0.1; // Both face cards
      } else if (highCard >= 12 && Math.min(val1, val2) >= 8) {
        strength = 0.4 + (highCard - 12) * 0.05; // One face card + decent kicker
      } else if (highCard >= 12) {
        strength = 0.25 + (Math.min(val1, val2) - 2) * 0.02; // Face card + low kicker
      } else if (highCard >= 10) {
        strength = 0.2 + (highCard - 10) * 0.05;
      } else {
        strength = 0.1 + (highCard - 2) * 0.02;
      }

      // Bonuses
      if (isSuited) strength += 0.05; // Reduced suited bonus
      if (isConnected) strength += 0.03; // Reduced connector bonus
    }

    return Math.min(0.9, strength);
  }

  getCardValue(rank) {
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

  // Make decision based on game state
  makeDecision(room, pokerService) {
    const player = room.players.find((p) => p.id === this.id);
    if (!player || player.folded || player.allIn) {
      return { action: "fold", amount: 0 };
    }

    const handStrength = this.evaluateHandStrength(
      player.hand,
      room.community,
      pokerService
    );
    const potOdds = this.calculatePotOdds(room, player);
    const position = this.getPosition(room, player);

    // Count total raises this round by all players
    const totalRaisesThisRound = this.countRaisesThisRound(room);

    console.log(
      `[${this.name}] Hand strength: ${handStrength.toFixed(2)}, Pot odds: ${potOdds.toFixed(2)}, Position: ${position}, Raises: ${totalRaisesThisRound}`
    );

    // Determine if we should bluff (less often in multi-way pots)
    const activePlayers = room.players.filter((p) => !p.folded).length;
    const adjustedBluffChance =
      this.bluffChance / Math.max(1, activePlayers - 2);
    const shouldBluff =
      Math.random() < adjustedBluffChance && handStrength < 0.25;

    const effectiveStrength = shouldBluff
      ? Math.min(0.7, handStrength + 0.3)
      : handStrength;

    const callAmount = room.currentBet - player.bet;
    const canCheck = callAmount === 0;

    // More conservative thresholds to prevent crazy betting
    const foldThreshold = 0.2 + (1 - this.aggressiveness) * 0.15;
    const raiseThreshold = 0.65 - this.aggressiveness * 0.15;

    // Increase thresholds based on number of raises
    const raiseAdjustment = totalRaisesThisRound * 0.1;
    const adjustedFoldThreshold = foldThreshold + raiseAdjustment;
    const adjustedRaiseThreshold = raiseThreshold + raiseAdjustment;

    // Don't raise if we've already raised too much this round
    const canRaise =
      this.raisesThisRound < this.maxRaisesPerRound && totalRaisesThisRound < 4; // Global limit

    // All-in threshold (much more conservative)
    if (effectiveStrength > 0.9 && room.pot > player.chips * 0.2) {
      return { action: "allin", amount: 0 };
    }

    // Fold weak hands, especially in raised pots
    if (effectiveStrength < adjustedFoldThreshold && callAmount > 0) {
      return { action: "fold", amount: 0 };
    }

    // Strong hands - raise or bet (but with limits)
    if (effectiveStrength > adjustedRaiseThreshold && canRaise) {
      if (room.currentBet === 0) {
        // Initial bet
        const betAmount = Math.min(
          Math.floor(
            room.pot * 0.3 + room.minBet * (0.5 + this.aggressiveness * 0.5)
          ),
          player.chips,
          room.maxBet
        );
        return { action: "bet", amount: Math.max(room.minBet, betAmount) };
      } else {
        // Raise - much smaller sizing
        const baseRaise = room.minBet * (0.5 + this.aggressiveness);
        const potBasedRaise = room.pot * 0.2; // Smaller pot-based raises
        const raiseAmount = Math.min(
          Math.floor(Math.max(baseRaise, potBasedRaise)),
          player.chips - callAmount,
          room.maxBet - room.currentBet,
          callAmount * 2 // Cap raise at 2x the call amount
        );

        if (raiseAmount >= room.minBet) {
          this.raisesThisRound++; // Track our raises
          return { action: "raise", amount: raiseAmount };
        }
      }
    }

    // Medium hands - call or check (but be more selective in raised pots)
    const callThreshold = totalRaisesThisRound > 2 ? 0.4 : 0.25;
    if (effectiveStrength > callThreshold || potOdds > 4) {
      if (canCheck) {
        return { action: "check", amount: 0 };
      } else if (
        callAmount <= player.chips &&
        callAmount <= player.chips * 0.3
      ) {
        return { action: "call", amount: 0 };
      }
    }

    // Default: fold or check
    return canCheck
      ? { action: "check", amount: 0 }
      : { action: "fold", amount: 0 };
  }

  // Count total raises this betting round
  countRaisesThisRound(room) {
    // This would need to be tracked by your poker service
    // For now, estimate based on bet sizes
    const minBet = room.minBet || 20;
    const currentBet = room.currentBet;

    if (currentBet <= minBet * 2) return 0;
    if (currentBet <= minBet * 4) return 1;
    if (currentBet <= minBet * 8) return 2;
    if (currentBet <= minBet * 12) return 3;
    return Math.floor(currentBet / (minBet * 4));
  }

  calculatePotOdds(room, player) {
    const callAmount = room.currentBet - player.bet;
    if (callAmount === 0) return Infinity;
    return room.pot / callAmount;
  }

  getPosition(room, player) {
    const activePlayers = room.players.filter((p) => !p.folded);
    const playerIndex = activePlayers.findIndex((p) => p.id === player.id);
    const totalPlayers = activePlayers.length;

    if (playerIndex < totalPlayers / 3) return "early";
    if (playerIndex < (totalPlayers * 2) / 3) return "middle";
    return "late";
  }
}

class PokerGameSimulator {
  constructor() {
    this.pokerService = new PokerService();
    this.bots = [];
    this.room = null;
    this.gameRunning = false;
  }

  async setupGame() {
    console.log("🎰 Setting up poker game simulation...\n");

    // Create 5 smart bots with different personalities
    this.bots = [
      new SmartBot("bot1", "Alice", 0.7, 0.15), // Aggressive, bluffs occasionally
      new SmartBot("bot2", "Bob", 0.3, 0.05), // Conservative, rarely bluffs
      new SmartBot("bot3", "Charlie", 0.8, 0.25), // Very aggressive, bluffs often
      new SmartBot("bot4", "Diana", 0.5, 0.1), // Balanced player
      new SmartBot("bot5", "Eve", 0.4, 0.2), // Tight but bluffs sometimes
    ];

    // Create room
    this.room = await this.pokerService.createRoom({
      name: "Test Poker Room",
      creatorId: "bot1",
      maxPlayers: 6,
      minBet: 20,
      maxBet: 500,
    });

    console.log(`✅ Room created: ${this.room.id}`);

    // Add all bots to room
    for (const bot of this.bots) {
      await this.pokerService.joinRoom(this.room.id, bot.id);
      console.log(`✅ ${bot.name} joined the room`);
    }

    console.log("\n🎲 Starting the game...\n");
  }

  async simulateGame() {
    this.gameRunning = true;
    let handCount = 0;
    const maxHands = 5; // Simulate 5 hands

 

      try {
        // Start the game
        this.room = await this.pokerService.startGame(this.room.id, "bot1");
        await this.displayGameState();

        // Play the hand
        await this.playHand();

        // Check if any player is out of chips
        const activePlayers = this.room.players.filter((p) => p.chips > 0);
        if (activePlayers.length <= 1) {
          console.log("\n🏆 Game over! Only one player has chips remaining.");
          this.gameRunning = false;
        
        }

        // Wait before next hand
        await this.sleep(1000);
      } catch (error) {
        console.error("❌ Error during hand:", error.message);
        
      }
    

    console.log("\n" + "=".repeat(50));
    console.log("🎊 GAME SIMULATION COMPLETE");
    console.log("=".repeat(50));
    this.displayFinalResults();
  }

  async getRoom(roomId) {
    const raw = await this.pokerService.getRoom(roomId);
    console.log("Fetched room from pokerservice:", raw);
    return raw;
  }

  async playHand() {
    let actionsInRound = 0;
    const maxActionsPerRound = 20;

    while (
      this.room.status === "playing" &&
      actionsInRound < maxActionsPerRound
    ) {
      const currentPlayer = this.room.players.find(
        (p) => p.id === this.room.currentTurn
      );

      if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn) {
        console.log("⚠️ Current player is not available for action");
        break;
      }

      const bot = this.bots.find((b) => b.id === currentPlayer.id);
      if (!bot) {
        console.log("⚠️ No bot found for current player");
        break;
      }

      try {
        const decision = bot.makeDecision(this.room, this.pokerService);
        console.log(
          `🤖 ${bot.name}: ${decision.action}${decision.amount > 0 ? ` $${decision.amount}` : ""}`
        );

        const roomAfterAction= await this.pokerService.playerAction(
          this.room.id,
          bot.id,
          decision.action,
          decision.amount
        );

        console.log(`logging return room after player action`, roomAfterAction);

        this.room = roomAfterAction

        await this.displayGameState();
        // await this.getRoom(this.room.id)
        actionsInRound++;

        // Small delay between actions
        await this.sleep(500);
      } catch (error) {
        console.log(`❌ ${bot.name} action failed: ${error.message}`);
        break;
      }
    }

    if (actionsInRound >= maxActionsPerRound) {
      console.log("⚠️ Maximum actions per round reached, ending hand");
    }
  }

  async displayGameState() {
    console.log(`\n📊 Game State - ${this.room.phase.toUpperCase()}`);
    console.log(
      `💰 Pot: $${this.room.pot} | Current Bet: $${this.room.currentBet}`
    );

    if (this.room.community.length > 0) {
      console.log(
        `🃏 Community: ${this.room.community.map((c) => `${c.rank}${this.getSuitSymbol(c.suit)}`).join(" ")}`
      );
    }

    console.log("\n👥 Players:");
    for (const player of this.room.players) {
      const bot = this.bots.find((b) => b.id === player.id);
      const status = player.folded
        ? "❌"
        : player.allIn
          ? "🎯"
          : this.room.currentTurn === player.id
            ? "👈"
            : "  ";
      const handStr =
        player.hand.length > 0
          ? `[${player.hand.map((c) => `${c.rank}${this.getSuitSymbol(c.suit)}`).join(" ")}]`
          : "[??]";

      console.log(
        `${status} ${bot ? bot.name : player.id}: $${player.chips} chips, bet: $${player.bet} ${handStr}`
      );
    }
    console.log();
  }

  getSuitSymbol(suit) {
    const symbols = {
      hearts: "♥️",
      diamonds: "♦️",
      clubs: "♣️",
      spades: "♠️",
    };
    return symbols[suit] || suit;
  }

  displayFinalResults() {
    console.log("\n🏁 Final Results:");
    const sortedPlayers = [...this.room.players].sort(
      (a, b) => b.chips - a.chips
    );

    sortedPlayers.forEach((player, index) => {
      const bot = this.bots.find((b) => b.id === player.id);
      const position =
        index === 0
          ? "🥇"
          : index === 1
            ? "🥈"
            : index === 2
              ? "🥉"
              : `${index + 1}.`;
      console.log(
        `${position} ${bot ? bot.name : player.id}: $${player.chips} chips`
      );
    });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Run the simulation
async function runSimulation() {
  const simulator = new PokerGameSimulator();

  try {
    await simulator.setupGame();
    await simulator.simulateGame();
  } catch (error) {
    console.error("❌ Simulation failed:", error);
  }
}

// Execute the simulation
console.log("🚀 Starting Poker Game Simulation...\n");
runSimulation().catch(console.error);
