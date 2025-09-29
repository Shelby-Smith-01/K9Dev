// GET ?id=UUID  OR  ?share=CODE
const { admin } = require('./_supabase');

module.exports = async (req, res) => {
  try {
    const supa = admin();
    const { id, share } = req.query || {};
    let q = supa.from('tracks').select('*').limit(1);
    if (id) q = q.eq('id', id);
    else if (share) q = q.eq('share_code', share).eq('is_public', true);
    else { res.statusCode = 400; return res.end('Missing id or share'); }

    const { data, error } = await q.single();
    if (error) throw error;

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 500; res.end(`Error: ${e.message || String(e)}`);
  }
};
