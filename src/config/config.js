import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Joi from "joi";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, "../../.env") });

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string()
      .valid("production", "development", "test")
      .required(),
    PORT: Joi.number().default(3000),
    SUPABASE_URL: Joi.string().required().description("Supabase url"),
    SUPABASE_KEY: Joi.string().required().description("Supabase role key"),
    JWT_SECRET: Joi.string().required().description("JWT secret key"),
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number()
      .default(1440)
      .description("minutes after which access tokens expire"),
    JWT_REFRESH_EXPIRATION_DAYS: Joi.number()
      .default(30)
      .description("days after which refresh tokens expire"),
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description("minutes after which reset password token expires"),
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description("minutes after which verify email token expires"),
    CLIENT_URL: Joi.string().description("Client URL"),
    SOLANA_RPC_URL: Joi.string().required().description("Solana RPC URL"),
    SOLANA_BROKECOIN_MINT: Joi.string()
      .required()
      .description("Brokecoin token mint address"),
    SOLANA_CASINO_WALLET: Joi.string()
      .required()
      .description("Casino wallet address"),
    REDIS_URL: Joi.string().description("Redis connection URL (for Upstash)"),
    REDIS_HOST: Joi.string().description("Redis host"),
    REDIS_PORT: Joi.number().description("Redis port"),
    REDIS_PASSWORD: Joi.string().description("Redis password"),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: "key" } })
  .validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const config = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  supabase: {
    url: envVars.SUPABASE_URL,
    key: envVars.SUPABASE_KEY,
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
    resetPasswordExpirationMinutes:
      envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
    verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
  },
  clientUrl: envVars.CLIENT_URL || "http://localhost:3001",
  solana: {
    network: process.env.SOLANA_NETWORK || "devnet",
    rpcUrl: envVars.SOLANA_RPC_URL,
    brokecoinMint: envVars.SOLANA_BROKECOIN_MINT,
    casinoWallet: envVars.SOLANA_CASINO_WALLET,
  },
  redis: {
    url: envVars.REDIS_URL,
    host: envVars.REDIS_HOST || "localhost",
    port: envVars.REDIS_PORT || 6379,
    password: envVars.REDIS_PASSWORD,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  },
  gameLimits: {
    minBet: 0.1,
    maxBet: 1000,
    maxPlayers: {
      slots: 4,
      blackjack: 7,
      roulette: 8,
    },
  },
};

export default config;
