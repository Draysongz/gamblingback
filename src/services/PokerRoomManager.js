import RedisService from "./RedisService.js"
import PokerGameEngine from "./PokerGameEngine.js"
import WebSocketService from "./WebSocketService.js"
import { logger } from "../utils/logger.js"

/**
 * Manages poker rooms and coordinates between game engine and external services
 */
class PokerRoomManager {
  constructor() {
    this.redis = RedisService
    this.ws = WebSocketService
    this.gameEngine = new PokerGameEngine()
    this.playerTimeouts = new Map()
    this.reconnectionTimeouts = new Map()
  }

  // Room Management
  async createRoom(options) {
    try {
      const room = this.gameEngine.createInitialGameState(options)

      // Store in Redis
      await this.redis.client.set(`poker:room:${room.id}`, JSON.stringify(room))
      await this.redis.client.sadd("poker:rooms", room.id)

      logger.info(`Poker room created: ${room.id} by user ${options.creatorId}`)
      return room
    } catch (error) {
      logger.error("Error creating room:", error)
      throw error
    }
  }

  async getRoom(roomId) {
    try {
      const roomData = await this.redis.client.get(`poker:room:${roomId}`)
      if (!roomData) {
        throw new Error("Room not found")
      }
      return JSON.parse(roomData)
    } catch (error) {
      logger.error(`Error getting room ${roomId}:`, error)
      throw error
    }
  }

  async updateRoom(room) {
    try {
      await this.redis.client.set(`poker:room:${room.id}`, JSON.stringify(room))
      return room
    } catch (error) {
      logger.error(`Error updating room ${room.id}:`, error)
      throw error
    }
  }

  async joinRoom(roomId, playerData) {
    try {
      const room = await this.getRoom(roomId)

      if (room.status !== "waiting") {
        throw new Error("Room is not accepting players")
      }

      // Check if player is already in room (reconnection)
      const existingPlayer = room.players.find((p) => p.id === playerData.id)
      if (existingPlayer) {
        existingPlayer.connected = true
        existingPlayer.lastSeen = Date.now()
        await this.updateRoom(room)

        // Clear any reconnection timeout
        this.clearReconnectionTimeout(roomId, playerData.id)

        // Notify reconnection
        this.ws.broadcastToRoom(roomId, {
          type: "player_reconnected",
          playerId: playerData.id,
          room: this.sanitizeRoomForBroadcast(room),
        })

        return room
      }

      // Add new player
      this.gameEngine.addPlayerToRoom(room, playerData)
      await this.updateRoom(room)

      // Notify other players
      this.ws.broadcastToRoom(roomId, {
        type: "player_joined",
        player: room.players.find((p) => p.id === playerData.id),
        room: this.sanitizeRoomForBroadcast(room),
      })

      return room
    } catch (error) {
      logger.error(`Error joining room ${roomId}:`, error)
      throw error
    }
  }

  async leaveRoom(roomId, playerId) {
    try {
      const room = await this.getRoom(roomId)

      // Mark player as disconnected instead of removing immediately
      const player = room.players.find((p) => p.id === playerId)
      if (player) {
        player.connected = false
        player.lastSeen = Date.now()

        // Set reconnection timeout
        this.setReconnectionTimeout(roomId, playerId)

        await this.updateRoom(room)

        // Notify other players
        this.ws.broadcastToRoom(roomId, {
          type: "player_disconnected",
          playerId: playerId,
          room: this.sanitizeRoomForBroadcast(room),
        })
      }

      // Clear player timeout
      this.clearPlayerTimeout(roomId, playerId)
    } catch (error) {
      logger.error(`Error leaving room ${roomId}:`, error)
      throw error
    }
  }

  // Game Flow Management
  async startGame(roomId, playerId) {
    try {
      const room = await this.getRoom(roomId)

      if (room.creator.id !== playerId) {
        throw new Error("Only room creator can start the game")
      }

      const connectedPlayers = room.players.filter((p) => p.connected)
      if (connectedPlayers.length < 2) {
        throw new Error("Need at least 2 connected players to start")
      }

      // Start new hand
      this.gameEngine.startNewHand(room)
      await this.updateRoom(room)

      // Set timeout for first player
      if (room.currentTurn) {
        this.setPlayerTimeout(roomId, room.currentTurn)
      }

      // Notify all players
      this.ws.broadcastToRoom(roomId, {
        type: "game_started",
        room: this.sanitizeRoomForBroadcast(room),
      })

      return room
    } catch (error) {
      logger.error(`Error starting game in room ${roomId}:`, error)
      throw error
    }
  }

