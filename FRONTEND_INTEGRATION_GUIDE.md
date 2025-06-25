# Frontend Integration Guide for Fixed Poker Backend

## Overview

This guide provides complete React Native frontend integration code for the fixed Texas Hold'em poker backend. All the backend logic issues have been resolved, and this guide shows how to properly handle WebSocket messages and game state.

## WebSocket Message Types

The backend now sends consistent, fully-updated state with these message types:

### 1. `game_started`

```javascript
{
  type: "game_started",
  room: {
    id: "poker_1234567890_abc123",
    status: "playing",
    phase: "preflop",
    pot: 15,
    currentBet: 10,
    currentTurn: "player1",
    players: [
      {
        id: "player1",
        username: "Player1",
        chips: 990,
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        isDealer: true,
        isSmallBlind: false,
        isBigBlind: false,
        hand: [{ suit: "hearts", rank: "A" }, { suit: "diamonds", rank: "K" }]
      }
    ],
    community: [],
    dealerPosition: 0,
    smallBlind: 5,
    bigBlind: 10
  }
}
```

### 2. `player_action`

```javascript
{
  type: "player_action",
  playerId: "player1",
  action: "raise",
  amount: 30,
  room: {
    // Complete updated room state
    pot: 45,
    currentBet: 30,
    currentTurn: "player2",
    players: [
      // Updated player states
    ],
    community: [],
    phase: "preflop"
  }
}
```

### 3. `phase_change`

```javascript
{
  type: "phase_change",
  phase: "flop",
  community: [
    { suit: "hearts", rank: "A" },
    { suit: "diamonds", rank: "K" },
    { suit: "clubs", rank: "Q" }
  ],
  room: {
    // Complete updated room state
    pot: 45,
    currentBet: 0,
    currentTurn: "player1",
    players: [
      // Reset bet amounts, updated states
    ]
  }
}
```

### 4. `showdown`

```javascript
{
  type: "showdown",
  results: [
    {
      playerId: "player1",
      username: "Player1",
      hand: [{ suit: "hearts", rank: "A" }, { suit: "diamonds", rank: "K" }],
      handValue: {
        name: "Pair",
        score: 1001,
        cards: [...],
        description: "Pair of As"
      },
      score: 1001
    }
  ],
  winners: [
    {
      playerId: "player1",
      username: "Player1",
      handValue: {...},
      score: 1001
    }
  ],
  room: {
    // Game reset state
    status: "waiting",
    phase: "waiting",
    pot: 0,
    players: [
      // Reset player states with updated chips
    ]
  }
}
```

### 5. `all_in_scenario`

```javascript
{
  type: "all_in_scenario",
  community: [
    // All 5 community cards
  ],
  room: {
    // Complete room state with all community cards
  }
}
```

## React Native Integration Code

### 1. WebSocket Hook

```javascript
// hooks/usePokerSocket.js
import { useState, useEffect, useRef, useCallback } from "react";

export const usePokerSocket = (roomId, playerId) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const reconnectTimeoutRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const wsUrl = __DEV__
        ? "ws://localhost:3000"
        : "wss://your-production-domain.com";

      const newSocket = new WebSocket(wsUrl);

      newSocket.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setError(null);

        // Subscribe to poker room
        newSocket.send(
          JSON.stringify({
            type: "subscribe",
            room: roomId,
            playerId: playerId,
          })
        );
      };

      newSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      newSocket.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);

        // Auto-reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      newSocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError("Connection failed");
      };

      setSocket(newSocket);
    } catch (err) {
      console.error("Error creating WebSocket:", err);
      setError("Failed to connect");
    }
  }, [roomId, playerId]);

  const handleMessage = useCallback((message) => {
    console.log("Received message:", message.type, message);

    switch (message.type) {
      case "game_started":
        setRoom(message.room);
        break;

      case "player_action":
        setRoom(message.room);
        break;

      case "phase_change":
        setRoom(message.room);
        break;

      case "showdown":
        setRoom(message.room);
        // Handle showdown results
        break;

      case "all_in_scenario":
        setRoom(message.room);
        break;

      case "player_joined":
        setRoom(message.room);
        break;

      case "player_left":
        setRoom(message.room);
        break;

      default:
        console.log("Unknown message type:", message.type);
    }
  }, []);

  const sendAction = useCallback(
    (action, amount = 0) => {
      if (socket && isConnected) {
        const message = {
          type: "poker_action",
          roomId: roomId,
          playerId: playerId,
          action: action,
          amount: amount,
        };
        socket.send(JSON.stringify(message));
      }
    },
    [socket, isConnected, roomId, playerId]
  );

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [connect]);

  return {
    socket,
    isConnected,
    room,
    error,
    sendAction,
  };
};
```

