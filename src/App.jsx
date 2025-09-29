import { createPortal } from "react-dom";
import React, { useEffect, useMemo, useRef, useState } from "react";
import mqtt from "mqtt"; // for WS mode (kept for future); API uses Node mqtt server-side
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// --- Utilities ---
const haversine = (a, b) => {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * d;
};
const prettyDistance = (m) => (m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`);
function prettyDuration(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => n.toString().padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
function useInterval(cb, delay) {
  const r = useRef(cb);
  useEffect(() => { r.current = cb; }, [cb]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => r.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// ---- Defaults for WS mode (you can still try later if network allows) ----
const defaultConn = { host: "broker.emqx.io", port: 8084, path: "/mqtt", ssl: true, topic: "devices/esp-shelby-01/telemetry" };

// ---- Connection Panel ----
function ConnectionPanel({ conn, setConn, onConnect, onDisconnect, status, msgs, errorMsg, useSSE, setUseSSE }) {
  return (
    <div style={{padding:12, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', maxWidth:460}}>
      <div style={{fontSize:12, fontWeight:600, marginBottom:6}}>Connection</div>
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
      <label style={{fontSize:12, display:'flex', alignItems:'center', gap:6, marginTop:8}}>
        <input type="checkbox" checked={useSSE} onChange={(e)=>setUseSSE(e.target.checked)} />
        Use backend SSE proxy (recommended on restricted networks)
      </label>
      <div style={{display:'flex', alignItems:'center', gap:8, marginTop:8, fontSize:13}}>
        <button onClick={onConnect} style={{padding:'6px 10px', borderRadius:10, background:'#111', color:'#fff'}}>Connect</button>
        <button onClick={onDisconnect} style={{padding:'6px 10px', borderRadius:10}}>Disconnect</button>
        <span style={{display:'inline-flex', alignItems:'center', gap:8, marginLeft:8}}>
          <span style={{width:10, height:10, borderRadius:'50%', background: status==='connected'?'#22c55e': status==='error'?'#ef4444': status==='reconnecting'?'#f59e0b':'#d1d5db'}}></span>
          <span style={{fontSize:12, color:'#6b7280'}}>{status || "idle"} {useSSE ? "(SSE)" : "(WS)"}</span>
        </span>
        <span style={{marginLeft:'auto', fontSize:12, color:'#6b7280'}}>Msgs: {msgs}</span>
      </div>
      {errorMsg && (
        <div style={{marginTop:8, fontSize:12, color: status==='error' ? '#b91c1c' : '#334155', whiteSpace:'pre-wrap'}}>{errorMsg}</div>
      )}
    </div>
  );
}

// ---- WS (browser) connector - still available for later ----
function useMQTT_WS(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastPayload, setLastPayload] = useState("");
  const clientRef = useRef(null);

  const connect = () => {
    try { clientRef.current?.end(true); } catch {}
    clientRef.current = null;
    setStatus("connecting"); setMsgs(0); setErrorMsg("");

    let path = (conn.path || "/mqtt").trim(); if (!path.startsWith("/")) path = "/" + path;
    const url = `${conn.ssl ? "wss" : "ws"}://${conn.host}:${Number(conn.port) || (conn.ssl?8084:8083)}${path}`;
    setErrorMsg(`Connecting to: ${url}`);

    let c;
    try {
      c = mqtt.connect(url, { protocolVersion: 4, clean: true, keepalive: 30, reconnectPeriod: 2500, clientId: `web-${Math.random().toString(16).slice(2)}` });
    } catch (e) { setStatus("error"); setErrorMsg((m)=>`${m}\nClient create error: ${e?.message||e}`); return; }
    clientRef.current = c;

    c.on("connect", () => {
      setStatus("connected");
      c.subscribe(conn.topic, { qos: 0 }, (err) => { if (err) { setStatus("error"); setErrorMsg((m)=>`${m}\nSubscribe error: ${err?.message||err}`); } });
    });
    c.on("reconnect", () => setStatus("reconnecting"));
    c.on("offline", () => { setStatus("error"); setErrorMsg((m)=>`${m}\nClient offline`); });
    c.on("error", (err) => { setStatus("error"); setErrorMsg((m)=>`${m}\nMQTT error: ${err?.message||err}`); });
    c.on("close", () => { if (status !== "error") setStatus("idle"); });

    c.on("message", (t, payload) => {
      setMsgs(n=>n+1);
      const txt = payload?.toString() || ""; setLastPayload(`${t}: ${txt}`);
      try {
        const js = JSON.parse(txt);
        const lat = Number(js.lat ?? js.latitude ?? js.Latitude ?? js.Lat);
        const lon = Number(js.lon ?? js.lng ?? js.longitude ?? js.Longitude ?? js.Lon);
        const fix = Boolean(js.fix ?? js.gpsFix ?? true);
        const sats = Number(js.sats ?? js.satellites ?? 0);
        onMessage && onMessage({ lat, lon, fix, sats, raw: js });
      } catch {}
    });
  };

  const disconnect = () => { try { clientRef.current?.end(true); } catch {} clientRef.current = null; setStatus("idle"); };
  useEffect(()=>()=>{ try { clientRef.current?.end(true); } catch {} }, []);
  return { status, msgs, errorMsg, lastPayload, connect, disconnect };
}