  async processPlayerAction(roomId, playerId, action, amount = 0) {
    try {
      const room = await this.getRoom(roomId)

      // Clear player timeout
      this.clearPlayerTimeout(roomId, playerId)

      // Process action through game engine
      this.gameEngine.processPlayerAction(room, playerId, action, amount)

      // Check game state after action
      const gameResult = this.checkGameState(room)

      if (gameResult.gameEnded) {
        await this.handleGameEnd(room, gameResult)
      } else if (gameResult.roundComplete) {
        await this.handleRoundComplete(room)
      } else {
        // Move to next player
        this.moveToNextPlayer(room)
        if (room.currentTurn) {
          this.setPlayerTimeout(roomId, room.currentTurn)
        }
      }

      await this.updateRoom(room)

      // Notify all players
      this.ws.broadcastToRoom(roomId, {
        type: "player_action",
        playerId: playerId,
        action: action,
        amount: amount,
        room: this.sanitizeRoomForBroadcast(room),
      })

      return room
    } catch (error) {
      logger.error(`Error processing action in room ${roomId}:`, error)
      throw error
    }
  }

  // Game State Checking
  checkGameState(room) {
    const activePlayers = room.players.filter((p) => !p.folded && p.connected)

    // Game ends if only one player remains
    if (activePlayers.length <= 1) {
      return { gameEnded: true, reason: "single_player" }
    }

    // Check if all players are all-in
    const playingPlayers = activePlayers.filter((p) => !p.allIn)
    if (playingPlayers.length <= 1 && activePlayers.length > 1) {
      return { gameEnded: true, reason: "all_in" }
    }

    // Check if round is complete
    if (this.gameEngine.isRoundComplete(room)) {
      return { roundComplete: true }
    }

    return { gameEnded: false, roundComplete: false }
  }

  async handleRoundComplete(room) {
    try {
      const result = this.gameEngine.moveToNextPhase(room)

      if (room.phase === "showdown") {
        await this.handleShowdown(room, result)
      } else {
        // New betting round
        if (room.currentTurn) {
          this.setPlayerTimeout(room.id, room.currentTurn)
        }

        // Notify phase change
        this.ws.broadcastToRoom(room.id, {
          type: "phase_change",
          phase: room.phase,
          communityCards: room.communityCards,
          room: this.sanitizeRoomForBroadcast(room),
        })
      }
    } catch (error) {
      logger.error(`Error handling round complete in room ${room.id}:`, error)
      throw error
    }
  }

  async handleShowdown(room, showdownResult) {
    try {
      // Notify showdown
      this.ws.broadcastToRoom(room.id, {
        type: "showdown",
        results: showdownResult.results,
        winners: showdownResult.winners,
        room: this.sanitizeRoomForBroadcast(room),
      })

      // Schedule next hand or end game
      await this.scheduleNextHand(room)
    } catch (error) {
      logger.error(`Error handling showdown in room ${room.id}:`, error)
      throw error
    }
  }

  async scheduleNextHand(room) {
    const playersWithChips = room.players.filter((p) => p.chips > 0 && p.connected)

    if (playersWithChips.length >= 2) {
      // Schedule next hand
      const countdownSeconds = 10
      this.ws.broadcastToRoom(room.id, {
        type: "new_game_countdown",
        seconds: countdownSeconds,
        room: this.sanitizeRoomForBroadcast(room),
      })

      setTimeout(async () => {
        try {
          const latestRoom = await this.getRoom(room.id)
          const stillEnoughPlayers = latestRoom.players.filter((p) => p.chips > 0 && p.connected).length >= 2

          if (stillEnoughPlayers) {
            this.gameEngine.startNewHand(latestRoom)
            await this.updateRoom(latestRoom)

            if (latestRoom.currentTurn) {
              this.setPlayerTimeout(room.id, latestRoom.currentTurn)
            }

            this.ws.broadcastToRoom(room.id, {
              type: "game_started",
              room: this.sanitizeRoomForBroadcast(latestRoom),
            })
          } else {
            await this.handleWaitingForPlayers(latestRoom)
          }
        } catch (error) {
          logger.error("Auto-restart failed:", error)
        }
      }, countdownSeconds * 1000)
    } else {
      await this.handleWaitingForPlayers(room)
    }
  }

