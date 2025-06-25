import Joi from "joi";
import { GAME_TYPES, GAME_MODES } from "../utils/constants.js";

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: "Validation Error",
      details: error.details.map((detail) => detail.message),
    });
  }
  next();
};

// Game validation schemas
export const gameSchemas = {
  startGame: Joi.object({
    gameType: Joi.string()
      .valid(...Object.values(GAME_TYPES))
      .required(),
    gameMode: Joi.string()
      .valid(...Object.values(GAME_MODES))
      .required(),
    betAmount: Joi.number().min(1).required(),
  }),

  placeBet: Joi.object({
    betAmount: Joi.number().min(1).required(),
  }),

  gameResult: Joi.object({
    results: Joi.array()
      .items(
        Joi.object({
          userId: Joi.string().required(),
          win: Joi.boolean().required(),
          amount: Joi.number().required(),
          hand: Joi.array().when("gameType", {
            is: GAME_TYPES.POKER,
            then: Joi.array().length(5).required(),
            otherwise: Joi.forbidden(),
          }),
          symbols: Joi.array().when("gameType", {
            is: GAME_TYPES.SLOTS,
            then: Joi.array().length(3).required(),
            otherwise: Joi.forbidden(),
          }),
          number: Joi.number().when("gameType", {
            is: GAME_TYPES.ROULETTE,
            then: Joi.number().min(0).max(36).required(),
            otherwise: Joi.forbidden(),
          }),
        })
      )
      .required(),
  }),
};

// Wallet validation schemas
export const walletSchemas = {
  purchaseChips: Joi.object({
    brokecoinAmount: Joi.number().min(1).required(),
  }),

  cashoutChips: Joi.object({
    chipsAmount: Joi.number().min(100).required(),
  }),
};

export default validate;
