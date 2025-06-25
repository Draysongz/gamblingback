import { createClient } from "@supabase/supabase-js";
import config from "../config/config.js";
import { logger } from "../utils/logger.js";

const supabase = createClient(config.supabase.url, config.supabase.key);

// Test the connection
supabase
  .from("users")
  .select("count")
  .single()
  .then(() => {
    console.log("Successfully connected to Supabase");
  })
  .catch((error) => {
    logger.error("Failed to connect to Supabase:", error);
    process.exit(1);
  });

export { supabase };