  async handleWaitingForPlayers(room) {
    room.status = "waiting"
    room.phase = "waiting"
    await this.updateRoom(room)

    this.ws.broadcastToRoom(room.id, {
      type: "waiting_for_players",
      room: this.sanitizeRoomForBroadcast(room),
    })
  }

  // Player Management
  moveToNextPlayer(room) {
    const activePlayers = room.players.filter((p) => !p.folded && !p.allIn && p.connected)

    if (activePlayers.length <= 1) {
      room.currentTurn = activePlayers.length === 1 ? activePlayers[0].id : null
      return
    }

    const currentIndex = activePlayers.findIndex((p) => p.id === room.currentTurn)
    if (currentIndex === -1) {
      room.currentTurn = activePlayers[0].id
      return
    }

    const nextIndex = (currentIndex + 1) % activePlayers.length
    room.currentTurn = activePlayers[nextIndex].id
  }

  // Timeout Management
  setPlayerTimeout(roomId, playerId, duration = 30000) {
    if (!this.playerTimeouts.has(roomId)) {
      this.playerTimeouts.set(roomId, {})
    }

    const timeouts = this.playerTimeouts.get(roomId)
    if (timeouts[playerId]) {
      clearTimeout(timeouts[playerId])
    }

    timeouts[playerId] = setTimeout(async () => {
      try {
        logger.info(`Player ${playerId} timed out in room ${roomId}, auto-folding`)
        await this.processPlayerAction(roomId, playerId, "fold")
      } catch (error) {
        logger.error("Error auto-folding player:", error)
      }
    }, duration)
  }

  clearPlayerTimeout(roomId, playerId) {
    if (!this.playerTimeouts.has(roomId)) return

    const timeouts = this.playerTimeouts.get(roomId)
    if (timeouts[playerId]) {
      clearTimeout(timeouts[playerId])
      delete timeouts[playerId]
    }
  }

  setReconnectionTimeout(roomId, playerId, duration = 60000) {
    if (!this.reconnectionTimeouts.has(roomId)) {
      this.reconnectionTimeouts.set(roomId, {})
    }

    const timeouts = this.reconnectionTimeouts.get(roomId)
    if (timeouts[playerId]) {
      clearTimeout(timeouts[playerId])
    }

    timeouts[playerId] = setTimeout(async () => {
      try {
        logger.info(`Player ${playerId} reconnection timeout in room ${roomId}, removing from room`)
        const room = await this.getRoom(roomId)
        this.gameEngine.removePlayerFromRoom(room, playerId)
        await this.updateRoom(room)

        this.ws.broadcastToRoom(roomId, {
          type: "player_left",
          playerId: playerId,
          room: this.sanitizeRoomForBroadcast(room),
        })
      } catch (error) {
        logger.error("Error removing disconnected player:", error)
      }
    }, duration)
  }

  clearReconnectionTimeout(roomId, playerId) {
    if (!this.reconnectionTimeouts.has(roomId)) return

    const timeouts = this.reconnectionTimeouts.get(roomId)
    if (timeouts[playerId]) {
      clearTimeout(timeouts[playerId])
      delete timeouts[playerId]
    }
  }

  // Utility Methods
  sanitizeRoomForBroadcast(room) {
    // Remove sensitive information and create player-specific views
    const sanitized = { ...room }

    // Hide other players' hole cards unless in showdown
    if (room.phase !== "showdown") {
      sanitized.players = room.players.map((player) => ({
        ...player,
        hand: player.hand ? player.hand.map(() => ({ hidden: true })) : [],
      }))
    }

    return sanitized
  }

  async getAvailableRooms() {
    try {
      const roomIds = await this.redis.client.smembers("poker:rooms")
      const rooms = []

      for (const roomId of roomIds) {
        try {
          const room = await this.getRoom(roomId)
          if (room.status === "waiting" && room.players.length < room.maxPlayers) {
            rooms.push({
              id: room.id,
              name: room.name,
              creator: room.creator,
              players: room.players.filter((p) => p.connected),
              maxPlayers: room.maxPlayers,
              minBet: room.minBet,
              maxBet: room.maxBet,
              status: room.status,
              createdAt: room.createdAt,
              currentPlayers: room.players.filter((p) => p.connected).length,
            })
          }
        } catch (error) {
          logger.error(`Error getting room ${roomId}:`, error)
        }
      }

      return rooms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } catch (error) {
      logger.error("Error getting available rooms:", error)
      throw error
    }
  }
}

export default PokerRoomManager
