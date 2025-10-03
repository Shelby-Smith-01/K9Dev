// api/tracks/finish.js
const { createClient } = require("@supabase/supabase-js");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function dataUrlToBuffer(dataUrl) {
  // data:image/png;base64,AAAA...
  const m = /^data:(.+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return {
    contentType: m[1],
    buffer: Buffer.from(m[2], "base64"),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE"));

    const {
      id,                    // track id (required)
      distance_m,
      duration_ms,
      pace_min_per_km,
      avg_speed_kmh,
      weather,
      elevation,
      points,                // breadcrumb array
      snapshotDataUrl        // OPTIONAL data URL (image/png, base64)
    } = req.body || {};

    if (!id) {
      res.statusCode = 400;
      return res.json({ error: "Missing track id" });
    }

    // Optional: upload snapshot if provided as data URL
    let snapshot_url = null;
    if (snapshotDataUrl) {
      const parsed = dataUrlToBuffer(snapshotDataUrl);
      if (parsed && parsed.buffer?.length) {
        const key = `tracks/${id}_${Date.now()}.png`;
        const { error: upErr } = await supabase
          .storage
          .from("snapshots")
          .upload(key, parsed.buffer, {
            upsert: false,
            contentType: parsed.contentType || "image/png",
          });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("snapshots").getPublicUrl(key);
        snapshot_url = pub?.publicUrl || null;
      }
    }

    // If no report_no yet, mint one atomically (YYYY-MM-XX)
    const { data: trackRow, error: fetchErr } = await supabase
      .from("tracks")
      .select("report_no")
      .eq("id", id)
      .single();
    if (fetchErr) throw fetchErr;

    let report_no = trackRow?.report_no || null;
    if (!report_no) {
      const { data: nextNo, error: rpcErr } = await supabase.rpc("next_track_report_no");
      if (rpcErr) throw rpcErr;
      report_no = nextNo;
    }

    // Persist the summary
    const { error: upErr2 } = await supabase
      .from("tracks")
      .update({
        ended_at: new Date().toISOString(),
        distance_m,
        duration_ms,
        pace_min_per_km,
        avg_speed_kmh,
        weather,
        elevation,
        points,
        snapshot_url: snapshot_url || null,
        report_no,
      })
      .eq("id", id);
    if (upErr2) throw upErr2;

    res.status(200).json({ ok: true, id, report_no, snapshot_url });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
