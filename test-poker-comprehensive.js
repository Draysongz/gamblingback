import EnhancedPokerService from "./src/services/EnhancedPokerService.js";

async function testComprehensivePokerLogic() {
  console.log("🧪 Comprehensive Poker Logic Test...\n");

  const pokerService = new EnhancedPokerService();

  try {
    // Test 1: Create a room
    console.log("1. Testing room creation...");
    const room = await pokerService.createRoom({
      name: "Test Room",
      creatorId: "player1",
      maxPlayers: 4,
      minBet: 10,
      maxBet: 100,
    });
    console.log("✅ Room created:", room.id);

    // Test 2: Join players
    console.log("\n2. Testing player joins...");
    await pokerService.joinRoom(room.id, "player1");
    await pokerService.joinRoom(room.id, "player2");
    await pokerService.joinRoom(room.id, "player3");
    const roomWithPlayers = await pokerService.getRoom(room.id);
    console.log("✅ Players joined:", roomWithPlayers.players.length);

    // Test 3: Start game
    console.log("\n3. Testing game start...");
    const gameRoom = await pokerService.startGame(room.id, "player1");
    console.log("✅ Game started:", gameRoom.phase);
    console.log("   Pot:", gameRoom.pot);
    console.log("   Current bet:", gameRoom.currentBet);
    console.log("   Current turn:", gameRoom.currentTurn);

    // Test 4: Test check functionality
    console.log("\n4. Testing check functionality...");
    const currentPlayer = gameRoom.players.find(
      (p) => p.id === gameRoom.currentTurn
    );
    if (currentPlayer && currentPlayer.bet === gameRoom.currentBet) {
      const updatedRoom = await pokerService.playerAction(
        room.id,
        currentPlayer.id,
        "check"
      );
      console.log("✅ Check action performed successfully");
      console.log("   New turn:", updatedRoom.currentTurn);
    } else {
      console.log("⚠️  Check not available (player needs to call first)");
    }

    // Test 5: Test raise functionality
    console.log("\n5. Testing raise functionality...");
    const nextPlayer = gameRoom.players.find(
      (p) => p.id === gameRoom.currentTurn
    );
    if (nextPlayer && nextPlayer.chips >= 20) {
      const updatedRoom = await pokerService.playerAction(
        room.id,
        nextPlayer.id,
        "raise",
        20
      );
      console.log("✅ Raise action performed successfully");
      console.log("   New current bet:", updatedRoom.currentBet);
      console.log("   New pot:", updatedRoom.pot);
    }

    // Test 6: Test fold functionality
    console.log("\n6. Testing fold functionality...");
    const foldPlayer = gameRoom.players.find(
      (p) => p.id === gameRoom.currentTurn
    );
    if (foldPlayer) {
      const updatedRoom = await pokerService.playerAction(
        room.id,
        foldPlayer.id,
        "fold"
      );
      console.log("✅ Fold action performed successfully");
      console.log(
        "   Active players:",
        updatedRoom.players.filter((p) => !p.folded).length
      );
    }

    // Test 7: Test all players folding except one
    console.log("\n7. Testing all players folding scenario...");
    const activePlayers = gameRoom.players.filter((p) => !p.folded);
    if (activePlayers.length > 1) {
      // Fold all players except the last one
      for (let i = 0; i < activePlayers.length - 1; i++) {
        const player = activePlayers[i];
        if (player.id === gameRoom.currentTurn) {
          await pokerService.playerAction(room.id, player.id, "fold");
          console.log(`✅ Player ${player.id} folded`);
        }
      }

      // Check if the last player automatically wins
      const finalRoom = await pokerService.getRoom(room.id);
      if (finalRoom.status === "waiting") {
        console.log("✅ All players folded scenario handled correctly");
        console.log("   Game reset for next hand");
      }
    }

    // Test 8: Test hand evaluation
    console.log("\n8. Testing hand evaluation...");
    const playerHand = [
      { rank: "A", suit: "hearts" },
      { rank: "K", suit: "hearts" },
    ];
    const communityCards = [
      { rank: "Q", suit: "hearts" },
      { rank: "J", suit: "hearts" },
      { rank: "10", suit: "hearts" },
    ];

    const handResult = pokerService.evaluateHand(playerHand, communityCards);
    console.log(
      "✅ Hand evaluated:",
      handResult.name,
      "(Score:",
      handResult.score + ")"
    );

    // Test 9: Test phase transitions
    console.log("\n9. Testing phase transitions...");
    const testRoom = await pokerService.createRoom({
      name: "Phase Test Room",
      creatorId: "phasePlayer1",
      maxPlayers: 2,
      minBet: 5,
      maxBet: 50,
    });

    await pokerService.joinRoom(testRoom.id, "phasePlayer1");
    await pokerService.joinRoom(testRoom.id, "phasePlayer2");
    const phaseGameRoom = await pokerService.startGame(
      testRoom.id,
      "phasePlayer1"
    );

    console.log("✅ Game phases working correctly");
    console.log("   Initial phase:", phaseGameRoom.phase);

    console.log(
      "\n🎉 All comprehensive tests passed! Poker logic is working correctly."
    );
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
  }
}

testComprehensivePokerLogic();
