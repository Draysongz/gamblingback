import { WebSocketServer } from "ws";
import { logger } from "../utils/logger.js";
import redisService from "./RedisService.js";

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map of client connections
    this.roomSubscriptions = new Map(); // Map of room subscriptions
    this.playerPresence = new Map(); // Map of player presence status
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws, req) => {
      const clientId = req.headers["sec-websocket-key"];
      this.clients.set(clientId, ws);

      console.log(`Client connected: ${clientId}`);

      // Send initial connection success with server time
      this.sendToClient(ws, {
        type: "connection_established",
        clientId,
        serverTime: Date.now(),
      });

      ws.on("message", async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(clientId, data);
        } catch (error) {
          logger.error("Error handling WebSocket message:", error);
          this.sendError(ws, "Invalid message format");
        }
      });

      ws.on("close", () => {
        this.handleDisconnect(ws);
      });

      ws.on("error", (error) => {
        logger.error(`WebSocket error for client ${clientId}:`, error);
        this.handleDisconnect(ws);
      });

      // Start presence heartbeat
      this.startPresenceHeartbeat(clientId);
    });

    // Subscribe to Redis channels for game updates
    this.subscribeToGameUpdates();
  }

  async handleMessage(clientId, data) {
    const ws = this.clients.get(clientId);
    if (!ws) return;

    try {
      switch (data.type) {
        case "subscribe":
          await this.handleSubscribe(clientId, data.roomId);
          break;
        case "unsubscribe":
          await this.handleUnsubscribe(clientId, data.roomId);
          break;
        case "game_action":
          await this.handleGameAction(clientId, data);
          break;
        case "chat_message":
          await this.handleChatMessage(clientId, data);
          break;
        case "player_presence":
          await this.handlePlayerPresence(clientId, data);
          break;
        case "game_invite":
          await this.handleGameInvite(clientId, data);
          break;
        case "game_ready":
          await this.handleGameReady(clientId, data);
          break;
        default:
          this.sendError(ws, "Unknown message type");
      }
    } catch (error) {
      logger.error("Error handling message:", error);
      this.sendError(ws, "Internal server error");
    }
  }

  async handleSubscribe(clientId, roomId) {
    const ws = this.clients.get(clientId);
    if (!ws) return;

    try {
      // Check if this is a poker room
      const isPokerRoom = roomId.startsWith("poker_");
      const redisChannel = isPokerRoom
        ? `poker:room:${roomId}`
        : `room:${roomId}`;

      // Subscribe to Redis channel for this room
      const subscriber = await redisService.subscribe(
        redisChannel,
        (message) => {
          this.sendToClient(ws, {
            type: "room_update",
            roomId,
            data: message,
          });
        }
      );

      // Store subscription
      if (!this.roomSubscriptions.has(clientId)) {
        this.roomSubscriptions.set(clientId, new Map());
      }
      this.roomSubscriptions.get(clientId).set(roomId, subscriber);

      // Get room state and send to client
      let roomState;
      if (isPokerRoom) {
        roomState = await redisService.client.get(`poker:room:${roomId}`);
        if (roomState) {
          roomState = JSON.parse(roomState);
        }
      } else {
        roomState = await redisService.getGameRoom(roomId);
      }

      if (roomState) {
        this.sendToClient(ws, {
          type: "room_state",
          roomId,
          data: roomState,
        });
      }

      // Send confirmation
      this.sendToClient(ws, {
        type: "subscribed",
        roomId,
      });
    } catch (error) {
      logger.error("Error subscribing to room:", error);
      this.sendError(ws, "Failed to subscribe to room");
    }
  }

  async handleUnsubscribe(clientId, roomId) {
    const ws = this.clients.get(clientId);
    if (!ws) return;

    try {
      const subscriptions = this.roomSubscriptions.get(clientId);
      if (subscriptions && subscriptions.has(roomId)) {
        const subscriber = subscriptions.get(roomId);
        const isPokerRoom = roomId.startsWith("poker_");
        const redisChannel = isPokerRoom
          ? `poker:room:${roomId}`
          : `room:${roomId}`;
        await subscriber.unsubscribe(redisChannel);
        await subscriber.quit();
        subscriptions.delete(roomId);
      }

      this.sendToClient(ws, {
        type: "unsubscribed",
        roomId,
      });
    } catch (error) {
      logger.error("Error unsubscribing from room:", error);
      this.sendError(ws, "Failed to unsubscribe from room");
    }
  }

  async handleGameAction(clientId, data) {
    const ws = this.clients.get(clientId);
    if (!ws) return;

    try {
      // Validate game action
      if (!data.roomId || !data.action) {
        throw new Error("Invalid game action");
      }

      // Publish game action to Redis
      await redisService.publish(`room:${data.roomId}`, {
        type: "game_action",
        clientId,
        action: data.action,
        data: data.data,
      });
    } catch (error) {
      logger.error("Error handling game action:", error);
      this.sendError(ws, "Failed to process game action");
    }
  }

  async handleChatMessage(clientId, data) {
    try {
      const { roomId, message, playerId, playerName } = data;

      // Validate message
      if (!roomId || !message || !playerId) {
        throw new Error("Invalid chat message");
      }

      // Store chat message in Redis
      await redisService.setCache(
        `chat:${roomId}:${Date.now()}`,
        {
          playerId,
          playerName,
          message,
          timestamp: Date.now(),
        },
        86400 // 24 hours expiry
      );

      // Broadcast to room
      this.broadcastToRoom(roomId, {
        type: "chat_message",
        data: {
          playerId,
          playerName,
          message,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      logger.error("Error handling chat message:", error);
      this.sendError(this.clients.get(clientId), "Failed to send chat message");
    }
  }

  async handlePlayerPresence(clientId, data) {
    try {
      const { playerId, status, roomId } = data;

      // Update presence in Redis
      await redisService.setPlayerSession(playerId, {
        status,
        lastActive: Date.now(),
        roomId,
      });

      // Broadcast to room if in a room
      if (roomId) {
        this.broadcastToRoom(roomId, {
          type: "player_presence",
          data: {
            playerId,
            status,
            timestamp: Date.now(),
          },
        });
      }
    } catch (error) {
      logger.error("Error handling player presence:", error);
    }
  }

  async handleGameInvite(clientId, data) {
    try {
      const { targetPlayerId, gameType, roomId } = data;

      // Store invite in Redis
      await redisService.setCache(
        `invite:${targetPlayerId}:${Date.now()}`,
        {
          fromPlayerId: clientId,
          gameType,
          roomId,
          timestamp: Date.now(),
        },
        300 // 5 minutes expiry
      );

      // Send invite to target player
      const targetWs = this.findPlayerConnection(targetPlayerId);
      if (targetWs) {
        this.sendToClient(targetWs, {
          type: "game_invite",
          data: {
            fromPlayerId: clientId,
            gameType,
            roomId,
            timestamp: Date.now(),
          },
        });
      }
    } catch (error) {
      logger.error("Error handling game invite:", error);
      this.sendError(this.clients.get(clientId), "Failed to send game invite");
    }
  }

  async handleGameReady(clientId, data) {
    try {
      const { roomId, playerId } = data;

      // Update player ready status in Redis
      await redisService.setCache(
        `ready:${roomId}:${playerId}`,
        {
          ready: true,
          timestamp: Date.now(),
        },
        300 // 5 minutes expiry
      );

      // Broadcast to room
      this.broadcastToRoom(roomId, {
        type: "player_ready",
        data: {
          playerId,
          timestamp: Date.now(),
        },
      });

      // Check if all players are ready
      const room = await redisService.getGameRoom(roomId);
      if (room) {
        const readyPlayers = await redisService.client.keys(
          `ready:${roomId}:*`
        );
        if (readyPlayers.length === room.current_players) {
          // All players ready, start game
          this.broadcastToRoom(roomId, {
            type: "game_start",
            data: {
              timestamp: Date.now(),
            },
          });
        }
      }
    } catch (error) {
      logger.error("Error handling game ready:", error);
      this.sendError(
        this.clients.get(clientId),
        "Failed to update ready status"
      );
    }
  }

  startPresenceHeartbeat(clientId) {
    const interval = setInterval(async () => {
      try {
        const ws = this.clients.get(clientId);
        if (!ws) {
          clearInterval(interval);
          return;
        }

        // Send heartbeat
        this.sendToClient(ws, {
          type: "heartbeat",
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error("Error in presence heartbeat:", error);
        clearInterval(interval);
      }
    }, 30000); // Every 30 seconds
  }

  findPlayerConnection(playerId) {
    for (const [clientId, ws] of this.clients.entries()) {
      if (clientId === playerId) {
        return ws;
      }
    }
    return null;
  }

  async handleDisconnect(ws, code, reason) {
    try {
      // Find the client ID for this WebSocket
      let clientId = null;
      for (const [id, clientWs] of this.clients.entries()) {
        if (clientWs === ws) {
          clientId = id;
          break;
        }
      }

      if (!clientId) {
        logger.warn("Client disconnected without ID");
        return;
      }

      console.log(`Client disconnected: ${clientId}`);

      // Clean up subscriptions
      const subscriptions = this.roomSubscriptions.get(clientId);
      if (subscriptions) {
        for (const [roomId, subscriber] of subscriptions.entries()) {
          try {
            const isPokerRoom = roomId.startsWith("poker_");
            const redisChannel = isPokerRoom
              ? `poker:room:${roomId}`
              : `room:${roomId}`;
            await subscriber.unsubscribe(redisChannel);
            await subscriber.quit();
          } catch (error) {
            logger.error(
              `Error cleaning up subscription for room ${roomId}:`,
              error
            );
          }
        }
        this.roomSubscriptions.delete(clientId);
      }

      // Clean up client data
      this.clients.delete(clientId);
      this.playerPresence.delete(clientId);

      // Notify other clients in the room (if we can determine the room)
      if (subscriptions && subscriptions.size > 0) {
        const roomId = Array.from(subscriptions.keys())[0];
        this.broadcastToRoom(roomId, {
          type: "player_left",
          data: { playerId: clientId },
        });
      }
    } catch (error) {
      // Log error but don't throw to prevent server crash
      logger.error("Error handling disconnect:", error);
    }
  }

  async subscribeToGameUpdates() {
    try {
      // Subscribe to global game updates
      await redisService.subscribe("game_updates", (message) => {
        this.broadcast({
          type: "game_update",
          data: message,
        });
      });
    } catch (error) {
      logger.error("Error subscribing to game updates:", error);
    }
  }

  sendToClient(ws, data) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  sendError(ws, message) {
    this.sendToClient(ws, {
      type: "error",
      message,
    });
  }

  broadcast(data) {
    for (const ws of this.clients.values()) {
      this.sendToClient(ws, data);
    }
  }

  broadcastToRoom(roomId, data) {
    const isPokerRoom = roomId.startsWith("poker_");
    const redisChannel = isPokerRoom
      ? `poker:room:${roomId}`
      : `room:${roomId}`;
    redisService.publish(redisChannel, data);
  }

  async cleanup() {
    try {
      // Clean up all subscriptions
      for (const [
        clientId,
        subscriptions,
      ] of this.roomSubscriptions.entries()) {
        for (const [roomId, subscriber] of subscriptions.entries()) {
          try {
            const isPokerRoom = roomId.startsWith("poker_");
            const redisChannel = isPokerRoom
              ? `poker:room:${roomId}`
              : `room:${roomId}`;
            await subscriber.unsubscribe(redisChannel);
            await subscriber.quit();
          } catch (error) {
            logger.error(
              `Error cleaning up subscription for room ${roomId}:`,
              error
            );
          }
        }
      }
      this.roomSubscriptions.clear();
      this.clients.clear();
      this.playerPresence.clear();
    } catch (error) {
      logger.error("Error cleaning up WebSocket service:", error);
    }
  }
}

export default new WebSocketService();
