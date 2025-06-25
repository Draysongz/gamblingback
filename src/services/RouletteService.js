// rouletteService.mjs
import { supabase } from "../db/supabase.js";
import { v4 as uuidv4 } from "uuid";
import RedisService from "./RedisService.js"; // adjust the path if needed

/**
 * Get available roulette room (check Redis cache first)
 */
export async function findAvailableRoom() {
  const roomIds = await RedisService.client.smembers("rooms:roulette");

  for (const roomId of roomIds) {
    const room = await RedisService.getGameRoom(roomId);
    if (room && room.status === "waiting" && Number(room.current_players) < 7) {
      return room;
    }
  }

  // Fallback to Supabase if nothing found
  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("game_type", "roulette")
    .eq("status", "waiting")
    .lt("current_players", 7);

  if (error) throw error;
  const fallbackRoom = rooms?.[0] || null;

  if (fallbackRoom) {
    await RedisService.setGameRoom(fallbackRoom.id, fallbackRoom); // cache it
  }

  return fallbackRoom;
}

/**
 * Join a room and auto-create a game if ready
 */
export async function joinRoom(userId, betAmount) {
  const room = await findAvailableRoom();
  if (!room) throw new Error("No available rooms");

  const updatedPlayers = Number(room.current_players) + 1;

  // Update in Supabase
  const { error: updateError } = await supabase
    .from("rooms")
    .update({ current_players: updatedPlayers })
    .eq("id", room.id);

  if (updateError) throw updateError;

  // Update in Redis
  room.current_players = updatedPlayers;
  await RedisService.setGameRoom(room.id, room);

  // Start the game if conditions met
  if (updatedPlayers >= 1 && updatedPlayers <= 7) {
    return await createGame(room, userId, betAmount);
  }

  return { message: "Waiting for more players", roomId: room.id };
}

/**
 * Create roulette game in a room
 */
export async function createGame(room, creatorId, betAmount) {
  const gameId = uuidv4();

  const { error: gameError } = await supabase.from("games").insert([
    {
      id: gameId,
      creator_id: creatorId,
      user_id: creatorId,
      type: "roulette",
      mode: "room",
      status: "active",
      current_players: room.current_players,
      max_players: room.max_players,
      bet_amount: betAmount,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  const { error: roomError } = await supabase
    .from("rooms")
    .update({
      status: "active",
      current_game_id: gameId,
    })
    .eq("id", room.id);

  if (gameError) throw gameError;
  if (roomError) throw roomError;

  // Update Redis too
  room.status = "active";
  room.current_game_id = gameId;
  await RedisService.setGameRoom(room.id, room);

  return { message: "Game started", gameId };
}

/**
 * End game and reset room
 */
export async function endGame(gameId, resultData) {
  const { data: game, error: fetchError } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();

  if (fetchError) throw fetchError;

  const { error: updateGameError } = await supabase
    .from("games")
    .update({
      status: "completed",
      result: resultData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);

  const { error: resetRoomError } = await supabase
    .from("rooms")
    .update({
      status: "waiting",
      current_players: 0,
      current_game_id: null,
    })
    .eq("id", game.creator_id);

  if (updateGameError) throw updateGameError;
  if (resetRoomError) throw resetRoomError;

  // Reset Redis state
  const room = await RedisService.getGameRoom(game.creator_id);
  if (room) {
    room.status = "waiting";
    room.current_players = 0;
    room.current_game_id = null;
    await RedisService.setGameRoom(game.creator_id, room);
  }

  return { message: "Game ended and room reset" };
}
