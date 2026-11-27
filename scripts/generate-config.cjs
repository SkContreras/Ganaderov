const fs = require("node:fs");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !key.startsWith("sb_publishable_")) throw new Error("Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel.");
if (new URL(url).protocol !== "https:") throw new Error("Supabase URL must use HTTPS.");
const config = {
  supabaseUrl: url,
  supabaseAnonKey: key,
  syncRpcOnlyV1: process.env.SYNC_RPC_ONLY_V1 === "true",
  syncIncrementalV1: process.env.SYNC_INCREMENTAL_V1 === "true",
  syncEventRpcV1: process.env.SYNC_EVENT_RPC_V1 === "true",
  syncBackgroundV1: process.env.SYNC_BACKGROUND_V1 === "true"
};
fs.writeFileSync("config.js", "window.GANADERO_CONFIG = " + JSON.stringify(config) + ";\n");
