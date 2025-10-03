import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import * as htmlToImage from "html-to-image";
import ReportForm from "./components/ReportForm";
import { supabase } from "./lib/supabaseClient";
import LoginCard from "./components/LoginCard";


/* ======================
   Utilities
====================== */
const haversine = (a, b) => {
  if (!a || !b) return 0;
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return 0;
  const R = 6371000; // m
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
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
const paceFrom = (m, ms) => {
  if (!m || !ms) return null;
  const min = (ms / 1000) / 60;
  const km = m / 1000;
  const pace = min / (km || 1);
  const mm = Math.floor(pace);
  const ss = Math.round((pace - mm) * 60);
  return `${mm}:${ss.toString().padStart(2, "0")} min/km`;
};
const avgSpeedFrom = (m, ms) => {
  if (!m || !ms) return null;
  const hours = (ms / 1000) / 3600;
  const kmh = (m / 1000) / (hours || 1);
  return `${kmh.toFixed(2)} km/h`;
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

/* ======================
   Config / Defaults
====================== */
const DEVICE_ID = "esp-shelby-01"; // use your actual device id
const defaultConn = {
  host: "broker.emqx.io",
  port: 1883,     // SSE bridges to TCP; ssl=1 uses 8883
  ssl: 0,
  topic: `devices/${DEVICE_ID}/#`, // wildcard to receive telemetry + control
};

/* ======================
   SSE Bridge (to /api/stream)
====================== */
function useSSE(conn, onMessage, onDiag) {
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
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

    const u = new URL("/api/stream", window.location.origin);
    u.searchParams.set("host", (conn.host || "").trim());
    if (conn.port) u.searchParams.set("port", String(conn.port));
    u.searchParams.set("topic", (conn.topic || "").trim() || "#");
    u.searchParams.set("ssl", conn.ssl ? "1" : "0");

    const es = new EventSource(u.toString());
    esRef.current = es;

    es.onopen = () => setStatus("connected");
    es.onerror = () => { setStatus("error"); setErrorMsg("SSE error"); };

    const handle = (ev) => {
      try {
        const data = JSON.parse(ev.data || "{}");
        // diag events: {connecting, connected, subscribed, error, info}
        if (ev.type === "message") {
          if (data.payload != null) {
            setMsgs((n) => n + 1);
            setLastPayload(`${data.topic}: ${data.payload}`);
            onMessage && onMessage(data.topic, data.payload);
          } else {
            onDiag && onDiag(data);
          }
        } else {
          onDiag && onDiag(data);
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    es.addEventListener("message", handle);
    es.addEventListener("diag", handle);
  };

  const disconnect = () => {
    try { esRef.current?.close(); } catch {}
    esRef.current = null;
    setStatus("idle"); setErrorMsg("");
  };

  useEffect(() => () => { try { esRef.current?.close(); } catch {} }, []);

  return { status, msgs, errorMsg, lastPayload, connect, disconnect };
}

/* ======================
   Map helpers
====================== */
function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

/* ======================
   UI: Connection Panel
====================== */
function ConnectionPanel({ conn, setConn, onConnect, onDisconnect, status, msgs, errorMsg, lastPayload }) {
  return (
    <div style={{padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', width:360}}>
      <div style={{fontSize:12, fontWeight:700, marginBottom:8}}>MQTT (via SSE bridge)</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
        <label style={{fontSize:12}}>Host
          <input style={{width:'100%'}} value={conn.host} onChange={(e)=>setConn({...conn, host:e.target.value})}/>
        </label>
        <label style={{fontSize:12}}>Port
          <input style={{width:'100%'}} value={conn.port} onChange={(e)=>setConn({...conn, port:Number(e.target.value)||0})}/>
        </label>
        <label style={{fontSize:12}}>SSL
          <select style={{width:'100%'}} value={conn.ssl} onChange={(e)=>setConn({...conn, ssl:Number(e.target.value)||0})}>
            <option value={0}>No (1883)</option>
            <option value={1}>Yes (8883)</option>
          </select>
        </label>
        <div />
      </div>
      <label style={{fontSize:12, display:'block', marginTop:8}}>Topic
        <input style={{width:'100%'}} value={conn.topic} onChange={(e)=>setConn({...conn, topic:e.target.value})}/>
      </label>

      <div style={{display:'flex', alignItems:'center', gap:8, marginTop:10, fontSize:13}}>
        <button onClick={onConnect} style={{padding:'6px 10px', borderRadius:10, background:'#111', color:'#fff'}}>Connect</button>
        <button onClick={onDisconnect} style={{padding:'6px 10px', borderRadius:10}}>Disconnect</button>
        <span style={{display:'inline-flex', alignItems:'center', gap:8, marginLeft:8}}>
          <span style={{width:10, height:10, borderRadius:'50%', background: status==='connected'?'#22c55e': status==='error'?'#ef4444': status==='connecting'?'#f59e0b':'#d1d5db'}}></span>
          <span style={{fontSize:12, color:'#6b7280'}}>{status || "idle"}</span>
        </span>
        <span style={{marginLeft:'auto', fontSize:12, color:'#6b7280'}}>Msgs: {msgs}</span>
      </div>

      {status === 'error' && errorMsg && (
        <div style={{marginTop:8, fontSize:12, color:'#b91c1c', whiteSpace:'pre-wrap'}}>{errorMsg}</div>
      )}

      {lastPayload && (
        <div style={{marginTop:8, padding:8, background:'rgba(255,255,255,0.95)', border:'1px dashed #94a3b8', borderRadius:12, fontSize:12, wordBreak:'break-word'}}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Last payload</div>
          {lastPayload}
        </div>
      )}
    </div>
  );
}

/* ======================
   App
====================== */
export default function App() {
  const urlq = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const viewerMode = urlq.get("viewer") === "1";
  const initialTab = viewerMode ? "live" : (urlq.get("view") === "k9" ? "k9" : "live");

  const [tab, setTab] = useState(initialTab);       // 'live' | 'k9'
  const [panelOpen, setPanelOpen] = useState(true);
  const [conn, setConn] = useState(defaultConn);

  // Live position + breadcrumbs
  const [last, setLast] = useState(null);           // {lat, lon, fix, sats, raw}
  const [points, setPoints] = useState([]);         // [{lat,lon,ts}, ...]
  const [tracking, setTracking] = useState(false);  // operator local tracking
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [autoBreadcrumbFixOnly, setAutoBreadcrumbFixOnly] = useState(true);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);

  // Viewer-only: follow "start/stop" control to show/hide breadcrumbs
  const [viewerTrackActive, setViewerTrackActive] = useState(false);

  // Start/Finish summary
  const [trackId, setTrackId] = useState(null);
  const [summary, setSummary] = useState(null); // { distance, durationMs, weather, elevation, points, report_no, snapshotUrl }

  // Auth state (operator)
  const [user, setUser] = useState(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);

  async function authFetch(url, options = {}) {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    return fetch(url, {
      ...options,
      headers: { ...(options.headers||{}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
  }

  // SSE
  const { status, msgs, errorMsg, lastPayload, connect, disconnect } = useSSE(
    conn,
    (topic, payloadTxt) => {
      // parse telemetry & control
      let js = null;
      try { js = JSON.parse(payloadTxt); } catch {}
      if (!js) return;

      const isTelemetry = /\/telemetry$/.test(topic);
      const isControl   = /\/control$/.test(topic);

      if (isTelemetry) {
        const lat = Number(js.lat ?? js.latitude ?? js.Latitude ?? js.Lat);
        const lon = Number(js.lon ?? js.lng ?? js.longitude ?? js.Longitude ?? js.Lon);
        const fix = Boolean(js.fix ?? js.gpsFix ?? true);
        const sats = Number(js.sats ?? js.satellites ?? 0);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setLast({ lat, lon, fix, sats, raw: js });

          // Operator mode: breadcrumb while tracking
          if (!viewerMode && tracking) {
            if (!autoBreadcrumbFixOnly || fix) {
              setPoints((prev) => {
                const next = [...prev, { lat, lon, ts: Date.now() }];
                if (prev.length > 0) {
                  const seg = haversine(prev[prev.length - 1], next[next.length - 1]);
                  setDistance((d) => d + seg);
                }
                return next;
              });
            }
          }

          // Viewer mode: breadcrumb only if control event says active
          if (viewerMode && viewerTrackActive) {
            setPoints((prev) => {
              const next = [...prev, { lat, lon, ts: Date.now() }];
              if (prev.length > 0) {
                const seg = haversine(prev[prev.length - 1], next[next.length - 1]);
                // distance is not shown in viewer, but keep for completeness
                setDistance((d) => d + seg);
              }
              return next;
            });
          }
        }
      } else if (isControl) {
        // Expect messages like {"event":"start"} or {"event":"stop"}
        const ev = (js.event || "").toLowerCase();
        if (viewerMode) {
          if (ev === "start") {
            setViewerTrackActive(true);
            setPoints([]); setDistance(0); setElapsed(0);
          } else if (ev === "stop") {
            setViewerTrackActive(false);
            setPoints([]); setDistance(0); setElapsed(0);
          }
        }
      }
    },
    (_diag) => {} // optional diag log
  );

  // Timer for elapsed
  useInterval(() => {
    if (!viewerMode && tracking && startAt) setElapsed(Date.now() - startAt);
    if (viewerMode && viewerTrackActive && startAt) setElapsed(Date.now() - startAt);
  }, 1000);

  // Start / Stop (operator)
  const startTrack = async () => {
    if (!user) { alert("Sign in to start a track."); return; }
    try {
      const body = { device_id: DEVICE_ID, topic: conn.topic, is_public: true };
      const r = await authFetch("/api/tracks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r=>r.json());
      if (!r.ok) throw new Error(r.error || "create failed");
      setTrackId(r.id);
      setSummary(null);
      setPoints([]); setDistance(0);
      setStartAt(Date.now()); setElapsed(0);
      setTracking(true);
      // (Optional) publish a control "start" from device or a separate tool, not from frontend
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  async function captureSnapshot() {
    // Capture the map + overlay stats as a single PNG
    const node = document.getElementById("map-capture-root");
    if (!node) return null;
    try {
      const dataUrl = await htmlToImage.toPng(node, { cacheBust: true, pixelRatio: 2 });
      return dataUrl;
    } catch {
      return null;
    }
  }

  const stopTrack = async () => {
    if (!user) { alert("Sign in to stop a track."); return; }
    try {
      setTracking(false);
      const durMs = startAt ? Date.now() - startAt : 0;
      const dist = distance;

      // Weather near midpoint
      const center = points.length ? points[Math.floor(points.length/2)] : last;
      let weather=null, elevationStats=null;
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

      const pace = paceFrom(dist, durMs);
      const avg = avgSpeedFrom(dist, durMs);

      // Snapshot
      const snapshotDataUrl = await captureSnapshot();

      // Finish (and upload snapshot)
      const body = {
        id: trackId,
        device_id: DEVICE_ID,
        distance_m: dist,
        duration_ms: durMs,
        pace_min_per_km: pace,
        avg_speed_kmh: avg,
        weather,
        elevation: elevationStats,
        points,
        snapshotDataUrl
      };
      const resp = await authFetch("/api/tracks/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r=>r.json());
      if (!resp.ok) throw new Error(resp.error || "finish failed");

      setSummary({
        distance: dist,
        durationMs: durMs,
        weather,
        elevation: elevationStats,
        points,
        snapshotUrl: resp.snapshot_url || null,
        report_no: resp.report_no || null, // if your finish returns it; otherwise set on create
        paceMinPerKm: pace,
        avgSpeedKmh: avg,
      });

      // reset runtime-only
      setStartAt(null);
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  const clearTrack = () => {
    setTracking(false);
    setPoints([]); setDistance(0); setElapsed(0); setStartAt(null);
    setSummary(null);
  };

  const center = useMemo(() => {
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
    return [30, -97];
  }, [last]);

  /* ======================
     Layout
  ====================== */
  return (
    <div style={{height:'100vh', width:'100vw', display:'flex', background:'#f8fafc'}}>
      {/* Left Sidebar */}
      <div style={{width: 380, minWidth: 380, borderRight:'1px solid #e5e7eb', background:'#ffffff', display:'flex', flexDirection:'column'}}>
        <div style={{padding:12, display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #e5e7eb'}}>
          <div style={{fontSize:18, fontWeight:700}}>K9 Live Tracker</div>
          <div style={{marginLeft:'auto', display:'flex', gap:6, background:'#f1f5f9', borderRadius:14, padding:6}}>
            <button onClick={()=>setTab("live")} style={{padding:'6px 10px', borderRadius:10, background: tab==='live'?'#fff':'transparent', boxShadow: tab==='live'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>Live Map</button>
            {!viewerMode && (
              <button onClick={()=>setTab("k9")} style={{padding:'6px 10px', borderRadius:10, background: tab==='k9'?'#fff':'transparent', boxShadow: tab==='k9'?'0 2px 8px rgba(0,0,0,.06)':'none'}}>K9 Track</button>
            )}
          </div>
        </div>

        <div style={{padding:12, overflow:'auto'}}>
          <ConnectionPanel
            conn={conn} setConn={setConn}
            onConnect={connect} onDisconnect={disconnect}
            status={status} msgs={msgs}
            errorMsg={errorMsg} lastPayload={lastPayload}
          />

          {last && (
            <div style={{marginTop:8, padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', fontSize:12}}>
              <div style={{fontWeight:700}}>Last fix</div>
              <div>lat: {Number.isFinite(last.lat)? last.lat.toFixed(6): '—'} lon: {Number.isFinite(last.lon)? last.lon.toFixed(6): '—'}</div>
              <div>fix: {String(last.fix)} sats: {Number.isFinite(last.sats)? last.sats: '—'}</div>
              <label style={{display:'flex', alignItems:'center', gap:6, marginTop:6}}>
                <input type="checkbox" checked={recenterOnUpdate} onChange={(e)=>setRecenterOnUpdate(e.target.checked)} /> Recenter on update
              </label>
            </div>
          )}

          {/* K9 Controls (operator only) */}
          {!viewerMode && (
            <div style={{marginTop:8, padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:16, boxShadow:'0 4px 16px rgba(0,0,0,.08)', fontSize:12}}>
              <div style={{fontWeight:700, marginBottom:6}}>K9 Track Controls</div>
              {!user && <div style={{marginBottom:8, color:'#b91c1c'}}>Sign in to start/stop.</div>}
              <div style={{display:'flex', gap:8, marginBottom:8}}>
                {!tracking ? (
                  <button onClick={startTrack} disabled={!user} style={{padding:'6px 10px', borderRadius:10, background:'#16a34a', color:'#fff'}}>Start</button>
                ) : (
                  <button onClick={stopTrack} disabled={!user} style={{padding:'6px 10px', borderRadius:10, background:'#dc2626', color:'#fff'}}>Stop</button>
                )}
                <button onClick={clearTrack} style={{padding:'6px 10px', borderRadius:10}}>Clear</button>
              </div>
              <div>Time: {prettyDuration(elapsed)}</div>
              <div>Distance: {prettyDistance(distance)}</div>
              <label style={{display:'flex', alignItems:'center', gap:6}}><input type="checkbox" checked={autoBreadcrumbFixOnly} onChange={(e)=>setAutoBreadcrumbFixOnly(e.target.checked)} /> Only add crumbs when fix=true</label>
              {summary && (
                <div style={{marginTop:8, padding:8, background:'#f1f5f9', borderRadius:8}}>
                  <div style={{fontWeight:700, marginBottom:4}}>Summary</div>
                  {summary.report_no && <div><b>Report #:</b> {summary.report_no}</div>}
                  <div><b>Distance:</b> {prettyDistance(summary.distance)}</div>
                  <div><b>Duration:</b> {prettyDuration(summary.durationMs)}</div>
                  <div><b>Pace:</b> {summary.paceMinPerKm || '—'}</div>
                  <div><b>Avg Speed:</b> {summary.avgSpeedKmh || '—'}</div>
                  <div><b>Weather:</b> {summary.weather ? `${summary.weather.temperature}°C, wind ${summary.weather.windspeed} km/h` : '—'}</div>
                  <div><b>Elevation:</b> {summary.elevation ? `gain ${Math.round(summary.elevation.gain)} m, loss ${Math.round(summary.elevation.loss)} m` : '—'}</div>
                </div>
              )}
            </div>
          )}

          {/* Report form (operator only) */}
          {!viewerMode && (
            <div style={{marginTop:8}}>
              <ReportForm
                defaultTrackId={trackId}
                report_no={summary?.report_no}
                snapshotUrl={summary?.snapshotUrl}
                distance_m={summary?.distance ?? distance}
                duration_ms={summary?.durationMs ?? elapsed}
                pace_min_per_km={summary?.paceMinPerKm}
                avg_speed_kmh={summary?.avgSpeedKmh}
                weather={summary?.weather}
                device_id={DEVICE_ID}
              />
            </div>
          )}

          {/* Viewer hint */}
          {viewerMode && (
            <div style={{marginTop:8, padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:16, fontSize:12}}>
              <div style={{fontWeight:700, marginBottom:6}}>Viewer Mode</div>
              <div>Breadcrumbs will appear only while a control message with <code>{"{event:\"start\"}"}</code> is published to <code>{`devices/${DEVICE_ID}/control`}</code>, and will clear on <code>{"{event:\"stop\"}"}</code>. Otherwise, only the live position is shown.</div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Map (capture root wraps map + stats overlay for snapshots) */}
      <div id="map-capture-root" style={{flex:1, position:'relative'}}>
        {/* Stats overlay for snapshot */}
        {(tracking || summary) && (
          <div style={{position:'absolute', top:12, right:12, zIndex:500, background:'rgba(255,255,255,0.95)', border:'1px solid #e5e7eb', borderRadius:12, padding:10, fontSize:12, boxShadow:'0 4px 16px rgba(0,0,0,.08)'}}>
            <div style={{fontWeight:700, marginBottom:6}}>K9 Track</div>
            <div><b>Status:</b> {tracking ? "Active" : "Stopped"}</div>
            <div><b>Distance:</b> {prettyDistance(tracking ? distance : (summary?.distance ?? 0))}</div>
            <div><b>Duration:</b> {prettyDuration(tracking ? elapsed : (summary?.durationMs ?? 0))}</div>
            <div><b>Pace:</b> {tracking ? (paceFrom(distance, elapsed) || "—") : (summary?.paceMinPerKm || "—")}</div>
            <div><b>Avg Speed:</b> {tracking ? (avgSpeedFrom(distance, elapsed) || "—") : (summary?.avgSpeedKmh || "—")}</div>
            {(summary?.weather) && <div><b>Weather:</b> {summary.weather.temperature}°C, wind {summary.weather.windspeed} km/h</div>}
            {summary?.report_no && <div><b>Report #:</b> {summary.report_no}</div>}
          </div>
        )}

        <MapContainer center={center} zoom={13} style={{height:'100%', width:'100%'}}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <Recenter lat={last.lat} lon={last.lon} />
          )}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
          )}
          {/* Draw polyline:
              - Operator: only when on K9 tab and tracking or after stop (show the recorded path)
              - Viewer: only while viewerTrackActive (control start), else no crumbs */}
          {(() => {
            const showCrumbs =
              (!viewerMode && (tab === "k9") && (tracking || (summary?.points?.length > 0))) ||
              (viewerMode && viewerTrackActive);
            const line = !viewerMode
              ? (tracking ? points : (summary?.points || []))
              : points;
            return showCrumbs && line.length > 0
              ? <Polyline positions={line.map(p=>[p.lat, p.lon])} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />
              : null;
          })()}
        </MapContainer>
      </div>

      {/* Floating panel toggle for small screens */}
      {!panelOpen && createPortal(
        <button
          onClick={() => setPanelOpen(true)}
          style={{ position:'fixed', top:16, left:16, zIndex:1001, padding:'8px 12px', borderRadius:10, background:'#111', color:'#fff', border:'none', boxShadow:'0 4px 16px rgba(0,0,0,.12)'}}
        >Connect</button>,
        document.body
      )}
    </div>
  );
}
