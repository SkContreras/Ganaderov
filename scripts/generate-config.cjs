const fs = require("node:fs");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !key.startsWith("sb_publishable_")) throw new Error("Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel.");
if (new URL(url).protocol !== "https:") throw new Error("Supabase URL must use HTTPS.");
fs.writeFileSync("config.js", "window.GANADERO_CONFIG = " + JSON.stringify({supabaseUrl:url,supabaseAnonKey:key}) + ";\n");
