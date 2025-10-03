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

    const { handler, dog, email, track_id, notes, attachment_url } = req.body || {};

    // Basic validation
    if (!handler || !dog) {
      res.statusCode = 400;
      return res.json({ error: "handler and dog are required" });
    }

    const { data, error } = await supabase
      .from("reports")
      .insert([{ handler, dog, email, track_id, notes, attachment_url }])
      .select()
      .limit(1)
      .single();

    if (error) {
      res.statusCode = 500;
      return res.json({ error: error.message });
    }

    res.statusCode = 200;
    res.json({ ok: true, id: data.id });
  } catch (e) {
    res.statusCode = 500;
    res.json({ error: String(e.message || e) });
  }
};
