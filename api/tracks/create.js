exports.config = { runtime: "nodejs" }; // ensure Node runtime

const crypto = require("crypto");
const { getSupabase } = require("./_supabase");

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  const s = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(s); } catch { throw new Error("Invalid JSON body"); }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405; return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const body = await readJson(req);
    const deviceId = body.deviceId || null;
    const topic = body.topic || null;
    const startedAt = body.startedAt || new Date().toISOString();
    const shareCode = crypto.randomBytes(6).toString("base64url"); // short share token

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("tracks")
      .insert({
        device_id: deviceId,
        topic,
        started_at: startedAt,
        share_code: shareCode,
        is_public: true,
      })
      .select("id, share_code")
      .single();

    if (error) {
      // Common helpful hints
      let hint = "";
      if (String(error.message).includes("relation")) {
        hint = 'Table "tracks" not found. Create it in Supabase.';
      } else if (String(error.message).includes("permission")) {
        hint = "Permission denied: ensure you used the SERVICE ROLE key in SUPABASE_SERVICE_ROLE.";
      }
      console.error("tracks/create error:", error);
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: error.message, hint }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ id: data.id, shareCode: data.share_code }));
  } catch (e) {
    console.error("tracks/create exception:", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: String(e.message || e) }));
  }
};

