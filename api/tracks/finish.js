// POST { id, endedAt, distance_m, duration_ms, points, weather, elevation }
const { admin } = require('./_supabase');

function calcStats(distance_m, duration_ms) {
  const km = (Number(distance_m)||0) / 1000;
  const h  = (Number(duration_ms)||0) / 3600000;
  const pace_min_per_km = km > 0 ? ( (Number(duration_ms)/60000) / km ) : null; // minutes per km
  const avg_speed_kmh   = h  > 0 ? ( km / h ) : null;
  return { pace_min_per_km, avg_speed_kmh };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405; return res.end('Method Not Allowed');
  }
  try {
    const body = JSON.parse(req.body || '{}');
    const supa = admin();

    const { pace_min_per_km, avg_speed_kmh } = calcStats(body.distance_m, body.duration_ms);

    const { data, error } = await supa.from('tracks').update({
      ended_at: body.endedAt || new Date().toISOString(),
      distance_m: body.distance_m ?? null,
      duration_ms: body.duration_ms ?? null,
      pace_min_per_km, avg_speed_kmh,
      weather: body.weather ?? null,
      elevation: body.elevation ?? null,
      points: body.points ?? null
    }).eq('id', body.id).select('id, share_code').single();

    if (error) throw error;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: data.id, shareCode: data.share_code }));
  } catch (e) {
    res.statusCode = 500; res.end(`Error: ${e.message || String(e)}`);
  }
};