### 2. Poker Game Component

```javascript
// components/PokerGame.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Dimensions,
} from "react-native";
import { usePokerSocket } from "../hooks/usePokerSocket";
import { Card } from "./Card";
import { PlayerPosition } from "./PlayerPosition";

const { width, height } = Dimensions.get("window");

export const PokerGame = ({ roomId, playerId, username }) => {
  const { socket, isConnected, room, error, sendAction } = usePokerSocket(
    roomId,
    playerId
  );
  const [selectedAmount, setSelectedAmount] = useState(0);
  const [showdownResults, setShowdownResults] = useState(null);

  const currentPlayer = room?.players?.find((p) => p.id === playerId);
  const isMyTurn = room?.currentTurn === playerId;
  const canAct =
    isMyTurn && currentPlayer && !currentPlayer.folded && !currentPlayer.allIn;

  // Handle showdown results
  useEffect(() => {
    if (room?.phase === "showdown" && room?.status === "waiting") {
      // Game just ended, show results briefly
      setTimeout(() => {
        setShowdownResults(null);
      }, 5000);
    }
  }, [room?.phase, room?.status]);

  const handleAction = (action, amount = 0) => {
    if (!canAct) return;

    try {
      sendAction(action, amount);
    } catch (err) {
      Alert.alert("Error", "Failed to send action");
    }
  };

  const getValidActions = () => {
    if (!canAct || !currentPlayer || !room) return [];

    const actions = [];
    const currentBet = room.currentBet;
    const playerBet = currentPlayer.bet;
    const playerChips = currentPlayer.chips;

    // Always can fold
    actions.push({ type: "fold", label: "Fold" });

    // Check if can check
    if (currentBet === playerBet) {
      actions.push({ type: "check", label: "Check" });
    }

    // Can call if there's a bet to call
    if (currentBet > playerBet) {
      const callAmount = Math.min(currentBet - playerBet, playerChips);
      if (callAmount > 0) {
        actions.push({
          type: "call",
          label: `Call $${callAmount}`,
          amount: callAmount,
        });
      }
    }

    // Can bet if no current bet
    if (currentBet === 0 && playerChips >= room.minBet) {
      actions.push({
        type: "bet",
        label: `Bet $${room.minBet}`,
        amount: room.minBet,
      });
    }

    // Can raise if there's a current bet
    if (currentBet > 0 && playerChips >= room.minBet) {
      const minRaise = currentBet + room.minBet;
      if (playerChips >= minRaise) {
        actions.push({
          type: "raise",
          label: `Raise to $${minRaise}`,
          amount: minRaise,
        });
      }
    }

    // Can always go all-in
    if (playerChips > 0) {
      actions.push({
        type: "all-in",
        label: `All-In $${playerChips}`,
        amount: playerChips,
      });
    }

    return actions;
  };

  const renderCommunityCards = () => {
    if (!room?.community || room.community.length === 0) {
      return (
        <View style={styles.communityCardsContainer}>
          <Text style={styles.communityCardsLabel}>Community Cards</Text>
          <View style={styles.communityCardsPlaceholder}>
            <Text style={styles.placeholderText}>Waiting for cards...</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.communityCardsContainer}>
        <Text style={styles.communityCardsLabel}>Community Cards</Text>
        <View style={styles.communityCards}>
          {room.community.map((card, index) => (
            <Card
              key={index}
              card={card}
              faceUp={true}
              style={styles.communityCard}
            />
          ))}
        </View>
      </View>
    );
  };

  const renderPlayerPositions = () => {
    if (!room?.players) return null;

    const positions = calculatePlayerPositions(room.players.length);

    return room.players.map((player, index) => (
      <PlayerPosition
        key={player.id}
        player={player}
        position={positions[index]}
        isCurrentTurn={room.currentTurn === player.id}
        isCurrentPlayer={player.id === playerId}
        showCards={player.id === playerId}
      />
    ));
  };

  const renderActionButtons = () => {
    if (!canAct) return null;

    const actions = getValidActions();

    return (
      <View style={styles.actionButtonsContainer}>
        {actions.map((action, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.actionButton,
              action.type === "fold" && styles.foldButton,
              action.type === "call" && styles.callButton,
              action.type === "raise" && styles.raiseButton,
              action.type === "all-in" && styles.allInButton,
            ]}
            onPress={() => handleAction(action.type, action.amount)}
          >
            <Text style={styles.actionButtonText}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderGameInfo = () => {
    if (!room) return null;

    return (
      <View style={styles.gameInfoContainer}>
        <Text style={styles.gameInfoText}>
          Phase: {room.phase.toUpperCase()}
        </Text>
        <Text style={styles.gameInfoText}>Pot: ${room.pot}</Text>
        {room.currentBet > 0 && (
          <Text style={styles.gameInfoText}>
            Current Bet: ${room.currentBet}
          </Text>
        )}
        {room.currentTurn && (
          <Text style={styles.gameInfoText}>
            Current Turn:{" "}
            {room.players?.find((p) => p.id === room.currentTurn)?.username ||
              "Unknown"}
          </Text>
        )}
        {isMyTurn && <Text style={styles.yourTurnText}>YOUR TURN!</Text>}
      </View>
    );
  };

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Connection Error: {error}</Text>
        <TouchableOpacity style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>
          {isConnected ? "Waiting for game to start..." : "Connecting..."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Game Info */}
      {renderGameInfo()}

      {/* Community Cards */}
      {renderCommunityCards()}

      {/* Player Positions */}
      {renderPlayerPositions()}

      {/* Action Buttons */}
      {renderActionButtons()}

      {/* Connection Status */}
      <View style={styles.connectionStatus}>
        <View style={[styles.statusDot, isConnected && styles.connected]} />
        <Text style={styles.statusText}>
          {isConnected ? "Connected" : "Disconnected"}
        </Text>
      </View>
    </View>
  );
};

// Helper function to calculate player positions around the table
const calculatePlayerPositions = (playerCount) => {
  const positions = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.3;

  for (let i = 0; i < playerCount; i++) {
    const angle = (i * 2 * Math.PI) / playerCount - Math.PI / 2; // Start from top
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    positions.push({ x, y, angle });
  }

  return positions;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a472a", // Dark green poker table
  },
  gameInfoContainer: {
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    margin: 10,
    borderRadius: 8,
  },
  gameInfoText: {
    color: "white",
    fontSize: 16,
    marginBottom: 5,
  },
  yourTurnText: {
    color: "#ffd700",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  communityCardsContainer: {
    alignItems: "center",
    marginVertical: 20,
  },
  communityCardsLabel: {
    color: "white",
    fontSize: 18,
    marginBottom: 10,
  },
  communityCards: {
    flexDirection: "row",
    gap: 5,
  },
  communityCard: {
    width: 60,
    height: 80,
  },
  communityCardsPlaceholder: {
    width: 300,
    height: 80,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 16,
  },
  actionButtonsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    padding: 20,
    gap: 10,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  foldButton: {
    backgroundColor: "#dc3545",
  },
  callButton: {
    backgroundColor: "#28a745",
  },
  raiseButton: {
    backgroundColor: "#ffc107",
  },
  allInButton: {
    backgroundColor: "#dc3545",
  },
  actionButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  connectionStatus: {
    position: "absolute",
    top: 50,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 8,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#dc3545",
    marginRight: 5,
  },
  connected: {
    backgroundColor: "#28a745",
  },
  statusText: {
    color: "white",
    fontSize: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a472a",
  },
  errorText: {
    color: "white",
    fontSize: 18,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: "#007bff",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "white",
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a472a",
  },
  loadingText: {
    color: "white",
    fontSize: 18,
  },
});
```

