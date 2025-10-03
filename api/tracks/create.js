// api/tracks/create.js
const { createClient } = require("@supabase/supabase-js");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE"));

    // Expect body like: { device_id, topic, is_public }
    const { device_id, topic, is_public = true } = req.body || {};

    // Mint the monthly report number first (YYYY-MM-XXX)
    const { data: nextNo, error: rpcErr } = await supabase.rpc("next_track_report_no");
    if (rpcErr) throw rpcErr;

    // Optional: generate a short share code (6–8 chars)
    const share_code = Math.random().toString(36).slice(2, 8).toUpperCase();

    const started_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("tracks")
      .insert([{
        device_id,
        topic,
        started_at,
        is_public,
        share_code,
        report_no: nextNo,  // <-- assign here on create
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({
      ok: true,
      id: data.id,
      report_no: data.report_no,
      share_code: data.share_code,
      started_at: data.started_at,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};