// ---- SSE connector (via /api/stream) ----
function useMQTT_SSE(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastPayload, setLastPayload] = useState("");
  const esRef = useRef(null);

  const connect = () => {
    try { esRef.current?.close(); } catch {}
    setStatus("connecting"); setMsgs(0); setErrorMsg(""); setLastPayload("");

    // Build SSE URL (device uses TCP 1883/8883; this is server-side)
    const qs = new URLSearchParams({
      host: conn.host,
      port: String(conn.ssl ? 8883 : 1883),
      topic: conn.topic,
      ssl: conn.ssl ? "1" : "0",
      // user: "", pass: "", insecure: "0"
    });
    const url = `/api/stream?${qs.toString()}`;
    setErrorMsg(`Connecting via SSE: ${url}`);

    const es = new EventSource(url);
    esRef.current = es;
    setStatus("connected");

    es.onmessage = (ev) => {
      try {
        const { topic, payload, connecting, connected, subscribed } = JSON.parse(ev.data);
        if (connecting) { setErrorMsg(`Connecting via SSE: ${connecting}`); return; }
        if (connected) { setErrorMsg((m)=> `${m}\nConnected: ${connected}`); return; }
        if (subscribed) { setErrorMsg((m)=> `${m}\nSubscribed: ${subscribed}`); return; }
        if (topic && typeof payload === "string") {
          setMsgs(n=>n+1);
          setLastPayload(`${topic}: ${payload}`);
          try {
            const js = JSON.parse(payload);
            const lat = Number(js.lat ?? js.latitude ?? js.Latitude ?? js.Lat);
            const lon = Number(js.lon ?? js.lng ?? js.longitude ?? js.Longitude ?? js.Lon);
            const fix = Boolean(js.fix ?? js.gpsFix ?? true);
            const sats = Number(js.sats ?? js.satellites ?? 0);
            onMessage && onMessage({ lat, lon, fix, sats, raw: js });
          } catch {}
        }
      } catch { /* ignore */ }
    };
    es.addEventListener("error", (e) => { setStatus("error"); setErrorMsg((m)=>`${m}\nSSE error`); });
    // EventSource auto-reconnects by itself.
  };

  const disconnect = () => { try { esRef.current?.close(); } catch {} setStatus("idle"); };
  useEffect(()=>()=>{ try { esRef.current?.close(); } catch {} }, []);
  return { status, msgs, errorMsg, lastPayload, connect, disconnect };
}

function Recenter({ lat, lon }) { const map = useMap(); useEffect(()=>{ if(Number.isFinite(lat)&&Number.isFinite(lon)) map.setView([lat,lon]); },[lat,lon,map]); return null; }

