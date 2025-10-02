// /api/tracks/byShare.js
const { createClient } = require("@supabase/supabase-js");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// GET /api/tracks/byShare?code=XXXX
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }
  const code = (req.query && req.query.code) ? String(req.query.code) : "";
  if (!code) {
    res.statusCode = 400;
    return res.json({ error: "Missing share code" });
  }

  try {
    const supabase = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE"));
    const { data, error } = await supabase
      .from("tracks")
      .select("id, topic, host, port, ssl, share_code")
      .eq("share_code", code)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.statusCode = 404;
      return res.json({ error: "Not found" });
    }

    // Only return safe fields
    res.statusCode = 200;
    return res.json({
      id: data.id,
      topic: data.topic,
      host: data.host || null,
      port: data.port || null,
      ssl: typeof data.ssl === "boolean" ? data.ssl : null
    });
  } catch (e) {
    res.statusCode = 500;
    return res.json({ error: String(e.message || e) });
  }
};
