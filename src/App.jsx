// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import * as htmlToImage from "html-to-image";
import "leaflet/dist/leaflet.css";

// ↓ PDF + Report bits
import { PDFDownloadLink, pdf } from "@react-pdf/renderer";
import ReportPDF from "./components/ReportPDF";
import ReportForm from "./components/ReportForm";
import { supabase } from "./lib/supabaseClient"; // (not strictly required here, but okay to keep)

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
const prettyDistance = (m) => (!Number.isFinite(m) ? "—" : m < 1000 ? `${m.toFixed(1)} m` : `${(m/1000).toFixed(2)} km`);
const prettyDuration = (ms) => {
  if (!Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => n.toString().padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
};
function useInterval(cb, delay) {
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; }, [cb]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => ref.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// ---- Metrics helper
function computeMetrics(distanceM, durationMs) {
  const km = distanceM > 0 ? distanceM / 1000 : 0;
  const hours = durationMs > 0 ? durationMs / 3600000 : 0;
  const avg_speed_kmh = km > 0 && hours > 0 ? km / hours : 0;
  const pace_min_per_km = km > 0 ? (durationMs / 60000) / km : 0;
  const paceMin = Math.floor(pace_min_per_km || 0);
  const paceSec = Math.round(((pace_min_per_km || 0) - paceMin) * 60);
  const pace_label = km > 0 ? `${paceMin}:${String(paceSec).padStart(2, "0")} /km` : "—";
  const avg_speed_label = `${avg_speed_kmh.toFixed(2)} km/h`;
  return { km, avg_speed_kmh, pace_min_per_km, pace_label, avg_speed_label };
}

// ---- SSE connection to /api/stream (backend bridges MQTT→SSE)
const defaultConn = {
  host: "broker.emqx.io",
  port: 8883,
  topic: "devices/esp-shelby-01/telemetry",
  ssl: true,
};
function useSSE(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const esRef = useRef(null);

  const connect = () => {
    try { esRef.current?.close(); } catch {}
    esRef.current = null;
    setStatus("connecting");
    setMsgs(0);
    setErrorMsg("");

    const p = new URLSearchParams({
      host: conn.host || "",
      port: String(conn.port || (conn.ssl ? 8883 : 1883)),
      topic: conn.topic || "devices/#",
      ssl: conn.ssl ? "1" : "0",
      keepalive: "30",
    });
    const url = `/api/stream?${p.toString()}`;
    setErrorMsg(`Connecting via SSE: ${url}`);

    let es;
    try { es = new EventSource(url); }
    catch (e) {
      setStatus("error");
      setErrorMsg(`SSE create error: ${e?.message || String(e)}`);
      return;
    }
    esRef.current = es;

    es.addEventListener("open", () => setStatus("connected"));
    es.addEventListener("message", (ev) => {
      try {
        const js = JSON.parse(ev.data || "{}");
        if (js.payload) {
          setMsgs((n) => n + 1);
          const txt = js.payload;
          try {
            const m = JSON.parse(txt);
            const lat = Number(m.lat ?? m.latitude ?? m.Latitude ?? m.Lat);
            const lon = Number(m.lon ?? m.lng ?? m.longitude ?? m.Longitude ?? m.Lon);
            const fix = Boolean(m.fix ?? m.gpsFix ?? true);
            const sats = Number(m.sats ?? m.satellites ?? 0);
            onMessage && onMessage({ lat, lon, fix, sats, raw: m });
          } catch {}
        }
      } catch {}
    });
    es.addEventListener("diag", (ev) => {
      try {
        const js = JSON.parse(ev.data || "{}");
        if (js.error) {
          setStatus("error");
          setErrorMsg((m) => `${m}\n${js.error}`);
        }
      } catch {}
    });
    es.addEventListener("error", () => {
      setStatus("error");
      setErrorMsg((m) => `${m}\nSSE error`);
    });
  };

  const disconnect = () => {
    try { esRef.current?.close(); } catch {}
    esRef.current = null;
    setStatus("idle");
  };

  useEffect(() => () => { try { esRef.current?.close(); } catch {} }, []);
  return { status, msgs, errorMsg, connect, disconnect };
}

function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

// ---- Build ReportPDF props
function buildPdfProps(summary, extras = {}) {
  const {
    distance = 0,
    durationMs = 0,
    pace_label = "—",
    avg_speed_label = "—",
    weather = null,
  } = summary || {};

  // ✅ Prefer public Storage URL, fallback to data URL from html-to-image
  const snapshotUrl =
    (summary && (summary.snapshotUrl || summary.snapshotDataUrl)) || "";

  return {
    departmentName: "Test PD",
    logoUrl: "https://flagcdn.com/w320/us.png",
    reportNo: extras.report_no || "",
    createdAt: new Date().toISOString(),
    handler: extras.handler || "Shelby",
    dog: extras.dog || "Rogue",
    email: extras.email || "TestPD@TestCity.Gov",
    deviceId: extras.device_id || "esp-shelby-01",
    trackId: extras.track_id || "",
    distance_m: distance || 0,
    duration_ms: durationMs || 0,
    pace_label,
    avg_speed_label,
    weather,
    snapshotUrl, // <-- important
    notes: extras.notes || "",
  };
}

export default function App() {
  const isViewer =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("viewer") === "1";

  const [tab, setTab] = useState("k9");
  const [conn, setConn] = useState(defaultConn);
  const [last, setLast] = useState(null);
  const [points, setPoints] = useState([]);
  const [tracking, setTracking] = useState(false);
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [summary, setSummary] = useState(null);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);

  // report-submit gating for PDF buttons
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [submittedReport, setSubmittedReport] = useState(null);

  // if you’re creating a track row on start, store its id here
  const [trackId, setTrackId] = useState(null);

  const mapShotRef = useRef(null);

  const { status, msgs, errorMsg, connect, disconnect } = useSSE(conn, (msg) => {
    if (Number.isFinite(msg.lat) && Number.isFinite(msg.lon)) {
      setLast(msg);
      if (tab === "k9" && tracking) {
        setPoints((prev) => {
          const next = [...prev, { lat: msg.lat, lon: msg.lon, ts: Date.now() }];
          if (prev.length > 0) {
            const seg = haversine(prev[prev.length - 1], next[next.length - 1]);
            setDistance((d) => d + seg);
          }
          return next;
        });
      }
    }
  });

  // auto connect SSE
  useEffect(() => { connect(); /* eslint-disable-next-line */ }, []);

  useInterval(() => { if (tracking && startAt) setElapsed(Date.now() - startAt); }, 1000);

  const startTrack = async () => {
    if (isViewer) return; // viewer can't start
    setPoints([]); setDistance(0); setElapsed(0); setStartAt(Date.now());
    setTracking(true); setSummary(null);
    setReportSubmitted(false); setSubmittedReport(null);

    // Optional: create a row and setTrackId(newId) via /api/tracks/create
  };

  const stopTrack = async () => {
    if (isViewer) return;
    setTracking(false);
    const durMs = startAt ? Date.now() - startAt : 0;
    const dist = distance;
    const pts = points.slice();

    const center = pts.length ? pts[Math.floor(pts.length / 2)] : last;

    let weather = null;
    try {
      if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lon}&current_weather=true`
        ).then(r=>r.json());
        weather = w?.current_weather || null;
      }
    } catch {}

    let elevation = null;
    try {
      if (pts.length) {
        const sample = pts.filter((_,i)=> i % Math.max(1, Math.floor(pts.length/100)) === 0);
        const locs = sample.map(p=>`${p.lat},${p.lon}`).join("|");
        const e = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(locs)}`).then(r=>r.json());
        const els = e?.results?.map(r=>r.elevation).filter(Number.isFinite) || [];
        if (els.length) {
          let gain=0, loss=0;
          for (let i=1;i<els.length;i++) { const d=els[i]-els[i-1]; if (d>0) gain+=d; else loss+=Math.abs(d); }
          elevation = { gain, loss };
        }
      }
    } catch {}

    const { avg_speed_kmh, pace_min_per_km, pace_label, avg_speed_label } = computeMetrics(dist, durMs);

    // Snapshot map wrapper
    let snapshotDataUrl = null;
    try {
      if (mapShotRef.current) {
        snapshotDataUrl = await htmlToImage.toPng(mapShotRef.current, { cacheBust: true, pixelRatio: 2 });
      }
    } catch (e) { console.warn("snapshot failed", e); }

    setSummary({
      distance: dist,
      durationMs: durMs,
      pace_min_per_km,
      avg_speed_kmh,
      pace_label,
      avg_speed_label,
      weather,
      elevation,
      points: pts,
      snapshotDataUrl, // may be replaced with server URL
    });

    // finalize on server (store metrics + upload snapshot)
    try {
      if (trackId) {
        const resp = await fetch("/api/tracks/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            track_id: trackId,
            distance_m: dist,
            duration_ms: durMs,
            pace_min_per_km,
            avg_speed_kmh,
            weather,
            elevation,
            points: pts,
            snapshotDataUrl,
          }),
        });
        const js = await resp.json().catch(() => ({}));
        if (resp.ok && js?.snapshot_url) {
          setSummary((s) => ({ ...s, snapshotUrl: js.snapshot_url }));
        }
      }
    } catch (e) { console.warn("finish error:", e); }
  };

  const center = useMemo(() => (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) ? [last.lat, last.lon] : [30,-97], [last]);

  // ---- PDF props & buttons (only after report is submitted)
  const deviceId = "esp-shelby-01";
  const pdfProps = buildPdfProps(summary, {
    report_no: summary?.report_no,
    handler: "Shelby",
    dog: "Rogue",
    email: "TestPD@TestCity.Gov",
    device_id: deviceId,
    track_id: trackId || "",
    notes: submittedReport?.notes || "",
  });

  return (
    <div style={{ height: "100vh", width: "100%", display: "grid", gridTemplateColumns: "360px 1fr", gap: 8, background: "#f8fafc" }}>
      {/* Left panel */}
      <div style={{ padding: 12, overflowY: "auto", borderRight: "1px solid #e5e7eb", background: "#fff" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>K9 Live Tracker</div>

        <div style={{ display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 14, padding: 6, marginBottom: 8 }}>
          <button onClick={()=>setTab("live")} style={{ padding: "6px 10px", borderRadius: 10, background: tab==='live'?'#fff':'transparent', boxShadow: tab==='live'?'0 2px 8px rgba(0,0,0,.06)':'none' }}>Live Map</button>
          <button onClick={()=>setTab("k9")}  style={{ padding: "6px 10px", borderRadius: 10, background: tab==='k9' ?'#fff':'transparent', boxShadow: tab==='k9' ?'0 2px 8px rgba(0,0,0,.06)':'none' }}>K9 Track</button>
        </div>

        {/* Minimal connection panel */}
        <div style={{ padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:12, maxWidth:420 }}>
          <div style={{ fontSize:12, fontWeight:700, marginBottom:8 }}>MQTT (SSE bridge)</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <label style={{ fontSize:12 }}>Host
              <input value={conn.host} onChange={(e)=>setConn({...conn, host:e.target.value})} style={{ width:'100%' }}/>
            </label>
            <label style={{ fontSize:12 }}>Port
              <input value={conn.port} onChange={(e)=>setConn({...conn, port:Number(e.target.value)||0})} style={{ width:'100%' }}/>
            </label>
          </div>
          <label style={{ fontSize:12, display:'block', marginTop:8 }}>Topic
            <input value={conn.topic} onChange={(e)=>setConn({...conn, topic:e.target.value})} style={{ width:'100%' }}/>
          </label>
          <label style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
            <input type="checkbox" checked={conn.ssl} onChange={(e)=>setConn({...conn, ssl:e.target.checked})}/> TLS (8883)
          </label>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8, fontSize:13 }}>
            <button onClick={connect} style={{ padding:'6px 10px', borderRadius:10, background:'#111', color:'#fff' }}>Connect</button>
            <button onClick={disconnect} style={{ padding:'6px 10px', borderRadius:10 }}>Disconnect</button>
            <span style={{ display:'inline-flex', alignItems:'center', gap:8, marginLeft:8 }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background: status==='connected'?'#22c55e': status==='error'?'#ef4444': status==='reconnecting'?'#f59e0b':'#d1d5db' }} />
              <span style={{ fontSize:12, color:'#6b7280' }}>{status || "idle"}</span>
            </span>
            <span style={{ marginLeft:'auto', fontSize:12, color:'#6b7280' }}>Msgs: {msgs}</span>
          </div>
          {status==='error' && errorMsg && <div style={{ marginTop:8, fontSize:12, color:'#b91c1c', whiteSpace:'pre-wrap' }}>{errorMsg}</div>}
        </div>

        {last && (
          <div style={{ marginTop:8, padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:12 }}>
            <div style={{ fontWeight:600, marginBottom:4 }}>Last fix</div>
            <div>lat: {Number.isFinite(last.lat)? last.lat.toFixed(6): '—'} lon: {Number.isFinite(last.lon)? last.lon.toFixed(6): '—'}</div>
            <div>fix: {String(last.fix)} sats: {Number.isFinite(last.sats)? last.sats: '—'}</div>
            <label style={{ display:'flex', alignItems:'center', gap:6 }}>
              <input type="checkbox" checked={recenterOnUpdate} onChange={(e)=>setRecenterOnUpdate(e.target.checked)} /> Recenter on update
            </label>
          </div>
        )}

        {/* Track controls (hidden for viewer) */}
        {tab==='k9' && !isViewer && (
          <div style={{ marginTop:8, padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:12 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>K9 Track Controls</div>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              {!tracking ? (
                <button onClick={startTrack} style={{ padding:'6px 10px', borderRadius:10, background:'#16a34a', color:'#fff' }}>Start</button>
              ) : (
                <button onClick={stopTrack} style={{ padding:'6px 10px', borderRadius:10, background:'#dc2626', color:'#fff' }}>Stop</button>
              )}
              <button onClick={()=>{ setPoints([]); setDistance(0); setElapsed(0); setStartAt(null); setSummary(null); setReportSubmitted(false); setSubmittedReport(null); }} style={{ padding:'6px 10px', borderRadius:10 }}>Clear</button>
            </div>
            <div>Time: {prettyDuration(elapsed)}</div>
            <div>Distance: {prettyDistance(distance)}</div>

            {/* Summary after Stop */}
            {summary && !tracking && (
              <div style={{ marginTop:8, padding:8, background:'#f1f5f9', borderRadius:8 }}>
                <div style={{ fontWeight:600, marginBottom:4 }}>Summary</div>
                <div>Distance: {prettyDistance(summary.distance)}</div>
                <div>Duration: {prettyDuration(summary.durationMs)}</div>
                <div>Pace: {summary.pace_label ?? "—"}</div>
                <div>Avg speed: {summary.avg_speed_label ?? "—"}</div>
                <div>Weather: {summary.weather ? `${summary.weather.temperature}°C, wind ${summary.weather.windspeed} km/h` : '—'}</div>
                <div>Elevation: {summary.elevation ? `gain ${Math.round(summary.elevation.gain)} m, loss ${Math.round(summary.elevation.loss)} m` : '—'}</div>
                {(summary.snapshotUrl || summary.snapshotDataUrl) && (
                  <div style={{ marginTop: 8 }}>
                    <img
                      src={summary.snapshotUrl || summary.snapshotDataUrl}
                      alt="snapshot"
                      style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #e5e7eb" }}
                      onError={(e) => { e.currentTarget.alt = `Failed to load: ${summary.snapshotUrl || summary.snapshotDataUrl}`; }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Report form after stop (operators only) */}
        {!isViewer && tab==='k9' && summary && !tracking && (
          <div style={{ marginTop:8 }}>
            <ReportForm
              defaultTrackId={trackId}
              report_no={summary?.report_no}
              snapshotUrl={summary?.snapshotUrl || summary?.snapshotDataUrl || ""}
              device_id={deviceId}
              onSubmitted={(info) => {
                setReportSubmitted(true);
                setSubmittedReport(info);
              }}
            />
          </div>
        )}

       {/* PDF buttons ONLY after report submitted */}
{!isViewer && reportSubmitted && summary && (
  <div style={{ marginTop:8, padding:12, background:'rgba(255,255,255,0.98)', border:'1px solid #e5e7eb', borderRadius:12 }}>
    <div style={{ fontWeight:600, marginBottom:6 }}>Report PDF</div>
    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
      {/* Keep: Download PDF */}
      <PDFDownloadLink
        document={<ReportPDF {...pdfProps} />}
        fileName={`k9_report_${pdfProps.reportNo || "latest"}.pdf`}
      >
        {({ loading }) => (
          <button style={{ padding:'6px 10px', borderRadius:10, background:'#111', color:'#fff' }}>
            {loading ? "Building…" : "Download PDF"}
          </button>
        )}
      </PDFDownloadLink>

      {/* New: View PDF in a new tab */}
      <button
        onClick={async () => {
          // pre-open to avoid popup blockers
          const w = window.open("", "_blank");
          try {
            const blob = await pdf(<ReportPDF {...pdfProps} />).toBlob();
            const url = URL.createObjectURL(blob);
            if (w) {
              w.location.href = url;
              // clean up after a little delay so the tab can load
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
              // fallback if popup blocked
              window.open(url, "_blank");
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            }
          } catch (e) {
            console.error("PDF view error:", e);
            if (w) w.close();
          }
        }}
        style={{ padding:'6px 10px', borderRadius:10 }}
      >
        View PDF
      </button>
    </div>
  </div>
)}

      {/* Right: Map (this wrapper is snapshot target) */}
      <div ref={mapShotRef} style={{ height: "100vh", width: "100%" }}>
        <MapContainer center={useMemo(() => (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) ? [last.lat,last.lon] : [30,-97], [last])} zoom={13} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && <Recenter lat={last.lat} lon={last.lon} />}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />}
          {(tab === "k9" ? points : []).length > 0 && (
            <Polyline positions={points.map(p=>[p.lat, p.lon])} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}


