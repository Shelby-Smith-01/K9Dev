// api/tracks/resolve.js
const { createClient } = require("@supabase/supabase-js");

function need(n){ const v=process.env[n]; if(!v) throw new Error(`Missing env: ${n}`); return v; }

module.exports = async (req, res) => {
  try {
    const { report_no } = req.query || {};
    if (!report_no) { res.statusCode = 400; return res.json({ error: "Missing report_no" }); }

    const s = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE"));
    const { data, error } = await s
      .from("tracks")
      .select("id")
      .eq("report_no", report_no)
      .single();

    if (error || !data) { res.statusCode = 404; return res.json({ error: "Not found" }); }
    res.json({ id: data.id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