export default function App() {
  const initialTab = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'k9') ? 'k9' : 'live';
  const [tab, setTab] = useState(initialTab);
  const [panelOpen, setPanelOpen] = useState(true);
  const [useSSE, setUseSSE] = useState(true); // <-- default to SSE for your network
  const [conn, setConn] = useState(defaultConn);
  const [last, setLast] = useState(null);
  const [points, setPoints] = useState([]);
  const [tracking, setTracking] = useState(false);
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [autoBreadcrumbFixOnly, setAutoBreadcrumbFixOnly] = useState(true);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);
  const [summary, setSummary] = useState(null);

  const onMsg = (msg) => {
    if (Number.isFinite(msg.lat) && Number.isFinite(msg.lon)) {
      setLast(msg);
      if (tab === "k9" && tracking && (!autoBreadcrumbFixOnly || msg.fix)) {
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
  };

  const ws = useMQTT_WS(conn, onMsg);
  const sse = useMQTT_SSE(conn, onMsg);
  const status = useSSE ? sse.status : ws.status;
  const msgs   = useSSE ? sse.msgs   : ws.msgs;
  const errorMsg = useSSE ? sse.errorMsg : ws.errorMsg;
  const lastPayload = useSSE ? sse.lastPayload : ws.lastPayload;
  const connect = () => (useSSE ? sse.connect() : ws.connect());
  const disconnect = () => (useSSE ? sse.disconnect() : ws.disconnect());

  useInterval(() => { if (tracking && startAt) setElapsed(Date.now() - startAt); }, 1000);

  const startTrack = () => { setPoints([]); setDistance(0); setStartAt(Date.now()); setElapsed(0); setTracking(true); };
  const stopTrack = async () => {
    setTracking(false);
    const durMs = startAt ? Date.now() - startAt : 0;
    const dist = distance;
    const centerPoint = points.length ? points[Math.floor(points.length / 2)] : last;
    let weather = null, elevationStats = null;
    try {
      if (centerPoint && Number.isFinite(centerPoint.lat) && Number.isFinite(centerPoint.lon)) {
        const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${centerPoint.lat}&longitude=${centerPoint.lon}&current_weather=true`).then(r=>r.json());
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
          let gain=0, loss=0; for (let i=1;i<els.length;i++) { const d=els[i]-els[i-1]; if (d>0) gain+=d; else loss+=Math.abs(d); }
          elevationStats = { gain, loss };
        }
      }
    } catch {}
    setSummary({ distance: dist, durationMs: durMs, weather, elevation: elevationStats, points });
  };

  const center = useMemo(() => (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) ? [last.lat, last.lon] : [30, -97], [last]);

  return (
    <div style={{height:'100%', width:'100%', background:'#f8fafc'}}>
      <div style={{padding:12, display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #e5e7eb', background:'#fff', position:'sticky', top:0, zIndex:20}}>
        <div style={{fontSize:18, fontWeight:600}}>K9 Live Tracker</div>
        <div style={{marginLeft:16, display:'flex', gap:6, background:'#f1f5f9', borderRadius:14, padding:6}}>
          <button onClick={()=>setTab("live")} style={{padding:'6px 10px', borderRadius:10, background: tab==='live'?'#fff':'transparent', boxShadow: tab==='live'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>Live Map</button>
          <button onClick={()=>setTab("k9")} style={{padding:'6px 10px', borderRadius:10, background: tab==='k9'?'#fff':'transparent', boxShadow: tab==='k9'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>K9 Track</button>
        </div>
      </div>

      <button onClick={()=>setPanelOpen(o=>!o)} style={{ position:'fixed', top:16, right:16, zIndex:1001, padding:'8px 12px', borderRadius:10, background:'#111', color:'#fff', border:'none', boxShadow:'0 4px 16px rgba(0,0,0,.12)' }}>
        {panelOpen ? 'Hide' : 'Connect'}
      </button>

      {panelOpen && createPortal(
        <div id="conn-panel" style={{ position: 'fixed', top: 16, left: 16, zIndex: 2147483647 }}>
          <ConnectionPanel
            conn={conn}
            setConn={setConn}
            onConnect={connect}
            onDisconnect={disconnect}
            status={status}
            msgs={msgs}
            errorMsg={errorMsg}
            useSSE={useSSE}
            setUseSSE={setUseSSE}
          />

          {lastPayload && (
            <div style={{marginTop:8, padding:8, background:'rgba(255,255,255,0.95)', border:'1px dashed #94a3b8', borderRadius:12, fontSize:12, maxWidth:460, wordBreak:'break-word'}}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Last payload</div>
              {lastPayload}
            </div>
          )}

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
            </div>
          )}
        </div>,
        document.body
      )}

      <div style={{height:'100%'}}>
        <MapContainer center={useMemo(()=> (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) ? [last.lat, last.lon] : [30,-97], [last])} zoom={13} style={{height:'100%', width:'100%'}}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && <Recenter lat={last.lat} lon={last.lon} />}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />}
          {(tab === 'k9' ? points : []).length > 0 && <Polyline positions={points.map(p=>[p.lat, p.lon])} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />}
        </MapContainer>
      </div>
    </div>
  );
}