### 3. Player Position Component

```javascript
// components/PlayerPosition.js
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Card } from "./Card";

export const PlayerPosition = ({
  player,
  position,
  isCurrentTurn,
  isCurrentPlayer,
  showCards,
}) => {
  const renderCards = () => {
    if (!player.hand || player.hand.length === 0) {
      return (
        <View style={styles.cardsPlaceholder}>
          <Text style={styles.placeholderText}>No cards</Text>
        </View>
      );
    }

    return (
      <View style={styles.cards}>
        {player.hand.map((card, index) => (
          <Card
            key={index}
            card={card}
            faceUp={showCards}
            style={styles.card}
          />
        ))}
      </View>
    );
  };

  const getStatusText = () => {
    if (player.folded) return "FOLDED";
    if (player.allIn) return "ALL-IN";
    if (isCurrentTurn) return "TURN";
    return "";
  };

  return (
    <View
      style={[
        styles.container,
        {
          left: position.x - 50,
          top: position.y - 60,
        },
      ]}
    >
      {/* Player Info */}
      <View
        style={[
          styles.playerInfo,
          isCurrentTurn && styles.currentTurn,
          isCurrentPlayer && styles.currentPlayer,
        ]}
      >
        <Text style={styles.username}>{player.username}</Text>
        <Text style={styles.chips}>${player.chips}</Text>
        {player.bet > 0 && <Text style={styles.bet}>Bet: ${player.bet}</Text>}
        {getStatusText() && (
          <Text
            style={[
              styles.status,
              player.folded && styles.foldedStatus,
              player.allIn && styles.allInStatus,
              isCurrentTurn && styles.turnStatus,
            ]}
          >
            {getStatusText()}
          </Text>
        )}
      </View>

      {/* Player Cards */}
      {renderCards()}

      {/* Blind Indicators */}
      {player.isSmallBlind && (
        <View style={styles.blindIndicator}>
          <Text style={styles.blindText}>SB</Text>
        </View>
      )}
      {player.isBigBlind && (
        <View style={styles.blindIndicator}>
          <Text style={styles.blindText}>BB</Text>
        </View>
      )}
      {player.isDealer && (
        <View style={styles.dealerIndicator}>
          <Text style={styles.dealerText}>D</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    width: 100,
    alignItems: "center",
  },
  playerInfo: {
    backgroundColor: "rgba(0,0,0,0.8)",
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 5,
  },
  currentTurn: {
    borderColor: "#ffd700",
    borderWidth: 2,
  },
  currentPlayer: {
    borderColor: "#007bff",
    borderWidth: 2,
  },
  username: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  chips: {
    color: "#ffd700",
    fontSize: 10,
  },
  bet: {
    color: "#28a745",
    fontSize: 10,
  },
  status: {
    fontSize: 8,
    fontWeight: "bold",
    marginTop: 2,
  },
  foldedStatus: {
    color: "#dc3545",
  },
  allInStatus: {
    color: "#ffc107",
  },
  turnStatus: {
    color: "#ffd700",
  },
  cards: {
    flexDirection: "row",
    gap: 2,
  },
  card: {
    width: 30,
    height: 40,
  },
  cardsPlaceholder: {
    width: 64,
    height: 40,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 8,
  },
  blindIndicator: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: "#ffc107",
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  blindText: {
    color: "black",
    fontSize: 10,
    fontWeight: "bold",
  },
  dealerIndicator: {
    position: "absolute",
    top: -5,
    left: -5,
    backgroundColor: "#007bff",
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  dealerText: {
    color: "white",
    fontSize: 10,
    fontWeight: "bold",
  },
});
```

