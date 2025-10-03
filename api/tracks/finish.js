// api/tracks/finish.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      track_id,
      distance_m,
      duration_ms,
      pace_min_per_km,
      avg_speed_kmh,
      weather,
      elevation,
      points,
      snapshotDataUrl, // "data:image/png;base64,...."
    } = await req.body || req.json?.(); // supports Edge/Node

    if (!track_id) return res.status(400).json({ error: "missing track_id" });

    // 1) Upload snapshot if provided
    let snapshot_url = null;
    try {
      if (snapshotDataUrl?.startsWith("data:image")) {
        const base64 = snapshotDataUrl.split(",")[1];
        const bytes = Buffer.from(base64, "base64");
        const key = `tracks/${track_id}/${Date.now()}.png`;

        const { error: upErr } = await supabase
          .storage
          .from("snapshots")
          .upload(key, bytes, { contentType: "image/png", upsert: true });
        if (upErr) throw upErr;

        const { data: pub } = supabase
          .storage
          .from("snapshots")
          .getPublicUrl(key);

        snapshot_url = pub?.publicUrl || null;
      }
    } catch (e) {
      console.error("snapshot upload failed", e);
      // continue without snapshot
    }

    // 2) Update track row with summary + snapshot_url
    const { data, error } = await supabase
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
        snapshot_url, // <- public URL we just generated (or null)
      })
      .eq("id", track_id)
      .select("id, snapshot_url")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ok: true,
      id: data.id,
      snapshot_url: data.snapshot_url,
    });
  } catch (e) {
    console.error("finish handler error", e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}

