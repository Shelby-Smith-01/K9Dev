// Vercel Node function (CommonJS)
const { createClient } = require("@supabase/supabase-js");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

let _client = null;
function getSupabase() {
  if (_client) return _client;
  const url = need("SUPABASE_URL");                 // e.g. https://xxxx.supabase.co
  const serviceKey = need("SUPABASE_SERVICE_ROLE"); // Service Role (secret)
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { headers: { "x-application": "k9-tracker-api" } },
  });
  return _client;
}

module.exports = { getSupabase };
