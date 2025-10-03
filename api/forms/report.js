// api/forms/report.js
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

    const {
      handler, dog, email, track_id, notes,
      attachment_url,     // optional uploaded file (from Storage)
      map_snapshot_url    // <-- pass snapshotUrl from the app if you want it shown in the report
    } = req.body || {};

    if (!handler || !dog) {
      res.statusCode = 400;
      return res.json({ error: "handler and dog are required" });
    }

    const { data, error } = await supabase
      .from("reports")
      .insert([{
        handler, dog, email, track_id, notes,
        attachment_url: attachment_url || map_snapshot_url || null,
        map_snapshot_url: map_snapshot_url || null
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
