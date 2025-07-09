import PokerRoomManager from "./PokerRoomManager.js";
import { logger } from "../utils/logger.js";

/**
 * Handles WebSocket connections and messages for poker rooms
 */
class PokerWebSocketHandler {
  constructor() {
    this.roomManager = new PokerRoomManager();
    this.playerConnections = new Map(); // playerId -> { ws, roomId, lastPing }
    this.roomSubscriptions = new Map(); // roomId -> Set of playerIds

    // Setup ping/pong for connection health
    this.setupHeartbeat();
  }

  handleConnection(ws, playerId) {
    logger.info(`Player ${playerId} connected via WebSocket`);

    // Store connection
    this.playerConnections.set(playerId, {
      ws,
      roomId: null,
      lastPing: Date.now(),
    });

    // Setup message handlers
    ws.on("message", (data) => {
      this.handleMessage(ws, playerId, data);
    });

    ws.on("close", () => {
      this.handleDisconnection(playerId);
    });

    ws.on("error", (error) => {
      logger.error(`WebSocket error for player ${playerId}:`, error);
    });

    ws.on("pong", () => {
      const connection = this.playerConnections.get(playerId);
      if (connection) {
        connection.lastPing = Date.now();
      }
    });

    // Send connection confirmation
    this.sendToPlayer(playerId, {
      type: "connected",
      playerId: playerId,
      timestamp: Date.now(),
    });
  }

  async handleMessage(ws, playerId, data) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe":
          await this.handleSubscribe(playerId, message.roomId);
          break;

        case "unsubscribe":
          await this.handleUnsubscribe(playerId, message.roomId);
          break;

        case "ping":
          this.handlePing(playerId);
          break;

        case "get_room_state":
          await this.handleGetRoomState(playerId, message.roomId);
          break;

        default:
          logger.warn(
            `Unknown message type: ${message.type} from player ${playerId}`
          );
      }
    } catch (error) {
      logger.error(`Error handling message from player ${playerId}:`, error);
      this.sendToPlayer(playerId, {
        type: "error",
        message: "Invalid message format",
      });
    }
  }

  async handleSubscribe(playerId, roomId) {
    try {
      // Update player connection
      const connection = this.playerConnections.get(playerId);
      if (connection) {
        // Unsubscribe from previous room if any
        if (connection.roomId) {
          await this.handleUnsubscribe(playerId, connection.roomId);
        }

        connection.roomId = roomId;
      }

      // Add to room subscriptions
      if (!this.roomSubscriptions.has(roomId)) {
        this.roomSubscriptions.set(roomId, new Set());
      }
      this.roomSubscriptions.get(roomId).add(playerId);

      // Send current room state
      await this.handleGetRoomState(playerId, roomId);

      // Confirm subscription
      this.sendToPlayer(playerId, {
        type: "subscribed",
        roomId: roomId,
        timestamp: Date.now(),
      });

      logger.info(`Player ${playerId} subscribed to room ${roomId}`);
    } catch (error) {
      logger.error(
        `Error subscribing player ${playerId} to room ${roomId}:`,
        error
      );
      this.sendToPlayer(playerId, {
        type: "error",
        message: "Failed to subscribe to room",
      });
    }
  }

  async handleUnsubscribe(playerId, roomId) {
    try {
      // Remove from room subscriptions
      if (this.roomSubscriptions.has(roomId)) {
        this.roomSubscriptions.get(roomId).delete(playerId);

        // Clean up empty room subscriptions
        if (this.roomSubscriptions.get(roomId).size === 0) {
          this.roomSubscriptions.delete(roomId);
        }
      }

      // Update player connection
      const connection = this.playerConnections.get(playerId);
      if (connection && connection.roomId === roomId) {
        connection.roomId = null;
      }

      this.sendToPlayer(playerId, {
        type: "unsubscribed",
        roomId: roomId,
        timestamp: Date.now(),
      });

      logger.info(`Player ${playerId} unsubscribed from room ${roomId}`);
    } catch (error) {
      logger.error(
        `Error unsubscribing player ${playerId} from room ${roomId}:`,
        error
      );
    }
  }

  async handleGetRoomState(playerId, roomId) {
    try {
      const room = await this.roomManager.getRoom(roomId);

      // Create player-specific room view
      const playerRoom = this.createPlayerSpecificRoomView(room, playerId);

      this.sendToPlayer(playerId, {
        type: "room_state",
        room: playerRoom,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error(`Error getting room state for player ${playerId}:`, error);
      this.sendToPlayer(playerId, {
        type: "error",
        message: "Room not found",
      });
    }
  }

  handlePing(playerId) {
    const connection = this.playerConnections.get(playerId);
    if (connection) {
      connection.lastPing = Date.now();
    }

    this.sendToPlayer(playerId, {
      type: "pong",
      timestamp: Date.now(),
    });
  }

  handleDisconnection(playerId) {
    logger.info(`Player ${playerId} disconnected`);

    const connection = this.playerConnections.get(playerId);
    if (connection && connection.roomId) {
      // Handle room disconnection
      this.roomManager
        .leaveRoom(connection.roomId, playerId)
        .catch((error) =>
          logger.error(
            `Error handling disconnection for player ${playerId}:`,
            error
          )
        );

      // Unsubscribe from room
      this.handleUnsubscribe(playerId, connection.roomId).catch((error) =>
        logger.error(
          `Error unsubscribing disconnected player ${playerId}:`,
          error
        )
      );
    }

    // Remove connection
    this.playerConnections.delete(playerId);
  }

  // Broadcasting methods
  broadcastToRoom(roomId, message) {
    const subscribers = this.roomSubscriptions.get(roomId);
    if (!subscribers) return;

    const messageWithTimestamp = {
      ...message,
      timestamp: Date.now(),
    };

    subscribers.forEach((playerId) => {
      this.sendToPlayer(playerId, messageWithTimestamp);
    });
  }

  sendToPlayer(playerId, message) {
    const connection = this.playerConnections.get(playerId);
    if (connection && connection.ws.readyState === 1) {
      // WebSocket.OPEN
      try {
        connection.ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error(`Error sending message to player ${playerId}:`, error);
      }
    }
  }

  // Utility methods
  createPlayerSpecificRoomView(room, playerId) {
    const playerRoom = { ...room };

    // Show hole cards only to the player who owns them (unless showdown)
    if (room.phase !== "showdown") {
      playerRoom.players = room.players.map((player) => {
        if (player.id === playerId) {
          // Show own cards
          return player;
        } else {
          // Hide other players' cards
          return {
            ...player,
            hand: player.hand ? player.hand.map(() => ({ hidden: true })) : [],
          };
        }
      });
    }

    return playerRoom;
  }

  setupHeartbeat() {
    setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds

      this.playerConnections.forEach((connection, playerId) => {
        if (now - connection.lastPing > timeout) {
          logger.warn(`Player ${playerId} connection timed out`);
          connection.ws.terminate();
          this.handleDisconnection(playerId);
        } else {
          // Send ping
          if (connection.ws.readyState === 1) {
            connection.ws.ping();
          }
        }
      });
    }, 30000); // Check every 30 seconds
  }

  // Get connection stats
  getConnectionStats() {
    return {
      totalConnections: this.playerConnections.size,
      totalRooms: this.roomSubscriptions.size,
      roomSubscriptions: Array.from(this.roomSubscriptions.entries()).map(
        ([roomId, players]) => ({
          roomId,
          playerCount: players.size,
        })
      ),
    };
  }
}

export default PokerWebSocketHandler;
