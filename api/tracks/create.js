// POST { deviceId, topic, startedAt? }
const { admin } = require('./_supabase');

function shortCode(n = 8) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for (let i=0;i<n;i++) s += a[Math.floor(Math.random()*a.length)];
  return s;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405; return res.end('Method Not Allowed');
  }
  try {
    const body = JSON.parse(req.body || '{}');
    const startedAt = body.startedAt || new Date().toISOString();
    const shareCode = shortCode();

    const supa = admin();
    const { data, error } = await supa.from('tracks').insert([{
      device_id: body.deviceId || null,
      topic: body.topic || null,
      started_at: startedAt,
      share_code: shareCode,
      is_public: true
    }]).select('id, share_code').single();

    if (error) throw error;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: data.id, shareCode: data.share_code }));
  } catch (e) {
    res.statusCode = 500; res.end(`Error: ${e.message || String(e)}`);
  }
};
