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

    const {
      id,
      endedAt = new Date().toISOString(),
      distance_m = null,
      duration_ms = null,
      weather = null,
      elevation = null,
      points = null
    } = body;

    if (!id) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing id' })); }

    let pace_min_per_km = null, avg_speed_kmh = null;
    if (Number(distance_m) > 0 && Number(duration_ms) > 0) {
      const km = Number(distance_m) / 1000;
      const minutes = Number(duration_ms) / 60000;
      pace_min_per_km = minutes / km;
      avg_speed_kmh = km / (Number(duration_ms) / 3600000);
    }

    const { error, data } = await supabase
      .from('tracks')
      .update({
        ended_at: endedAt,
        distance_m,
        duration_ms,
        pace_min_per_km,
        avg_speed_kmh,
        weather,
        elevation,
        points
      })
      .eq('id', id)
      .select('id, share_code')
      .single();

    if (error) { console.error('tracks/finish supabase error:', error); res.statusCode = 500; return res.end(JSON.stringify({ error: error.message })); }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, id: data.id, shareCode: data.share_code }));
  } catch (e) {
    console.error('tracks/finish exception:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
};

