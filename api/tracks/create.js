const { getSupabase } = require('./_supabase');

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      try { return resolve(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}); }
      catch (e) { return reject(e); }
    }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('Only POST'); }
    const supabase = await getSupabase();
    const body = await readJson(req);

    const { deviceId = null, topic = null, startedAt = new Date().toISOString() } = body;
    const shareCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    const { data, error } = await supabase
      .from('tracks')
      .insert([{ device_id: deviceId, topic, started_at: startedAt, share_code: shareCode }])
      .select('id, share_code')
      .single();

    if (error) { console.error('tracks/create supabase error:', error); res.statusCode = 500; return res.end(JSON.stringify({ error: error.message })); }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: data.id, shareCode: data.share_code }));
  } catch (e) {
    console.error('tracks/create exception:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
};
