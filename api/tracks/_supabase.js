// Common helper to create an admin supabase client (server-side only)
const { createClient } = require('@supabase/supabase-js');

function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE; // service role
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
  return createClient(url, key, { auth: { persistSession: false } });
}

module.exports = { admin };
