export default {
  solana: {
    rpcUrl: "https://api.devnet.solana.com",
    brokecoinMint: "Ga4oZoNRLkZkruJpS8NLwa8DJCwKP9hbTBSNDQZ9V43v", // Example devnet token
    casinoWallet: "CasinoWallet1111111111111111111111111111111111111", // Example wallet
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
};
