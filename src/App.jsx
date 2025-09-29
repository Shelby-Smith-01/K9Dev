// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ===================== Utilities ===================== */

const haversine = (a, b) => {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return 0;
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const pathDistance = (arr) => arr.reduce((sum, p, i) => (i ? sum + haversine(arr[i - 1], p) : 0), 0);

const prettyDistance = (m) => (!Number.isFinite(m) ? "—" : m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`);

const prettyDuration = (ms) => {
  if (!Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n) => n.toString().padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
};

const fmtPace = (minPerKm) =>
  (Number.isFinite(minPerKm) && minPerKm > 0)
    ? `${Math.floor(minPerKm)}:${String(Math.round((minPerKm % 1) * 60)).padStart(2, "0")} /km`
    : "—";

const fmtSpeed = (kmh) => (Number.isFinite(kmh) ? `${kmh.toFixed(2)} km/h` : "—");

function useInterval(cb, delay) {
  const saved = useRef(cb);
  useEffect(() => { saved.current = cb; }, [cb]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => saved.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

function FitTo({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points?.length) {
      const latlngs = points.map((p) => [p.lat, p.lon]);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
    }
  }, [points, map]);
  return null;
}

/* ===================== Defaults ===================== */

const defaultConn = {
  host: "broker.emqx.io",
  port: 1883,                 // SSE backend connects TCP MQTT
  path: "/mqtt",              // (kept for UI only)
  ssl: false,                 // 8883 for true, 1883 for false
  topic: "devices/esp-shelby-01/telemetry",
  useSSE: true,               // required in this build
};

/* ===================== Connection Panel ===================== */

function ConnectionPanel({ conn, setConn, onConnect, onDisconnect, status, msgs, errorMsg, lastPayload, crumbCount }) {
  return (
    <div style={{ padding: 12, background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.08)", maxWidth: 480 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        MQTT via SSE backend (proxy)
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 12 }}>Host
          <input style={{ width: "100%" }} value={conn.host} onChange={(e) => setConn({ ...conn, host: e.target.value })} />
        </label>
        <label style={{ fontSize: 12 }}>Port
          <input style={{ width: "100%" }} value={conn.port} onChange={(e) => setConn({ ...conn, port: Number(e.target.value) })} />
        </label>
        <label style={{ fontSize: 12 }}>Path
          <input style={{ width: "100%" }} value={conn.path} onChange={(e) => setConn({ ...conn, path: e.target.value })} />
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>SSL
          <input type="checkbox" checked={conn.ssl} onChange={(e) => setConn({ ...conn, ssl: e.target.checked })} />
        </label>
      </div>

      <label style={{ fontSize: 12, display: "block", marginTop: 8 }}>Topic
        <input style={{ width: "100%" }} value={conn.topic} onChange={(e) => setConn({ ...conn, topic: e.target.value })} />
      </label>

      <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <input type="checkbox" checked={conn.useSSE} onChange={(e) => setConn({ ...conn, useSSE: e.target.checked })} />
        Use backend SSE proxy (required)
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
        <button onClick={onConnect} style={{ padding: "6px 10px", borderRadius: 10, background: "#111", color: "#fff" }}>Connect</button>
        <button onClick={onDisconnect} style={{ padding: "6px 10px", borderRadius: 10 }}>Disconnect</button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: status === "connected" ? "#22c55e" : status === "error" ? "#ef4444" : status === "reconnecting" ? "#f59e0b" : "#d1d5db" }}></span>
          <span style={{ fontSize: 12, color: "#6b7280" }}>{status || "idle"}</span>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>Msgs: {msgs}</span>
      </div>

      {status === "error" && errorMsg && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", whiteSpace: "pre-wrap" }}>{errorMsg}</div>
      )}

      {typeof crumbCount === "number" && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>Crumbs this session: {crumbCount}</div>
      )}

      {lastPayload && (
        <div style={{ marginTop: 8, padding: 8, background: "rgba(255,255,255,0.95)", border: "1px dashed #94a3b8", borderRadius: 12, fontSize: 12, maxWidth: 460, wordBreak: "break-word" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Last payload</div>
          {lastPayload}
        </div>
      )}
    </div>
  );
}

/* ===================== MQTT via SSE Hook ===================== */

function useMQTT_SSE(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastPayload, setLastPayload] = useState("");
  const esRef = useRef(null);

  const connect = () => {
    if (!conn.useSSE) {
      setStatus("error");
      setErrorMsg("This build uses the backend SSE proxy only. Enable 'Use backend SSE proxy'.");
      return;
    }
    try { esRef.current && esRef.current.close(); } catch {}
    esRef.current = null; setMsgs(0); setErrorMsg(""); setStatus("connecting");

    const host = (conn.host || "").trim();
    const port = Number(conn.port) || (conn.ssl ? 8883 : 1883);
    const topic = encodeURIComponent(conn.topic || "devices/%23");
    const ssl = conn.ssl ? 1 : 0;

    const url = `/api/stream?host=${host}&port=${port}&topic=${topic}&ssl=${ssl}`;
    setErrorMsg(`Connecting via SSE: ${url}`);

    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data || "{}");
        if (d.error) { setStatus("error"); setErrorMsg((m) => `${m}\nAPI error: ${d.error}`); return; }
        if (d.connected) { setStatus("connected"); return; }
        if (d.subscribed) { return; }
        if (d.topic && typeof d.payload === "string") {
          setMsgs((n) => n + 1);
          setLastPayload(`${d.topic}: ${d.payload}`);
          try {
            const js = JSON.parse(d.payload);
            const lat = Number(js.lat ?? js.latitude ?? js.Latitude ?? js.Lat);
            const lon = Number(js.lon ?? js.lng ?? js.longitude ?? js.Longitude ?? js.Lon);
            const fix = Boolean(js.fix ?? js.gpsFix ?? true);
            const sats = Number(js.sats ?? js.satellites ?? 0);
            onMessage && onMessage({ lat, lon, fix, sats, raw: js });
          } catch {}
        }
      } catch {}
    };

    es.addEventListener("diag", (ev) => {
      if (ev?.data) setErrorMsg((m) => `${m}\n${ev.data}`);
    });

    es.onerror = () => {
      setStatus("error");
      setErrorMsg((m) => `${m}\nSSE network error (connection closed)`);
      try { es.close(); } catch {}
    };
  };

  const disconnect = () => {
    try { esRef.current && esRef.current.close(); } catch {}
    esRef.current = null; setStatus("idle");
  };

  useEffect(() => () => { try { esRef.current && esRef.current.close(); } catch {} }, []);
  return { status, msgs, errorMsg, lastPayload, connect, disconnect };
}

/* ===================== Main App ===================== */

function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => { if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon]); }, [lat, lon, map]);
  return null;
}

export default function App() {
  const initialTab = (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "k9") ? "k9" : "live";
  const [tab, setTab] = useState(initialTab);
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
  const [summary, setSummary] = useState(null);

  // persistence state
  const [trackId, setTrackId] = useState(null);
  const [shareCode, setShareCode] = useState(null);

  // optional: load a saved track by id in URL (?track=<uuid>)
  const [loadedTrack, setLoadedTrack] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const sp = new URLSearchParams(window.location.search);
        const id = sp.get("track");
        if (!id) return;
        const r = await fetch(`/api/tracks/get?id=${encodeURIComponent(id)}`);
        if (!r.ok) return;
        const d = await r.json();
        const pts = Array.isArray(d.points) ? d.points
          .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), ts: Number(p.ts) || Date.parse(p.ts) || Date.now() }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
        setLoadedTrack({
          points: pts,
          distance_m: Number(d.distance_m) || pathDistance(pts),
          duration_ms: Number(d.duration_ms) || (Date.parse(d.ended_at) - Date.parse(d.started_at)) || 0,
          weather: d.weather || null, elevation: d.elevation || null,
        });
      } catch {}
    })();
  }, []);

  const { status, msgs, errorMsg, lastPayload, connect, disconnect } = useMQTT_SSE(conn, (msg) => {
    if (Number.isFinite(msg.lat) && Number.isFinite(msg.lon)) {
      setLast(msg);
      if (tracking && (!autoBreadcrumbFixOnly || msg.fix)) {
        setPoints((prev) => {
          const next = [...prev, { lat: msg.lat, lon: msg.lon, ts: Date.now() }];
          if (next.length > 1) setDistance((d) => d + haversine(next[next.length - 2], next[next.length - 1]));
          return next;
        });
      }
    }
  });

  // K9 timer
  useInterval(() => { if (tracking && startAt) setElapsed(Date.now() - startAt); }, 1000);

  // START: create a track row
  const startTrack = async () => {
    setPoints([]); setDistance(0); setStartAt(Date.now()); setElapsed(0);
    setTracking(true); setSummary(null); setTrackId(null); setShareCode(null);

    try {
      const r = await fetch("/api/tracks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: (conn.topic.split("/")[1] || "unknown"),
          topic: conn.topic,
          startedAt: new Date().toISOString(),
        }),
      }).then((res) => res.json());
      if (r?.id) { setTrackId(r.id); setShareCode(r.shareCode); }
    } catch (e) {
      console.warn("tracks/create failed:", e);
    }
  };

  // STOP: finalize and save the track
  const stopTrack = async () => {
    setTracking(false);

    const dist = pathDistance(points);                 // recompute precisely
    const durMs = startAt ? Date.now() - startAt : 0;
    const center = points.length ? points[Math.floor(points.length / 2)] : last;

    let weather = null, elevationStats = null;
    try {
      if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lon}&current_weather=true`
        ).then((r) => r.json());
        weather = w?.current_weather || null;
      }
    } catch {}
    try {
      if (points.length) {
        const sample = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 100)) === 0);
        const locs = sample.map((p) => `${p.lat},${p.lon}`).join("|");
        const e = await fetch(
          `https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(locs)}`
        ).then((r) => r.json());
        const els = e?.results?.map((r) => r.elevation).filter(Number.isFinite) || [];
        if (els.length) {
          let gain = 0, loss = 0;
          for (let i = 1; i < els.length; i++) {
            const d = els[i] - els[i - 1];
            if (d > 0) gain += d; else loss += Math.abs(d);
          }
          elevationStats = { gain, loss };
        }
      }
    } catch {}

    setDistance(dist);
    setSummary({ distance: dist, durationMs: durMs, weather, elevation: elevationStats, points });

    if (trackId) {
      try {
        const r = await fetch("/api/tracks/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: trackId,
            endedAt: new Date().toISOString(),
            distance_m: dist,
            duration_ms: durMs,
            weather,
            elevation: elevationStats,
            points,
          }),
        }).then((res) => res.json());
        if (r?.shareCode) setShareCode(r.shareCode);
      } catch (e) {
        console.warn("tracks/finish failed:", e);
      }
    }
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
    if (loadedTrack?.points?.length) return [loadedTrack.points[0].lat, loadedTrack.points[0].lon];
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
    return [30, -97];
  }, [last, loadedTrack]);

  return (
    <div style={{ height: "100%", width: "100%", background: "#f8fafc" }}>
      {/* Header */}
      <div style={{ padding: 12, display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #e5e7eb", background: "#fff", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>K9 Live Tracker</div>
        <div style={{ marginLeft: 16, display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 14, padding: 6 }}>
          <button onClick={() => setTab("live")} style={{ padding: "6px 10px", borderRadius: 10, background: tab === "live" ? "#fff" : "transparent", boxShadow: tab === "live" ? "0 2px 8px rgba(0,0,0,.06)" : "none" }}>Live Map</button>
          <button onClick={() => setTab("k9")} style={{ padding: "6px 10px", borderRadius: 10, background: tab === "k9" ? "#fff" : "transparent", boxShadow: tab === "k9" ? "0 2px 8px rgba(0,0,0,.06)" : "none" }}>K9 Track</button>
        </div>
      </div>

      {/* Floating toggle for the panel */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        style={{ position: "fixed", top: 16, right: 16, zIndex: 1001, padding: "8px 12px", borderRadius: 10, background: "#111", color: "#fff", border: "none", boxShadow: "0 4px 16px rgba(0,0,0,.12)" }}
      >
        {panelOpen ? "Hide" : "Connect"}
      </button>

      {/* Connection + Info cards */}
      {panelOpen && createPortal(
        <div id="conn-panel" style={{ position: "fixed", top: 16, left: 16, zIndex: 2147483647 }}>
          <ConnectionPanel
            conn={conn}
            setConn={setConn}
            onConnect={connect}
            onDisconnect={disconnect}
            status={status}
            msgs={msgs}
            errorMsg={errorMsg}
            lastPayload={lastPayload}
            crumbCount={points.length}
          />

          {last && (
            <div style={{ marginTop: 8, padding: 12, background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.08)", fontSize: 12, maxWidth: 480 }}>
              <div style={{ fontWeight: 600 }}>Last fix</div>
              <div>lat: {Number.isFinite(last.lat) ? last.lat.toFixed(6) : "—"} lon: {Number.isFinite(last.lon) ? last.lon.toFixed(6) : "—"}</div>
              <div>fix: {String(last.fix)} sats: {Number.isFinite(last.sats) ? last.sats : "—"}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={recenterOnUpdate} onChange={(e) => setRecenterOnUpdate(e.target.checked)} /> Recenter on update
              </label>
            </div>
          )}

          {tab === "k9" && (
            <div style={{ marginTop: 8, padding: 12, background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.08)", fontSize: 12, maxWidth: 480 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>K9 Track Controls</div>
              <div style={{ display: "flex", gap: 8 }}>
                {!tracking ? (
                  <button onClick={startTrack} style={{ padding: "6px 10px", borderRadius: 10, background: "#16a34a", color: "#fff" }}>Start</button>
                ) : (
                  <button onClick={stopTrack} style={{ padding: "6px 10px", borderRadius: 10, background: "#dc2626", color: "#fff" }}>Stop</button>
                )}
                <button onClick={() => { setPoints([]); setDistance(0); setElapsed(0); setStartAt(null); setSummary(null); setTrackId(null); setShareCode(null); }} style={{ padding: "6px 10px", borderRadius: 10 }}>Clear</button>
              </div>
              <div>Time: {prettyDuration(elapsed)}</div>
              <div>Distance: {prettyDistance(distance)}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={autoBreadcrumbFixOnly} onChange={(e) => setAutoBreadcrumbFixOnly(e.target.checked)} />
                Only add crumbs when fix=true
              </label>

              {summary && (
                <div style={{ marginTop: 8, padding: 8, background: "#f1f5f9", borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
                  <div>Distance: {prettyDistance(summary.distance)}</div>
                  <div>Duration: {prettyDuration(summary.durationMs)}</div>
                  {(() => {
                    const km = summary.distance / 1000;
                    const pace = km > 0 ? (summary.durationMs / 60000) / km : null;
                    const speed = summary.durationMs > 0 ? km / (summary.durationMs / 3600000) : null;
                    return (<><div>Pace: {fmtPace(pace)}</div><div>Avg Speed: {fmtSpeed(speed)}</div></>);
                  })()}
                  <div>Weather: {summary.weather ? `${summary.weather.temperature}°C, wind ${summary.weather.windspeed} km/h` : "—"}</div>
                  <div>Elevation: {summary.elevation ? `gain ${Math.round(summary.elevation.gain)} m, loss ${Math.round(summary.elevation.loss)} m` : "—"}</div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button onClick={downloadSummary} style={{ padding: "6px 10px", borderRadius: 10, background: "#111", color: "#fff" }}>Download JSON</button>
                  </div>
                  {trackId && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, color: "#475569" }}>Share:</div>
                      <a href={`/?track=${trackId}`} style={{ fontSize: 12, wordBreak: "break-all" }}>
                        {typeof window !== "undefined" ? window.location.origin : ""}/?track={trackId}
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Map */}
      <div style={{ height: "100%" }}>
        <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />

          {/* Recenter to live when not viewing a saved track */}
          {recenterOnUpdate && !loadedTrack && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <Recenter lat={last.lat} lon={last.lon} />
          )}

          {/* Live point */}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
          )}

          {/* Live K9 polyline (blue) */}
          {tab === "k9" && points.length > 0 && (
            <Polyline positions={points.map((p) => [p.lat, p.lon])} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />
          )}

          {/* Loaded/saved track (green) */}
          {loadedTrack?.points?.length > 0 && (
            <>
              <FitTo points={loadedTrack.points} />
              <Polyline positions={loadedTrack.points.map((p) => [p.lat, p.lon])} pathOptions={{ color: "#10b981", weight: 4, opacity: 0.95 }} />
              <CircleMarker center={[loadedTrack.points[0].lat, loadedTrack.points[0].lon]} radius={6} pathOptions={{ color: "#059669" }} />
              <CircleMarker center={[loadedTrack.points[loadedTrack.points.length - 1].lat, loadedTrack.points[loadedTrack.points.length - 1].lon]} radius={6} pathOptions={{ color: "#065f46" }} />
            </>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