### 4. Card Component

```javascript
// components/Card.js
import React from "react";
import { View, Text, StyleSheet } from "react-native";

export const Card = ({ card, faceUp = true, style }) => {
  if (!faceUp) {
    return (
      <View style={[styles.card, styles.cardBack, style]}>
        <View style={styles.cardBackPattern} />
      </View>
    );
  }

  const getSuitSymbol = (suit) => {
    switch (suit) {
      case "hearts":
        return "♥";
      case "diamonds":
        return "♦";
      case "clubs":
        return "♣";
      case "spades":
        return "♠";
      default:
        return "";
    }
  };

  const getSuitColor = (suit) => {
    return suit === "hearts" || suit === "diamonds" ? "#dc3545" : "#000";
  };

  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardContent}>
        <Text style={[styles.rank, { color: getSuitColor(card.suit) }]}>
          {card.rank}
        </Text>
        <Text style={[styles.suit, { color: getSuitColor(card.suit) }]}>
          {getSuitSymbol(card.suit)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: 50,
    height: 70,
    backgroundColor: "white",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cardBack: {
    backgroundColor: "#2c3e50",
  },
  cardBackPattern: {
    width: 40,
    height: 60,
    backgroundColor: "#34495e",
    borderRadius: 4,
  },
  cardContent: {
    alignItems: "center",
  },
  rank: {
    fontSize: 16,
    fontWeight: "bold",
  },
  suit: {
    fontSize: 20,
  },
});
```

