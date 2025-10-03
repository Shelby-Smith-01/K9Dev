// api/forms/report.js
const { createClient } = require("@supabase/supabase-js");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  let supabase;
  try {
    const url = need("SUPABASE_URL");
    const serviceKey = need("SUPABASE_SERVICE_ROLE");
    supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  } catch (e) {
    console.error("env error:", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: e.message || String(e) }));
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const {
      handler,         // required
      dog,             // required
      email,           // optional
      notes,           // optional
      track_id,        // optional (uuid)
      attachment_url   // optional
      // DO NOT send department_name / logo_url unless you added those columns
    } = body;

    if (!handler || !dog) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "handler and dog are required" }));
    }
    if (track_id && !/^[0-9a-f-]{36}$/i.test(track_id)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "track_id must be a UUID" }));
    }

    const payload = {
      handler,
      dog,
      email: email || null,
      notes: notes || null,
      track_id: track_id || null,
      attachment_url: attachment_url || null,
    };

    const { data, error } = await supabase
      .from("reports")
      .insert(payload)
      .select("id, created_at")
      .single();

    if (error) {
      console.error("supabase insert error:", error);
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: error.message || String(error) }));
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, id: data.id, created_at: data.created_at }));
  } catch (e) {
    console.error("report route error:", e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: e.message || String(e) }));
  }
};

module.exports.config = { runtime: "nodejs" };

