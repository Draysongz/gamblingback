import { supabase } from "../db/supabase.js";
import { ROOM_STATUS } from "../utils/constants.js";

class Room {
  constructor(gameType, creatorId, maxPlayers) {
    this.gameType = gameType;
    this.creatorId = creatorId;
    this.maxPlayers = maxPlayers;
    this.players = [];
    this.status = ROOM_STATUS.WAITING;
  }

  static async createRoom(gameType, creatorId, maxPlayers) {
    const { data, error } = await supabase
      .from("rooms")
      .insert([
        {
          game_type: gameType,
          creator_id: creatorId,
          max_players: maxPlayers,
          status: ROOM_STATUS.WAITING,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (error) throw error;
    return data[0];
  }

  static async joinRoom(roomId, userId) {
    // Check if room exists and has space
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select(
        `
        *,
        room_players (
          user_id
        )
      `
      )
      .eq("id", roomId)
      .single();

    if (roomError) throw roomError;

    if (!room) {
      throw new Error("Room not found");
    }

    if (room.room_players.length >= room.max_players) {
      throw new Error("Room is full");
    }

    // Check if user is already in the room
    const isAlreadyInRoom = room.room_players.some(
      (player) => player.user_id === userId
    );
    if (isAlreadyInRoom) {
      throw new Error("User is already in this room");
    }

    // Add user to room
    const { data, error } = await supabase
      .from("room_players")
      .insert([
        {
          room_id: roomId,
          user_id: userId,
          joined_at: new Date().toISOString(),
        },
      ])
      .select();

    if (error) throw error;

    // Update room status if it's now full
    if (room.room_players.length + 1 >= room.max_players) {
      await Room.updateRoomStatus(roomId, ROOM_STATUS.FULL);
    }

    return data[0];
  }

  static async leaveRoom(roomId, userId) {
    const { data, error } = await supabase
      .from("room_players")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .select();

    if (error) throw error;

    // Update room status back to waiting if it was full
    const { data: room } = await supabase
      .from("rooms")
      .select(
        `
        *,
        room_players (
          user_id
        )
      `
      )
      .eq("id", roomId)
      .single();

    if (
      room &&
      room.status === ROOM_STATUS.FULL &&
      room.room_players.length < room.max_players
    ) {
      await Room.updateRoomStatus(roomId, ROOM_STATUS.WAITING);
    }

    return data[0];
  }

  static async getAvailableRooms(gameType) {
    const { data, error } = await supabase
      .from("rooms")
      .select(
        `
        *,
        room_players (
          user_id,
          users (
            username
          )
        )
      `
      )
      .eq("game_type", gameType)
      .in("status", [ROOM_STATUS.WAITING, ROOM_STATUS.FULL])
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Filter out full rooms and add player count
    return data.map((room) => ({
      ...room,
      current_players: room.room_players.length,
      available_spots: room.max_players - room.room_players.length,
      is_joinable:
        room.room_players.length < room.max_players &&
        room.status === ROOM_STATUS.WAITING,
    }));
  }

  static async updateRoomStatus(roomId, status) {
    const { data, error } = await supabase
      .from("rooms")
      .update({ status })
      .eq("id", roomId)
      .select();

    if (error) throw error;
    return data[0];
  }

  static async findMatch(gameType, userId) {
    // Find a room with available space
    const { data: rooms, error } = await supabase
      .from("rooms")
      .select(
        `
        *,
        room_players (
          user_id
        )
      `
      )
      .eq("game_type", gameType)
      .eq("status", ROOM_STATUS.WAITING)
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Find the first room with available space
    const availableRoom = rooms.find(
      (room) => room.room_players.length < room.max_players
    );

    if (availableRoom) {
      // ✅ Fixed: Use Room.joinRoom instead of this.joinRoom
      await Room.joinRoom(availableRoom.id, userId);
      return availableRoom;
    }

    // If no available room, create a new one
    // ✅ Fixed: Use Room.createRoom instead of this.createRoom
    const newRoom = await Room.createRoom(gameType, userId, 4); // Default to 4 players
    await Room.joinRoom(newRoom.id, userId);
    return newRoom;
  }

  static async getRoomPlayers(roomId) {
    const { data, error } = await supabase
      .from("room_players")
      .select(
        `
        *,
        users (
          id,
          username,
          chips_balance
        )
      `
      )
      .eq("room_id", roomId);

    if (error) throw error;
    return data;
  }
}

export default Room;
