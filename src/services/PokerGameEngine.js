/**
 * Core poker game engine - handles pure game logic
 * Separated from service layer for better testing and modularity
 */
class PokerGameEngine {
  constructor() {
    this.HAND_RANKINGS = {
      ROYAL_FLUSH: 9,
      STRAIGHT_FLUSH: 8,
      FOUR_OF_A_KIND: 7,
      FULL_HOUSE: 6,
      FLUSH: 5,
      STRAIGHT: 4,
      THREE_OF_A_KIND: 3,
      TWO_PAIR: 2,
      PAIR: 1,
      HIGH_CARD: 0,
    };
  }

  // Game State Management
  createInitialGameState(roomOptions) {
    const {
      name,
      creatorId,
      maxPlayers = 6,
      minBet = 10,
      maxBet = 1000,
    } = roomOptions;

    const roomId = `poker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: roomId,
      name,
      creator: { id: creatorId },
      players: [],
      maxPlayers,
      minBet,
      maxBet,

      // Game State
      status: "waiting", // waiting, playing, finished
      phase: "waiting", // waiting, preflop, flop, turn, river, showdown
      pot: 0,
      currentBet: 0,
      currentTurn: null,
      lastRaiser: null,

      // Cards
      deck: [],
      communityCards: [],

      // Dealer & Blinds
      dealerIndex: 0,
      smallBlind: null,
      bigBlind: null,

      // Round tracking
      playersActedThisRound: [],

      // Metadata
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Player Management
  addPlayerToRoom(room, playerData) {
    const { id, username } = playerData;

    if (room.players.find((p) => p.id === id)) {
      throw new Error("Player already in room");
    }

    if (room.players.length >= room.maxPlayers) {
      throw new Error("Room is full");
    }

    const player = {
      id,
      username,
      chips: 1000, // Starting chips
      bet: 0,
      status: "active",
      hand: [],
      folded: false,
      allIn: false,
      connected: true,
      lastSeen: Date.now(),
    };

    room.players.push(player);
    room.updatedAt = new Date().toISOString();

    return room;
  }

  removePlayerFromRoom(room, playerId) {
    const playerIndex = room.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) {
      throw new Error("Player not in room");
    }

    room.players.splice(playerIndex, 1);
    room.updatedAt = new Date().toISOString();

    return room;
  }

  // Game Flow
  startNewHand(room) {
    if (room.players.length < 2) {
      throw new Error("Need at least 2 players to start");
    }

    // Reset game state
    room.status = "playing";
    room.phase = "preflop";
    room.pot = 0;
    room.communityCards = [];
    room.currentBet = 0;
    room.lastRaiser = null;
    room.playersActedThisRound = [];

    // Reset player states
    room.players.forEach((player) => {
      player.hand = [];
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
      player.status = "active";
    });

    // Create and shuffle deck
    room.deck = this.createDeck();
    room.deck = this.shuffleDeck(room.deck);

    // Set dealer and blinds
    this.assignDealerAndBlinds(room);

    // Deal hole cards
    this.dealHoleCards(room);

    // Set first player to act
    this.setFirstPlayerToAct(room);

    room.updatedAt = new Date().toISOString();
    return room;
  }

  processPlayerAction(room, playerId, action, amount = 0) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("Player not found");
    if (room.currentTurn !== playerId) throw new Error("Not your turn");
    if (player.folded) throw new Error("Player has folded");

    // Process the action
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
        this.processCall(room, player);
        break;

      case "bet":
        this.processBet(room, player, amount);
        break;

      case "raise":
        this.processRaise(room, player, amount);
        break;

      case "allin":
        this.processAllIn(room, player);
        break;

      default:
        throw new Error("Invalid action");
    }

    // Add player to acted list
    if (!room.playersActedThisRound.includes(playerId)) {
      room.playersActedThisRound.push(playerId);
    }

    room.updatedAt = new Date().toISOString();
    return room;
  }

  // Action Processing
  processCall(room, player) {
    const callAmount = room.currentBet - player.bet;
    if (callAmount <= 0) return;

    const actualCall = Math.min(callAmount, player.chips);
    player.chips -= actualCall;
    player.bet += actualCall;
    room.pot += actualCall;

    if (player.chips === 0) {
      player.allIn = true;
    }
  }

  processBet(room, player, amount) {
    if (room.currentBet > 0) {
      throw new Error("Cannot bet when there is already a bet");
    }
    if (amount < room.minBet) {
      throw new Error(`Bet must be at least ${room.minBet}`);
    }
    if (amount > player.chips) {
      throw new Error("Not enough chips");
    }

    player.chips -= amount;
    player.bet = amount;
    room.pot += amount;
    room.currentBet = amount;
    room.lastRaiser = player.id;
    room.playersActedThisRound = [player.id];

    if (player.chips === 0) {
      player.allIn = true;
    }
  }

  processRaise(room, player, raiseAmount) {
    const totalBet = room.currentBet + raiseAmount;
    if (totalBet > player.chips + player.bet) {
      throw new Error("Not enough chips");
    }
    if (raiseAmount < room.minBet) {
      throw new Error(`Raise must be at least ${room.minBet}`);
    }

    const additionalAmount = totalBet - player.bet;
    player.chips -= additionalAmount;
    player.bet = totalBet;
    room.pot += additionalAmount;
    room.currentBet = totalBet;
    room.lastRaiser = player.id;
    room.playersActedThisRound = [player.id];

    if (player.chips === 0) {
      player.allIn = true;
    }
  }

  processAllIn(room, player) {
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
      room.playersActedThisRound = [player.id];
    }
  }

  // Game Flow Helpers
  assignDealerAndBlinds(room) {
    const activePlayers = room.players.filter((p) => p.chips > 0);
    if (activePlayers.length < 2) return;

    // Move dealer button
    room.dealerIndex = room.dealerIndex % activePlayers.length;

    // Assign blinds
    if (activePlayers.length === 2) {
      // Heads-up: dealer is small blind
      room.smallBlind = activePlayers[room.dealerIndex].id;
      room.bigBlind =
        activePlayers[(room.dealerIndex + 1) % activePlayers.length].id;
    } else {
      // Multi-way: small blind is left of dealer
      room.smallBlind =
        activePlayers[(room.dealerIndex + 1) % activePlayers.length].id;
      room.bigBlind =
        activePlayers[(room.dealerIndex + 2) % activePlayers.length].id;
    }

    // Post blinds
    this.postBlinds(room);
  }

  postBlinds(room) {
    const sbPlayer = room.players.find((p) => p.id === room.smallBlind);
    const bbPlayer = room.players.find((p) => p.id === room.bigBlind);

    const sbAmount = Math.floor(room.minBet / 2);
    const bbAmount = room.minBet;

    // Post small blind
    const sbPost = Math.min(sbAmount, sbPlayer.chips);
    sbPlayer.chips -= sbPost;
    sbPlayer.bet = sbPost;
    room.pot += sbPost;
    if (sbPlayer.chips === 0) sbPlayer.allIn = true;

    // Post big blind
    const bbPost = Math.min(bbAmount, bbPlayer.chips);
    bbPlayer.chips -= bbPost;
    bbPlayer.bet = bbPost;
    room.pot += bbPost;
    if (bbPlayer.chips === 0) bbPlayer.allIn = true;

    room.currentBet = bbPlayer.bet;
    room.lastRaiser = room.bigBlind;
  }

  dealHoleCards(room) {
    // Deal 2 cards to each player
    for (let i = 0; i < 2; i++) {
      for (const player of room.players) {
        if (room.deck.length > 0) {
          player.hand.push(room.deck.pop());
        }
      }
    }
  }

  setFirstPlayerToAct(room) {
    const activePlayers = room.players.filter((p) => !p.folded && !p.allIn);
    if (activePlayers.length === 0) return;

    // First to act is left of big blind in preflop
    const bbIndex = room.players.findIndex((p) => p.id === room.bigBlind);
    const firstPlayerIndex = (bbIndex + 1) % room.players.length;

    // Find next active player
    let currentIndex = firstPlayerIndex;
    while (
      room.players[currentIndex].folded ||
      room.players[currentIndex].allIn
    ) {
      currentIndex = (currentIndex + 1) % room.players.length;
      if (currentIndex === firstPlayerIndex) break; // Prevent infinite loop
    }

    room.currentTurn = room.players[currentIndex].id;
  }

  // Round Management
  isRoundComplete(room) {
    const activePlayers = room.players.filter((p) => !p.folded);

    // Only one player left
    if (activePlayers.length <= 1) return true;

    // All active players are all-in
    const playingPlayers = activePlayers.filter((p) => !p.allIn);
    if (playingPlayers.length <= 1) return true;

    // Check if all playing players have acted and matched the current bet
    const playersNeedingAction = playingPlayers.filter((p) => {
      const hasActed = room.playersActedThisRound.includes(p.id);
      const needsToMatchBet = room.currentBet > 0 && p.bet < room.currentBet;
      return !hasActed || needsToMatchBet;
    });

    return playersNeedingAction.length === 0;
  }

  moveToNextPhase(room) {
    switch (room.phase) {
      case "preflop":
        this.dealFlop(room);
        room.phase = "flop";
        break;
      case "flop":
        this.dealTurn(room);
        room.phase = "turn";
        break;
      case "turn":
        this.dealRiver(room);
        room.phase = "river";
        break;
      case "river":
        room.phase = "showdown";
        return this.processShowdown(room);
    }

    // Reset for new betting round
    room.currentBet = 0;
    room.lastRaiser = null;
    room.playersActedThisRound = [];

    // Reset player bets
    room.players.forEach((p) => (p.bet = 0));

    // Set first player to act (left of dealer)
    this.setFirstPlayerPostFlop(room);

    return room;
  }

  dealFlop(room) {
    if (room.deck.length >= 4) {
      room.deck.pop(); // Burn card
      room.communityCards.push(
        room.deck.pop(),
        room.deck.pop(),
        room.deck.pop()
      );
    }
  }

  dealTurn(room) {
    if (room.deck.length >= 2) {
      room.deck.pop(); // Burn card
      room.communityCards.push(room.deck.pop());
    }
  }

  dealRiver(room) {
    if (room.deck.length >= 2) {
      room.deck.pop(); // Burn card
      room.communityCards.push(room.deck.pop());
    }
  }

  setFirstPlayerPostFlop(room) {
    const activePlayers = room.players.filter((p) => !p.folded && !p.allIn);
    if (activePlayers.length === 0) return;

    // First to act post-flop is left of dealer
    const dealerIndex = room.dealerIndex;
    let currentIndex = (dealerIndex + 1) % room.players.length;

    // Find next active player
    while (
      room.players[currentIndex].folded ||
      room.players[currentIndex].allIn
    ) {
      currentIndex = (currentIndex + 1) % room.players.length;
      if (currentIndex === (dealerIndex + 1) % room.players.length) break;
    }

    room.currentTurn = room.players[currentIndex].id;
  }

  // Showdown
  processShowdown(room) {
    const activePlayers = room.players.filter((p) => !p.folded);

    if (activePlayers.length === 1) {
      // Only one player left - they win
      const winner = activePlayers[0];
      winner.chips += room.pot;

      return {
        type: "single_winner",
        winner: winner.id,
        winAmount: room.pot,
        results: [],
      };
    }

    // Evaluate all hands
    const results = activePlayers.map((player) => {
      const handValue = this.evaluateHand(player.hand, room.communityCards);
      return {
        playerId: player.id,
        hand: player.hand,
        handValue,
        score: handValue.score,
      };
    });

    // Sort by score (highest wins)
    results.sort((a, b) => b.score - a.score);

    // Find winners (players with highest score)
    const winners = results.filter((r) => r.score === results[0].score);

    // Distribute pot
    const winAmount = Math.floor(room.pot / winners.length);
    const remainder = room.pot % winners.length;

    const winnersWithAmount = winners.map((winner, index) => {
      const player = room.players.find((p) => p.id === winner.playerId);
      const amount = winAmount + (index < remainder ? 1 : 0);
      player.chips += amount;

      return {
        playerId: winner.playerId,
        winAmount: amount,
      };
    });

    return {
      type: "showdown",
      results,
      winners: winnersWithAmount,
    };
  }

  // Utility Methods
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

  // Hand Evaluation (keeping your existing implementation)
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

    // Check hands in order of strength
    return (
      this.checkRoyalFlush(sortedCards) ||
      this.checkStraightFlush(sortedCards) ||
      this.checkFourOfAKind(sortedCards) ||
      this.checkFullHouse(sortedCards) ||
      this.checkFlush(sortedCards) ||
      this.checkStraight(sortedCards) ||
      this.checkThreeOfAKind(sortedCards) ||
      this.checkTwoPair(sortedCards) ||
      this.checkPair(sortedCards) ||
      this.checkHighCard(sortedCards)
    );
  }

  getRankValue(rank) {
    const values = {
      2: 2,
      3: 3,
      4: 4,
      5: 5,
      6: 6,
      7: 7,
      8: 8,
      9: 9,
      10: 10,
      J: 11,
      Q: 12,
      K: 13,
      A: 14,
    };
    return values[rank] || 0;
  }

  // Hand evaluation methods (keeping your existing implementation)
  checkRoyalFlush(cards) {
    const straightFlush = this.checkStraightFlush(cards);
    if (straightFlush && straightFlush.cards[0].value === 14) {
      return {
        name: "Royal Flush",
        score: 9000 + straightFlush.cards[0].value,
        cards: straightFlush.cards,
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
        score: 4000 + 5,
        cards: wheelCards,
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
    };
  }

  checkTwoPair(cards) {
    const groups = this.groupByRank(cards);
    const pairs = Object.entries(groups).filter(
      ([_, cards]) => cards.length >= 2
    );

    if (pairs.length < 2) return null;

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
    };
  }

  groupByRank(cards) {
    const groups = {};
    for (const card of cards) {
      if (!groups[card.rank]) groups[card.rank] = [];
      groups[card.rank].push(card);
    }
    return groups;
  }

  groupBySuit(cards) {
    const groups = {};
    for (const card of cards) {
      if (!groups[card.suit]) groups[card.suit] = [];
      groups[card.suit].push(card);
    }
    return groups;
  }

  isConsecutive(values) {
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] - 1) return false;
    }
    return true;
  }
}

export default PokerGameEngine;
