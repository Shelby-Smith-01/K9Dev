const { getSupabase } = require('./_supabase');

module.exports = async (req, res) => {
  try {
    const supabase = await getSupabase();
    const q = req.query || {};
    const id = q.id || null;
    const share = q.share || null;

    let query = supabase.from('tracks').select('*').limit(1);
    if (id) query = query.eq('id', id);
    else if (share) query = query.eq('share_code', share);
    else { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Provide id or share' })); }

    const { data, error } = await query.single();
    if (error) { res.statusCode = 404; return res.end(JSON.stringify({ error: error.message })); }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error('tracks/get exception:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
};
