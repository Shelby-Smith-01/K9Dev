// /api/tracks/active.js
const { createClient } = require("@supabase/supabase-js");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// GET /api/tracks/active?code=ABC123
// GET /api/tracks/active?topic=devices/esp-shelby-01/telemetry
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }
  const code = req.query?.code ? String(req.query.code) : null;
  const topic = req.query?.topic ? String(req.query.topic) : null;
  if (!code && !topic) {
    res.statusCode = 400;
    return res.json({ error: "Provide share code or topic" });
  }

  try {
    const supabase = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE"));
    let q = supabase.from("tracks").select("id, started_at, ended_at").is("ended_at", null);

    if (code) q = q.eq("share_code", code);
    if (topic) q = q.eq("topic", topic);

    const { data, error } = await q.order("started_at", { ascending: false }).limit(1);
    if (error) throw error;

    const row = data && data[0];
    const active = !!row;
    res.statusCode = 200;
    return res.json({ active, id: row?.id || null, startedAt: row?.started_at || null });
  } catch (e) {
    res.statusCode = 500;
    return res.json({ error: String(e.message || e) });
  }
};