## Usage Example

```javascript
// screens/PokerGameScreen.js
import React from "react";
import { View, StyleSheet } from "react-native";
import { PokerGame } from "../components/PokerGame";

export const PokerGameScreen = ({ route }) => {
  const { roomId, playerId, username } = route.params;

  return (
    <View style={styles.container}>
      <PokerGame roomId={roomId} playerId={playerId} username={username} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
```

## Key Features of This Integration

### ✅ **Consistent State Updates**

- Every WebSocket message includes the complete updated room state
- No more stale or partial data issues
- Frontend always has the latest game state

### ✅ **Proper Turn Management**

- Clear indication of whose turn it is
- Action buttons only enabled for current player
- Visual feedback for turn status

### ✅ **Accurate Betting Logic**

- Dynamic action buttons based on current game state
- Proper validation of available actions
- Real-time pot and bet amount updates

### ✅ **Community Card Display**

- Cards appear as they're dealt
- Proper handling of all-in scenarios
- Visual feedback for each phase

### ✅ **Player Position Management**

- Players positioned around the table
- Visual indicators for blinds, dealer, current turn
- Proper card visibility (face-up for current player, face-down for others)

### ✅ **Error Handling & Reconnection**

- Automatic WebSocket reconnection
- Clear error messages
- Graceful handling of connection issues

### ✅ **Responsive Design**

- Adapts to different screen sizes
- Proper positioning of UI elements
- Touch-friendly action buttons

## Testing the Integration

1. **Start the backend server** with the fixed poker service
2. **Create a room** using the API
3. **Join the room** with multiple players
4. **Start the game** and verify:
   - Blinds are assigned correctly
   - Cards are dealt properly
   - Turn progression works
   - Betting actions update the pot
   - Phase transitions work smoothly
   - Showdown resolves correctly

The fixed backend now provides consistent, reliable game state updates, and this frontend integration will handle all the WebSocket messages properly, giving you a fully functional Texas Hold'em poker game!
