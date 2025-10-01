exports.config = { runtime: "nodejs" };

const { getSupabase } = require("./_supabase");

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  const s = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(s); } catch { throw new Error("Invalid JSON body"); }
}

function computeStats(distance_m, duration_ms) {
  const d = Number(distance_m) || 0;
  const ms = Number(duration_ms) || 0;
  const km = d / 1000;
  const hours = ms / 3_600_000;
  const avg_speed_kmh = hours > 0 ? km / hours : null;
  const pace_min_per_km = km > 0 ? (ms / 60_000) / km : null;
  return { avg_speed_kmh, pace_min_per_km };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405; return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const body = await readJson(req);
    const {
      id,
      endedAt = new Date().toISOString(),
      distance_m = 0,
      duration_ms = 0,
      weather = null,
      elevation = null,
      points = [],
    } = body || {};

    if (!id) {
      res.statusCode = 400; return res.end(JSON.stringify({ error: "Missing id" }));
    }

    const { avg_speed_kmh, pace_min_per_km } = computeStats(distance_m, duration_ms);

    const supabase = getSupabase();
    const { error } = await supabase
      .from("tracks")
      .update({
        ended_at: endedAt,
        distance_m,
        duration_ms,
        avg_speed_kmh,
        pace_min_per_km,
        weather,
        elevation,
        points,
      })
      .eq("id", id);

    if (error) {
      console.error("tracks/finish error:", error);
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: error.message }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error("tracks/finish exception:", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: String(e.message || e) }));
  }
};


