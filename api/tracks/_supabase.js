// CommonJS wrapper that dynamically imports ESM supabase-js
async function getSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE; // service role bypasses RLS
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
  return createClient(url, key, { auth: { persistSession: false } });
}
module.exports = { getSupabase };

