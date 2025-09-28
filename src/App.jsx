import { createPortal } from "react-dom";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { connect as mqttConnect } from "mqtt"; // alias to avoid name collision
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// --- Utilities ---
const haversine = (a, b) => {
  if (!a || !b) return 0;
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * d;
};

function prettyDistance(m) {
  if (m < 1000) return `${m.toFixed(1)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function prettyDuration(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => n.toString().padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

function useInterval(callback, delay) {
  const savedRef = useRef(callback);
  useEffect(() => { savedRef.current = callback; }, [callback]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => savedRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// Default connection (works over HTTPS)
const defaultConn = {
  host: "test.mosquitto.org",
  port: 8081,
  path: "/mqtt",
  ssl: true,
  topic: "devices/esp-shelby-01/telemetry",
};

// UI for connection settings
function ConnectionPanel({ conn, setConn, onConnect, onDisconnect, status, msgs, errorMsg }) {
  return (
    <div style={{padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', maxWidth:420}}>
      <div style={{fontSize:12, fontWeight:600, marginBottom:6}}>MQTT WebSocket</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
        <label style={{fontSize:12}}>Host
          <input style={{width:'100%'}} value={conn.host} onChange={(e)=>setConn({...conn, host:e.target.value})}/>
        </label>
        <label style={{fontSize:12}}>Port
          <input style={{width:'100%'}} value={conn.port} onChange={(e)=>setConn({...conn, port:Number(e.target.value)})}/>
        </label>
        <label style={{fontSize:12}}>Path
          <input style={{width:'100%'}} value={conn.path} onChange={(e)=>setConn({...conn, path:e.target.value})}/>
        </label>
        <label style={{fontSize:12, display:'flex', alignItems:'center', gap:6}}>SSL
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
        <div style={{marginTop:8, fontSize:12, color:'#b91c1c'}}>{errorMsg}</div>
      )}
    </div>
  );
}

// MQTT hook
function useMQTT(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const clientRef = useRef(null);

  const connect = () => {
    try { if (clientRef.current) { clientRef.current.end(true); clientRef.current = null; } } catch {}
    setStatus("connecting");
    setErrorMsg("");

    const url = `${conn.ssl ? "wss" : "ws"}://${conn.host}:${conn.port}${conn.path || "/mqtt"}`;
    let c;
    try {
      c = mqttConnect(url, { connectTimeout: 6000, clientId: `web-${Math.random().toString(16).slice(2)}` });
    } catch (e) {
      setStatus("error");
      setErrorMsg(e?.message || "Client create error");
      return;
    }

    clientRef.current = c;

    c.on("connect", () => {
      setStatus("connected");
      c.subscribe(conn.topic, { qos: 0 }, (err) => {
        if (err) { setStatus("error"); setErrorMsg(err?.message || "Subscribe error"); }
      });
    });
    c.on("reconnect", () => setStatus("reconnecting"));
    c.on("error", (err) => { setStatus("error"); setErrorMsg(err?.message || "MQTT error"); });
    c.on("close", () => { setStatus("idle"); });
    c.on("message", (_t, payload) => {
      setMsgs((n)=>n+1);
      try {
        const txt = payload.toString();
        const js = JSON.parse(txt);
        const lat = Number(js.lat ?? js.latitude ?? js.Latitude ?? js.Lat);
        const lon = Number(js.lon ?? js.lng ?? js.longitude ?? js.Longitude ?? js.Lon);
        const fix = Boolean(js.fix ?? js.gpsFix ?? true);
        const sats = Number(js.sats ?? js.satellites ?? 0);
        onMessage && onMessage({ lat, lon, fix, sats, raw: js });
      } catch {
        // ignore non-JSON messages
      }
    });
  };

  const disconnect = () => {
    try { clientRef.current && clientRef.current.end(true); } catch {}
    clientRef.current = null;
    setStatus("idle");
  };

  useEffect(() => () => { try { clientRef.current && clientRef.current.end(true); } catch {} }, []);

  return { status, msgs, errorMsg, connect, disconnect };
}

function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

