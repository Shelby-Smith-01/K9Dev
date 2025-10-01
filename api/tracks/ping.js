exports.config = { runtime: "nodejs" };

const { getSupabase } = require("./_supabase");

module.exports = async (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    // Check env + connectivity
    const supabase = getSupabase();
    const { error } = await supabase.from("tracks").select("id").limit(1);
    if (error) {
      console.error("tracks/ping error:", error);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return res.end(JSON.stringify({ ok: true, tableAccessible: true }));
  } catch (e) {
    console.error("tracks/ping exception:", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
};
