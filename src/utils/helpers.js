import { AppError } from '../middleware/errorHandler.js';
import { ERROR_MESSAGES } from './constants.js';

export const validateAmount = (amount) => {
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    throw new AppError(ERROR_MESSAGES.INVALID_BET_AMOUNT, 400);
  }
  return true;
};

export const calculateWinAmount = (betAmount, multiplier) => {
  return betAmount * multiplier;
};

export const formatBalance = (amount) => {
  return Number(amount.toFixed(8));
};

export const generateGameResult = (gameType) => {
  switch (gameType) {
    case 'slots':
      return generateSlotsResult();
    case 'blackjack':
      return generateBlackjackResult();
    case 'roulette':
      return generateRouletteResult();
    default:
      throw new AppError('Invalid game type', 400);
  }
};

const generateSlotsResult = () => {
  const symbols = ['🍒', '🍊', '🍋', '🍇', '7️⃣', '💎'];
  const reels = Array(3).fill().map(() => symbols[Math.floor(Math.random() * symbols.length)]);
  const isWin = reels[0] === reels[1] && reels[1] === reels[2];
  const multiplier = isWin ? 3 : 0;

  return {
    reels,
    isWin,
    multiplier
  };
};

const generateBlackjackResult = () => {
  const playerCards = generateCards(2);
  const dealerCards = generateCards(2);
  const playerTotal = calculateHandTotal(playerCards);
  const dealerTotal = calculateHandTotal(dealerCards);
  const isWin = playerTotal > dealerTotal && playerTotal <= 21;

  return {
    playerCards,
    dealerCards,
    playerTotal,
    dealerTotal,
    isWin,
    multiplier: isWin ? 2 : 0
  };
};

const generateRouletteResult = () => {
  const number = Math.floor(Math.random() * 37); // 0-36
  const isRed = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(number);
  const isBlack = number !== 0 && !isRed;
  const isEven = number !== 0 && number % 2 === 0;
  const isOdd = number !== 0 && number % 2 === 1;

  return {
    number,
    color: number === 0 ? 'green' : isRed ? 'red' : 'black',
    isEven,
    isOdd,
    isRed,
    isBlack
  };
};

const generateCards = (count) => {
  const suits = ['♠️', '♥️', '♦️', '♣️'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = [];

  for (let i = 0; i < count; i++) {
    const suit = suits[Math.floor(Math.random() * suits.length)];
    const value = values[Math.floor(Math.random() * values.length)];
    cards.push({ suit, value });
  }

  return cards;
};

const calculateHandTotal = (cards) => {
  let total = 0;
  let aces = 0;

  cards.forEach(card => {
    if (card.value === 'A') {
      aces += 1;
    } else if (['J', 'Q', 'K'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value);
    }
  });

  // Add aces
  for (let i = 0; i < aces; i++) {
    if (total + 11 <= 21) {
      total += 11;
    } else {
      total += 1;
    }
  }

  return total;
}; 