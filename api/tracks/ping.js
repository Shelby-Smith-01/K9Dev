const { getSupabase } = require('./_supabase');

module.exports = async (req, res) => {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from('tracks').select('count').limit(1);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, tableAccessible: !error, error: error?.message || null }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
};
