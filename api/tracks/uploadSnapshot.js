exports.config = { runtime: "nodejs" };

const { getSupabase } = require("./_supabase");

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  const s = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(s); } catch { throw new Error("Invalid JSON body"); }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const { id, dataUrl } = await readJson(req);
    if (!id || !dataUrl || !dataUrl.startsWith("data:image")) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "Missing id or dataUrl" }));
    }

    const supabase = getSupabase();

    // Decode base64 data URL → Buffer
    const base64 = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const path = `snapshots/${id}.png`;
    const { error: upErr } = await supabase
      .storage.from("snapshots")
      .upload(path, buffer, { contentType: "image/png", upsert: true });

    if (upErr) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: upErr.message }));
    }

    // Public URL (if bucket is public)
    const { data: pub } = supabase.storage.from("snapshots").getPublicUrl(path);
    const url = pub?.publicUrl || null;

    // Save URL back to the track
    await supabase.from("tracks").update({ snapshot_url: url }).eq("id", id);

    res.end(JSON.stringify({ ok: true, url }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
};