export default function App() {
  const initialTab =
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'k9')
      ? 'k9' : 'live';

  const [tab, setTab] = useState(initialTab);
  const [panelOpen, setPanelOpen] = useState(true);
  const [conn, setConn] = useState(defaultConn);
  const [last, setLast] = useState(null); // {lat, lon, fix, sats, raw}
  const [points, setPoints] = useState([]); // breadcrumb for K9
  const [tracking, setTracking] = useState(false);
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [autoBreadcrumbFixOnly, setAutoBreadcrumbFixOnly] = useState(true);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);
  const [summary, setSummary] = useState(null);

  const { status, msgs, errorMsg, connect, disconnect } = useMQTT(conn, (msg) => {
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

  // timer for K9 elapsed
  useInterval(() => {
    if (tracking && startAt) setElapsed(Date.now() - startAt);
  }, 1000);

  const startTrack = () => {
    setPoints([]);
    setDistance(0);
    setStartAt(Date.now());
    setElapsed(0);
    setTracking(true);
  };

  const stopTrack = async () => {
    setTracking(false);
    const durMs = startAt ? Date.now() - startAt : 0;
    const dist = distance;
    const center = points.length ? points[Math.floor(points.length / 2)] : last;

    // Simple weather + elevation summaries
    let weather = null; let elevationStats = null;
    try {
      if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
        const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lon}&current_weather=true`).then(r=>r.json());
        weather = w?.current_weather || null;
      }
    } catch {}
    try {
      if (points.length) {
        const sample = points.filter((_,i)=> i % Math.max(1, Math.floor(points.length / 100)) === 0);
        const locs = sample.map(p=>`${p.lat},${p.lon}`).join("|");
        const e = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(locs)}`).then(r=>r.json());
        const els = e?.results?.map(r=>r.elevation).filter(Number.isFinite) || [];
        if (els.length) {
          let gain=0, loss=0;
          for (let i=1;i<els.length;i++) {
            const d = els[i]-els[i-1];
            if (d>0) gain += d; else loss += Math.abs(d);
          }
          elevationStats = { gain, loss };
        }
      }
    } catch {}

    setSummary({ distance: dist, durationMs: durMs, weather, elevation: elevationStats, points });
  };

  const downloadSummary = () => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify({
      when: new Date().toISOString(),
      device: conn.topic,
      distance_m: summary.distance,
      duration_ms: summary.durationMs,
      weather: summary.weather,
      elevation: summary.elevation,
      samples: summary.points.length,
      path: summary.points,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `k9_track_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const center = useMemo(() => {
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
    return [30, -97]; // default (Austin-ish)
  }, [last]);

  return (
    <div style={{height:'100%', width:'100%', background:'#f8fafc'}}>
      {/* Header */}
      <div style={{padding:12, display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #e5e7eb', background:'#fff', position:'sticky', top:0, zIndex:20}}>
        <div style={{fontSize:18, fontWeight:600}}>K9 Live Tracker</div>
        <div style={{marginLeft:16, display:'flex', gap:6, background:'#f1f5f9', borderRadius:14, padding:6}}>
          <button onClick={()=>setTab("live")} style={{padding:'6px 10px', borderRadius:10, background: tab==='live'?'#fff':'transparent', boxShadow: tab==='live'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>Live Map</button>
          <button onClick={()=>setTab("k9")} style={{padding:'6px 10px', borderRadius:10, background: tab==='k9'?'#fff':'transparent', boxShadow: tab==='k9'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>K9 Track</button>
        </div>
      </div>

      {/* Floating toggle for the panel */}
      <button
        onClick={() => setPanelOpen(o => !o)}
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1001,
          padding: '8px 12px',
          borderRadius: 10,
          background: '#111',
          color: '#fff',
          border: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,.12)'
        }}
      >
        {panelOpen ? 'Hide' : 'Connect'}
      </button>

      {/* Connection + Info cards */}
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
            <div style={{marginTop:8, padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', fontSize:12}}>
              <div style={{fontWeight:600}}>Last fix</div>
              <div>lat: {Number.isFinite(last.lat)? last.lat.toFixed(6): '—'} lon: {Number.isFinite(last.lon)? last.lon.toFixed(6): '—'}</div>
              <div>fix: {String(last.fix)} sats: {Number.isFinite(last.sats)? last.sats: '—'}</div>
              <label style={{display:'flex', alignItems:'center', gap:6}}>
                <input type="checkbox" checked={recenterOnUpdate} onChange={(e)=>setRecenterOnUpdate(e.target.checked)} /> Recenter on update
              </label>
            </div>
          )}

          {tab === 'k9' && (
            <div style={{marginTop:8, padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', fontSize:12}}>
              <div style={{fontWeight:600, marginBottom:6}}>K9 Track Controls</div>
              <div style={{display:'flex', gap:8}}>
                {!tracking ? (
                  <button onClick={startTrack} style={{padding:'6px 10px', borderRadius:10, background:'#16a34a', color:'#fff'}}>Start</button>
                ) : (
                  <button onClick={stopTrack} style={{padding:'6px 10px', borderRadius:10, background:'#dc2626', color:'#fff'}}>Stop</button>
                )}
                <button onClick={()=>{ setPoints([]); setDistance(0); setElapsed(0); setStartAt(null); setSummary(null); }} style={{padding:'6px 10px', borderRadius:10}}>Clear</button>
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
                  <div>Distance: {prettyDistance(summary.distance)}</div>
                  <div>Duration: {prettyDuration(summary.durationMs)}</div>
                  <div>Weather: {summary.weather ? `${summary.weather.temperature}°C, wind ${summary.weather.windspeed} km/h` : '—'}</div>
                  <div>Elevation: {summary.elevation ? `gain ${Math.round(summary.elevation.gain)} m, loss ${Math.round(summary.elevation.loss)} m` : '—'}</div>
                  <div style={{marginTop:8, display:'flex', gap:8}}>
                    <button onClick={downloadSummary} style={{padding:'6px 10px', borderRadius:10, background:'#111', color:'#fff'}}>Download JSON</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Map */}
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
