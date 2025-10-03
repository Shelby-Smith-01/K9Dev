import React, { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import * as L from "leaflet";
import * as htmlToImage from "html-to-image";
import "leaflet/dist/leaflet.css";

/* ===========================
   Small utils
=========================== */
const haversine = (a, b) => {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * d;
};
const prettyDistance = (m) => (m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`);
const prettyDuration = (ms) => {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => n.toString().padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
};
const paceMinPerKm = (distance_m, duration_ms) => {
  if (!distance_m || !duration_ms) return null;
  const km = distance_m / 1000;
  if (km <= 0) return null;
  return (duration_ms / 60000) / km;
};
const avgSpeedKmh = (distance_m, duration_ms) => {
  if (!distance_m || !duration_ms) return null;
  const km = distance_m / 1000;
  const h = duration_ms / 3600000;
  if (h <= 0) return null;
  return km / h;
};
function useInterval(callback, delay) {
  const savedRef = useRef(callback);
  useEffect(() => { savedRef.current = callback; }, [callback]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => savedRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

/* ===========================
   Clean, bounded snapshot
=========================== */
async function captureTrackSnapshot({ points = [], last = null, width = 900, height = 600 }) {
  return new Promise((resolve, reject) => {
    const off = document.createElement("div");
    off.style.cssText = `
      position: fixed; left: -10000px; top: -10000px;
      width: ${width}px; height: ${height}px;
      background: #f8fafc; z-index: -1;
    `;
    document.body.appendChild(off);

    const map = L.map(off, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });

    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      tileSize: 256,
      detectRetina: false,
      crossOrigin: true,
      updateWhenZooming: false,
      updateWhenIdle: true,
    }).addTo(map);

    if (points.length >= 2) {
      const latlngs = points.map(p => L.latLng(p.lat, p.lon));
      const line = L.polyline(latlngs, { color: "#2563eb", weight: 4, opacity: 0.9 }).addTo(map);
      let bounds = line.getBounds();
      if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 25) bounds = bounds.pad(0.005);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      L.circleMarker(latlngs[0], { radius: 6, color: "#059669", weight: 2, fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: "#dc2626", weight: 2, fillOpacity: 1 }).addTo(map);
    } else {
      const c = last && Number.isFinite(last.lat) && Number.isFinite(last.lon) ? [last.lat, last.lon] : [30, -97];
      map.setView(c, 14);
      L.circleMarker(c, { radius: 8, color: "#111", weight: 3, fillOpacity: 1 }).addTo(map);
    }

    const snap = async () => {
      setTimeout(async () => {
        try {
          const dataUrl = await htmlToImage.toPng(off, {
            canvasWidth: width,
            canvasHeight: height,
            pixelRatio: 2,
            backgroundColor: "#f8fafc",
            cacheBust: true,
          });
          map.remove();
          off.remove();
          resolve(dataUrl);
        } catch (e) {
          map.remove();
          off.remove();
          reject(e);
        }
      }, 300);
    };

    tiles.on("load", snap);
    setTimeout(snap, 2000);
  });
}

/* ===========================
   SSE hook -> /api/stream
=========================== */
const defaultConn = {
  host: "broker.emqx.io",
  port: 8883,
  ssl: true,
  topic: "devices/esp-shelby-01/telemetry",
};
function useSSE(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastPayload, setLastPayload] = useState("");
  const esRef = useRef(null);

  const connect = () => {
    try { esRef.current?.close(); } catch {}
    esRef.current = null;
    setStatus("connecting");
    setMsgs(0);
    setErrorMsg("");

    const qs = new URLSearchParams({
      host: conn.host || "",
      port: String(conn.port || (conn.ssl ? 8883 : 1883)),
      topic: conn.topic || "devices/#",
      ssl: conn.ssl ? "1" : "0",
    }).toString();
    const url = `/api/stream?${qs}`;
    setErrorMsg(`Connecting via SSE: ${url}`);

    let es;
    try {
      es = new EventSource(url);
    } catch (e) {
      setStatus("error");
      setErrorMsg((m) => `${m}\nEventSource create: ${e?.message || String(e)}`);
      return;
    }
    esRef.current = es;

    es.onopen = () => setStatus("connected");

    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data);
        if (obj.payload != null) setLastPayload(`${obj.topic}: ${obj.payload}`);
        if (obj.payload) {
          try {
            const js = JSON.parse(obj.payload);
            const lat = Number(js.lat ?? js.latitude ?? js.Latitude ?? js.Lat);
            const lon = Number(js.lon ?? js.lng ?? js.longitude ?? js.Longitude ?? js.Lon);
            const fix = Boolean(js.fix ?? js.gpsFix ?? true);
            const sats = Number(js.sats ?? js.satellites ?? 0);
            onMessage && onMessage({ lat, lon, fix, sats, raw: js });
          } catch {}
        }
      } catch {}
      setMsgs((n) => n + 1);
    };

    es.addEventListener("diag", (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.error) {
          setStatus("error");
          setErrorMsg((m) => `${m}\n${d.error}`);
        }
      } catch {}
    });

    es.onerror = () => {
      setStatus("error");
      setErrorMsg((m) => `${m}\nSSE error`);
    };
  };

  const disconnect = () => {
    try { esRef.current?.close(); } catch {}
    esRef.current = null;
    setStatus("idle");
  };

  useEffect(() => () => { try { esRef.current?.close(); } catch {} }, []);

  return { status, msgs, errorMsg, lastPayload, connect, disconnect };
}

/* ===========================
   UI bits
=========================== */
function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => { if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon]); }, [lat, lon, map]);
  return null;
}

function ConnectionPanel({ conn, setConn, onConnect, onDisconnect, status, msgs, errorMsg }) {
  return (
    <div style={{padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', maxWidth:420}}>
      <div style={{fontSize:12, fontWeight:600, marginBottom:6}}>MQTT (via SSE)</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
        <label style={{fontSize:12}}>Host
          <input style={{width:'100%'}} value={conn.host} onChange={(e)=>setConn({...conn, host:e.target.value})}/>
        </label>
        <label style={{fontSize:12}}>Port
          <input style={{width:'100%'}} value={conn.port} onChange={(e)=>setConn({...conn, port:Number(e.target.value)})}/>
        </label>
        <label style={{fontSize:12, display:'flex', alignItems:'center', gap:6}}>TLS
          <input type="checkbox" checked={conn.ssl} onChange={(e)=>setConn({...conn, ssl:e.target.checked})}/>
        </label>
      </div>
      <label style={{fontSize:12, display:'block', marginTop:8}}>Topic
        <input style={{width:'100%'}} value={conn.topic} onChange={(e)=>setConn({...conn, topic:e.target.value})}/>
      </label>
      <div style={{display:'flex', alignItems:'center', gap:8, marginTop:8, fontSize:13}}>
        <button onClick={onConnect} style={{padding:'6px 10px', borderRadius:10, background:'#111', color:'#fff'}}>Connect</button>
        <button onClick={onDisconnect} style={{padding:'6px 10px', borderRadius:10}}>Disconnect</button>
        <span style={{display:'inline-flex', alignItems:'center', gap:8, marginLeft:8}}>
          <span style={{width:10, height:10, borderRadius:'50%', background: status==='connected'?'#22c55e': status==='error'?'#ef4444': status==='reconnecting'?'#f59e0b':'#d1d5db'}}></span>
          <span style={{fontSize:12, color:'#6b7280'}}>{status || "idle"}</span>
        </span>
        <span style={{marginLeft:'auto', fontSize:12, color:'#6b7280'}}>Msgs: {msgs}</span>
      </div>
      {status === 'error' && errorMsg && (
        <div style={{marginTop:8, fontSize:12, color:'#b91c1c', whiteSpace:'pre-wrap'}}>{errorMsg}</div>
      )}
    </div>
  );
}

/* ===========================
   Tracker (full control)
=========================== */
function Tracker() {
  const [tab, setTab] = useState("live"); // 'live' | 'k9'
  const [panelOpen, setPanelOpen] = useState(true);
  const [conn, setConn] = useState(defaultConn);

  const [last, setLast] = useState(null);
  const [points, setPoints] = useState([]);
  const [tracking, setTracking] = useState(false);
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [autoBreadcrumbFixOnly, setAutoBreadcrumbFixOnly] = useState(true);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);

  const [trackId, setTrackId] = useState(null);
  const [reportNo, setReportNo] = useState(null);
  const [summary, setSummary] = useState(null);

  const { status, msgs, errorMsg, lastPayload, connect, disconnect } = useSSE(conn, (msg) => {
    if (Number.isFinite(msg.lat) && Number.isFinite(msg.lon)) {
      setLast(msg);
      if (tab === "k9" && tracking) {
        if (!autoBreadcrumbFixOnly || msg.fix) {
          setPoints((prev) => {
            const next = [...prev, { lat: msg.lat, lon: msg.lon, ts: Date.now() }];
            if (next.length > 1) {
              const seg = haversine(next[next.length - 2], next[next.length - 1]);
              setDistance((d) => d + seg);
            }
            return next;
          });
        }
      }
    }
  });

  useInterval(() => {
    if (tracking && startAt) setElapsed(Date.now() - startAt);
  }, 1000);

  const startTrack = async () => {
    setPoints([]); setDistance(0); setStartAt(Date.now()); setElapsed(0);
    setTracking(true); setSummary(null); setReportNo("pending");

    try {
      const resp = await fetch("/api/tracks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: "esp-shelby-01", topic: conn.topic, is_public: true }),
      });
      const js = await resp.json().catch(() => ({}));
      if (resp.ok && js.id) {
        setTrackId(js.id);
        if (js.report_no) setReportNo(js.report_no);
      }
    } catch {}
  };

  const stopTrack = async () => {
    setTracking(false);
    const durMs = startAt ? Date.now() - startAt : 0;
    const distM = distance || 0;
    const pMinPerKm = paceMinPerKm(distM, durMs);
    const avgKmh = avgSpeedKmh(distM, durMs);

    let weather = null;
    try {
      const center = points.length ? points[Math.floor(points.length / 2)] : last;
      if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lon}&current_weather=true`
        ).then(r => r.json());
        weather = w?.current_weather || null;
      }
    } catch {}

    let elevation = null;
    try {
      if (points.length) {
        const sample = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 100)) === 0);
        const locs = sample.map(p => `${p.lat},${p.lon}`).join("|");
        const e = await fetch(
          `https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(locs)}`
        ).then(r => r.json());
        const els = e?.results?.map(r => r.elevation).filter(Number.isFinite) || [];
        if (els.length) {
          let gain = 0, loss = 0;
          for (let i = 1; i < els.length; i++) {
            const d = els[i] - els[i - 1];
            if (d > 0) gain += d; else loss += Math.abs(d);
          }
          elevation = { gain, loss };
        }
      }
    } catch {}

    let snapshotDataUrl = null;
    try {
      snapshotDataUrl = await captureTrackSnapshot({ points, last });
    } catch {}

    const payload = {
      id: trackId || null,
      device_id: "esp-shelby-01",
      topic: conn.topic,
      started_at: startAt ? new Date(startAt).toISOString() : null,
      ended_at: new Date().toISOString(),
      distance_m: Number.isFinite(distM) ? distM : 0,
      duration_ms: Number.isFinite(durMs) ? durMs : 0,
      pace_min_per_km: pMinPerKm != null ? Number(pMinPerKm.toFixed(3)) : null,
      avg_speed_kmh:  avgKmh    != null ? Number(avgKmh.toFixed(3))    : null,
      weather,
      elevation,
      points,
      snapshotDataUrl,
    };

    let snapshot_url = null;
    let returned_report_no = null;
    try {
      const resp2 = await fetch("/api/tracks/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const js2 = await resp2.json().catch(() => ({}));
      if (resp2.ok) {
        snapshot_url = js2?.snapshot_url || null;
        returned_report_no = js2?.report_no || reportNo;
      }
    } catch {}

    setSummary({
      distance: distM,
      durationMs: durMs,
      paceMinPerKm: pMinPerKm,
      avgSpeedKmh: avgKmh,
      weather,
      elevation,
      points,
      snapshotUrl: snapshot_url,
      snapshotDataUrl,
      report_no: returned_report_no || reportNo || "pending",
    });
  };

  const center = useMemo(() => {
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
    return [30, -97];
  }, [last]);

  return (
    <div style={{height:'100%', width:'100%', background:'#f8fafc'}}>
      <div style={{padding:12, display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #e5e7eb', background:'#fff', position:'sticky', top:0, zIndex:20}}>
        <div style={{fontSize:18, fontWeight:600}}>K9 Live Tracker</div>
        <div style={{marginLeft:16, display:'flex', gap:6, background:'#f1f5f9', borderRadius:14, padding:6}}>
          <button onClick={()=>setTab("live")} style={{padding:'6px 10px', borderRadius:10, background: tab==='live'?'#fff':'transparent', boxShadow: tab==='live'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>Live Map</button>
          <button onClick={()=>setTab("k9")} style={{padding:'6px 10px', borderRadius:10, background: tab==='k9'?'#fff':'transparent', boxShadow: tab==='k9'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>K9 Track</button>
        </div>
        <button onClick={() => setPanelOpen(o => !o)} style={{marginLeft:'auto', padding:'6px 10px', borderRadius:10, background:'#111', color:'#fff'}}>
          {panelOpen ? 'Hide' : 'Connect'}
        </button>
      </div>

      {panelOpen && (
        <div style={{position:'fixed', top:16, left:16, zIndex:1000}}>
          <ConnectionPanel
            conn={conn}
            setConn={setConn}
            onConnect={connect}
            onDisconnect={disconnect}
            status={status}
            msgs={msgs}
            errorMsg={errorMsg}
          />

          {last && (
            <div style={{marginTop:8, padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', fontSize:12, maxWidth:420}}>
              <div style={{fontWeight:600}}>Last fix</div>
              <div>lat: {Number.isFinite(last.lat)? last.lat.toFixed(6): '—'} lon: {Number.isFinite(last.lon)? last.lon.toFixed(6): '—'}</div>
              <div>fix: {String(last.fix)} sats: {Number.isFinite(last.sats)? last.sats: '—'}</div>
              <label style={{display:'flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={recenterOnUpdate} onChange={(e)=>setRecenterOnUpdate(e.target.checked)} /> Recenter on update
              </label>
              {trackId && (
                <div style={{marginTop:6, color:'#334155'}}>Track: <b>{reportNo || "pending"}</b></div>
              )}
              {lastPayload && (
                <div style={{marginTop:8, padding:8, background:'rgba(255,255,255,0.95)', border:'1px dashed #94a3b8', borderRadius:12, fontSize:12, maxWidth:420, wordBreak:'break-word'}}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Last payload</div>
                  {lastPayload}
                </div>
              )}
            </div>
          )}

          {tab === 'k9' && (
            <div style={{marginTop:8, padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', fontSize:12, maxWidth:420}}>
              <div style={{fontWeight:600, marginBottom:6}}>K9 Track Controls</div>
              <div style={{display:'flex', gap:8}}>
                {!tracking ? (
                  <button onClick={startTrack} style={{padding:'6px 10px', borderRadius:10, background:'#16a34a', color:'#fff'}}>Start</button>
                ) : (
                  <button onClick={stopTrack} style={{padding:'6px 10px', borderRadius:10, background:'#dc2626', color:'#fff'}}>Stop</button>
                )}
                <button
                  onClick={()=>{
                    setPoints([]); setDistance(0); setElapsed(0); setStartAt(null);
                    setSummary(null); setTrackId(null); setReportNo(null);
                  }}
                  style={{padding:'6px 10px', borderRadius:10}}
                >Clear</button>
              </div>
              <div>Time: {prettyDuration(elapsed)}</div>
              <div>Distance: {prettyDistance(distance)}</div>
              <label style={{display:'flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={autoBreadcrumbFixOnly} onChange={(e)=>setAutoBreadcrumbFixOnly(e.target.checked)} />
                Only add crumbs when fix=true
              </label>

              {summary && (
                <div style={{marginTop:8, padding:8, background:'#f1f5f9', borderRadius:8}}>
                  <div style={{fontWeight:600, marginBottom:4}}>Summary</div>
                  <div>Report #: <b>{summary.report_no || "pending"}</b></div>
                  <div>Distance: {prettyDistance(summary.distance)}</div>
                  <div>Duration: {prettyDuration(summary.durationMs)}</div>
                  <div>Pace: {summary.paceMinPerKm ? `${summary.paceMinPerKm.toFixed(2)} min/km` : '—'}</div>
                  <div>Avg speed: {summary.avgSpeedKmh ? `${summary.avgSpeedKmh.toFixed(2)} km/h` : '—'}</div>
                  <div>Weather: {summary.weather ? `${summary.weather.temperature}°C, wind ${summary.weather.windspeed} km/h` : '—'}</div>
                  <div>Elevation: {summary.elevation ? `gain ${Math.round(summary.elevation.gain)} m, loss ${Math.round(summary.elevation.loss)} m` : '—'}</div>
                  {(summary.snapshotUrl || summary.snapshotDataUrl) && (
                    <div style={{marginTop:8}}>
                      <img
                        src={summary.snapshotUrl || summary.snapshotDataUrl}
                        alt="track snapshot"
                        style={{maxWidth:'100%', borderRadius:8, border:'1px solid #e5e7eb'}}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{height:'100%'}}>
        <MapContainer center={useMemo(() => {
          if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
          return [30, -97];
        }, [last])} zoom={13} style={{height:'100%', width:'100%'}}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <Recenter lat={last.lat} lon={last.lon} />
          )}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
          )}
          {(tab === 'k9' ? points : []).length > 0 && (
            <Polyline positions={points.map(p=>[p.lat, p.lon])} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

/* ===========================
   Viewer (read-only live map)
=========================== */
function Viewer() {
  const [conn, setConn] = useState(defaultConn);
  const [last, setLast] = useState(null);
  const { status, msgs, errorMsg, lastPayload, connect, disconnect } = useSSE(conn, (msg) => {
    if (Number.isFinite(msg.lat) && Number.isFinite(msg.lon)) setLast(msg);
  });

  const center = useMemo(() => {
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
    return [30, -97];
  }, [last]);

  useEffect(() => { connect(); return () => disconnect(); }, []); // auto-connect

  return (
    <div style={{height:'100%', width:'100%', background:'#f8fafc'}}>
      <div style={{padding:12, display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #e5e7eb', background:'#fff', position:'sticky', top:0, zIndex:20}}>
        <div style={{fontSize:18, fontWeight:600}}>Viewer (Live)</div>
        <div style={{marginLeft:'auto', fontSize:12, color:'#6b7280'}}>Status: {status} · Msgs: {msgs}</div>
      </div>

      <div style={{position:'fixed', top:16, left:16, zIndex:1000}}>
        {/* show minimal status + topic */}
        <div style={{padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', maxWidth:360}}>
          <div style={{fontSize:12, fontWeight:600, marginBottom:6}}>Connected to</div>
          <div style={{fontSize:12, color:'#334155'}}>
            {conn.ssl ? "mqtts" : "mqtt"}://{conn.host}:{conn.port}
            <div style={{marginTop:4}}>Topic: <code>{conn.topic}</code></div>
          </div>
          {status === 'error' && errorMsg && (
            <div style={{marginTop:8, fontSize:12, color:'#b91c1c', whiteSpace:'pre-wrap'}}>{errorMsg}</div>
          )}
        </div>
      </div>

      <div style={{height:'100%'}}>
        <MapContainer center={center} zoom={13} style={{height:'100%', width:'100%'}}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

/* ===========================
   Reports stub (placeholder)
=========================== */
function Reports() {
  return (
    <div style={{padding:16}}>
      <h2 style={{fontWeight:700, fontSize:20, marginBottom:8}}>Reports</h2>
      <p>This is a placeholder page. Hook up your Supabase list + PDF links here.</p>
    </div>
  );
}

/* ===========================
   App (with Router)
   NOTE: If your main.jsx already wraps <BrowserRouter>,
         you can remove the <BrowserRouter> lines below.
=========================== */
export default function App() {
  return (
      <div style={{height:"100vh", width:"100vw", display:"flex", flexDirection:"column"}}>
        <nav style={{position:"sticky", top:0, zIndex:50, background:"#fff", borderBottom:"1px solid #eee", padding:8, display:'flex', gap:12}}>
          <Link to="/">Live</Link>
          <Link to="/view">Viewer</Link>
          <Link to="/reports">Reports</Link>
        </nav>
        <div style={{flex:1, minHeight:0}}>
          <Routes>
            <Route path="/" element={<Tracker />} />
            <Route path="/view" element={<Viewer />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </div>
      </div>
  );
}





