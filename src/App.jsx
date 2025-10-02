import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { toPng } from "html-to-image";

/* ---------- Utilities ---------- */
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
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
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

function useInterval(cb, delay) {
  const r = useRef(cb);
  useEffect(() => { r.current = cb; }, [cb]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => r.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

/* ---------- Default connection (SSE backend speaks raw MQTT) ---------- */
const defaultConn = {
  host: "broker.emqx.io",
  port: 1883,            // 1883 for plain, 8883 when ssl=true
  ssl: false,
  topic: "devices/esp-shelby-01/telemetry",
  useSSE: true           // keep this ON for reliability behind HTTPS
};

/* ---------- Connection Panel ---------- */
function ConnectionPanel({
  conn, setConn, onConnect, onDisconnect,
  status, msgs, errorMsg, lastPayload, crumbs, apiDiag
}) {
  return (
    <div style={{
      padding: 12, background: "rgba(255,255,255,0.95)",
      border: "1px solid #e5e7eb", borderRadius: 16,
      boxShadow: "0 4px 16px rgba(0,0,0,.08)", maxWidth: 420
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        MQTT via SSE backend (proxy)
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 12 }}>
          Host
          <input style={{ width: "100%" }} value={conn.host}
                 onChange={(e)=>setConn({ ...conn, host: e.target.value })}/>
        </label>
        <label style={{ fontSize: 12 }}>
          Port
          <input style={{ width: "100%" }} value={conn.port}
                 onChange={(e)=>setConn({ ...conn, port: Number(e.target.value)||0 })}/>
        </label>
      </div>

      <label style={{ fontSize: 12, display: "block", marginTop: 8 }}>
        Topic
        <input style={{ width: "100%" }} value={conn.topic}
               onChange={(e)=>setConn({ ...conn, topic: e.target.value })}/>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8 }}>
        <input type="checkbox" checked={conn.ssl}
               onChange={(e)=>setConn({ ...conn, ssl: e.target.checked })}/>
        SSL (uses 8883 when checked)
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 4 }}>
        <input type="checkbox" checked={conn.useSSE}
               onChange={(e)=>setConn({ ...conn, useSSE: e.target.checked })}/>
        Use backend SSE proxy (required)
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
        <button onClick={onConnect}
                style={{ padding: "6px 10px", borderRadius: 10, background: "#111", color: "#fff" }}>
          Connect
        </button>
        <button onClick={onDisconnect}
                style={{ padding: "6px 10px", borderRadius: 10 }}>
          Disconnect
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: status === "connected" ? "#22c55e"
              : status === "error" ? "#ef4444"
              : status === "reconnecting" ? "#f59e0b" : "#d1d5db"
          }}/>
          <span style={{ fontSize: 12, color: "#6b7280" }}>{status || "idle"}</span>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>Msgs: {msgs}</span>
      </div>

      {!!errorMsg && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", whiteSpace: "pre-wrap" }}>
          {errorMsg}
        </div>
      )}

      {!!lastPayload && (
        <div style={{
          marginTop: 8, padding: 8, background: "rgba(255,255,255,0.95)",
          border: "1px dashed #94a3b8", borderRadius: 12, fontSize: 12, wordBreak: "break-word"
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Last payload</div>
          {lastPayload}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>
        <b>Crumbs this session:</b> {crumbs}
      </div>

      {!!apiDiag && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#334155", wordBreak: "break-word" }}>
          <b>API:</b> {apiDiag}
        </div>
      )}
    </div>
  );
}

/* ---------- SSE hook (fresh callback to avoid stale-closure) ---------- */
function useMQTT_SSE(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastPayload, setLastPayload] = useState("");
  const esRef = useRef(null);

  // keep latest callback
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const connect = () => {
    try { esRef.current?.close(); } catch {}
    esRef.current = null;
    setStatus("connecting");
    setMsgs(0);
    setErrorMsg("");
    setLastPayload("");

    if (!conn.useSSE) {
      setStatus("error");
      setErrorMsg("This build only supports the backend SSE proxy. Enable 'Use backend SSE proxy'.");
      return;
    }

    const p = Number(conn.port) || (conn.ssl ? 8883 : 1883);
    const url = `/api/stream?host=${encodeURIComponent(conn.host)}&port=${p}&topic=${encodeURIComponent(conn.topic)}&ssl=${conn.ssl ? "1" : "0"}`;

    setErrorMsg((m) => `Connecting via SSE: ${url}`);

    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;

    es.onopen = () => setStatus("connected");

    es.onerror = () => {
      setStatus("error");
      setErrorMsg((m) => `${m}\nSSE error`);
    };

    es.addEventListener("diag", (ev) => {
      try {
        const d = JSON.parse(ev.data || "{}");
        if (d.error) {
          setStatus("error");
          setErrorMsg((m) => `${m}\n${d.error}`);
        }
      } catch {}
    });

    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data || "{}");
        if (d.error) {
          setStatus("error");
          setErrorMsg((m) => `${m}\nAPI error: ${d.error}`);
          return;
        }
        if (d.connected || d.subscribed) return;
        if (d.topic && typeof d.payload === "string") {
          setMsgs((n) => n + 1);
          setLastPayload(`${d.topic}: ${d.payload}`);
          try {
            const js = JSON.parse(d.payload);
            const lat = Number(js.lat ?? js.latitude ?? js.Latitude ?? js.Lat);
            const lon = Number(js.lon ?? js.lng ?? js.longitude ?? js.Longitude ?? js.Lon);
            const fix = Boolean(js.fix ?? js.gpsFix ?? true);
            const sats = Number(js.sats ?? js.satellites ?? 0);
            onMessageRef.current && onMessageRef.current({ lat, lon, fix, sats, raw: js });
          } catch { /* ignore non-JSON */ }
        }
      } catch {}
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

/* ---------- Map helper ---------- */
function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

/* ---------- Main App ---------- */
export default function App() {
  const [tab, setTab] = useState("live");     // 'live' | 'k9'
  const [panelOpen, setPanelOpen] = useState(true);
  const [conn, setConn] = useState(defaultConn);

  const [last, setLast] = useState(null);     // {lat, lon, fix, sats, raw}
  const [points, setPoints] = useState([]);   // breadcrumbs during K9 track
  const [tracking, setTracking] = useState(false);
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [autoBreadcrumbFixOnly, setAutoBreadcrumbFixOnly] = useState(true);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);

  const [summary, setSummary] = useState(null);
  const [trackId, setTrackId] = useState(null);
  const [shareCode, setShareCode] = useState(null);
  const [apiDiag, setApiDiag] = useState("");

  const mapRootRef = useRef(null);

  const MIN_STEP_M = 2; // ignore GPS jitter < 2 m

  // derive distance from full breadcrumb path
  const distance = useMemo(() => {
    if (!points || points.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i]);
    return sum;
  }, [points]);

  const { status, msgs, errorMsg, lastPayload, connect, disconnect } =
    useMQTT_SSE(conn, (msg) => {
      if (!Number.isFinite(msg.lat) || !Number.isFinite(msg.lon)) return;
      setLast(msg);

      // record crumbs only while tracking
      if (!tracking) return;
      if (autoBreadcrumbFixOnly && !msg.fix) return;

      setPoints((prev) => {
        const p = { lat: msg.lat, lon: msg.lon, ts: Date.now() };
        if (prev.length === 0) return [p];
        const moved = haversine(prev[prev.length - 1], p);
        return moved >= MIN_STEP_M ? [...prev, p] : prev;
      });
    });

  // K9 elapsed timer
  useInterval(() => { if (tracking && startAt) setElapsed(Date.now() - startAt); }, 1000);

  async function captureAndUploadSnapshot(id) {
    try {
      const node = mapRootRef.current;
      if (!node || !id) return null;
      const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 2 });
      const resp = await fetch("/api/tracks/uploadSnapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, dataUrl })
      }).then((r) => r.json());
      if (resp?.url) return resp.url;
      return null;
    } catch (e) {
      console.warn("snapshot failed", e);
      return null;
    }
  }

  const startTrack = async () => {
    setSummary(null);
    setTrackId(null);
    setShareCode(null);
    setStartAt(Date.now());
    setElapsed(0);
    setTracking(true);
    setApiDiag("");

    // seed first crumb if we already have a fix
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) {
      setPoints([{ lat: last.lat, lon: last.lon, ts: Date.now() }]);
    } else {
      setPoints([]);
    }

    // create row in Supabase (best-effort)
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
      setApiDiag(JSON.stringify(r));
      if (r?.id) { setTrackId(r.id); setShareCode(r.shareCode); }
    } catch (e) {
      setApiDiag(`create error: ${String(e)}`);
      console.warn("tracks/create failed:", e);
    }
  };

  const stopTrack = async () => {
    setTracking(false);

    const dist = distance; // derived
    const durMs = startAt ? Date.now() - startAt : 0;
    const center = points.length ? points[Math.floor(points.length / 2)] : last;

    // simple weather + elevation (best-effort)
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

    setSummary({ distance: dist, durationMs: durMs, weather, elevation: elevationStats, points });

    // capture map snapshot (best-effort)
    let snapshotUrl = null;
    if (trackId) {
      snapshotUrl = await captureAndUploadSnapshot(trackId);
      if (snapshotUrl) setSummary((s) => (s ? { ...s, snapshotUrl } : s));
    }

    // persist finish
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
        setApiDiag((d) => `${d}\nfinish: ${JSON.stringify(r)}`);
        if (r?.shareCode) setShareCode(r.shareCode);
      } catch (e) {
        setApiDiag((d) => `${d}\nfinish error: ${String(e)}`);
        console.warn("tracks/finish failed:", e);
      }
    }
  };

  const clearTrack = () => {
    setPoints([]);
    setSummary(null);
    setStartAt(null);
    setElapsed(0);
    setTrackId(null);
    setShareCode(null);
    setApiDiag("");
  };

  const downloadSummary = () => {
    if (!summary) return;
    const blob = new Blob(
      [JSON.stringify({
        when: new Date().toISOString(),
        device: conn.topic,
        distance_m: summary.distance,
        duration_ms: summary.durationMs,
        weather: summary.weather,
        elevation: summary.elevation,
        samples: summary.points.length,
        path: summary.points,
        snapshot_url: summary.snapshotUrl || null,
      }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `k9_track_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const center = useMemo(() => {
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
    return [30, -97];
  }, [last]);

  return (
  <div style={{ height: "100vh", width: "100%", background: "#f8fafc", display: "grid", gridTemplateRows: "auto 1fr" }}>
    {/* Header */}
    <div style={{
      padding: 12, display: "flex", alignItems: "center", gap: 8,
      borderBottom: "1px solid #e5e7eb", background: "#fff", zIndex: 10
    }}>
      <button
        onClick={() => setPanelOpen(o => !o)}
        title={panelOpen ? "Hide sidebar" : "Show sidebar"}
        style={{
          padding: "6px 10px", borderRadius: 10, background: "#111", color: "#fff",
          border: "none", boxShadow: "0 4px 12px rgba(0,0,0,.12)"
        }}
      >
        {panelOpen ? "☰ Hide" : "☰ Show"}
      </button>

      <div style={{ fontSize: 18, fontWeight: 600, marginLeft: 8 }}>K9 Live Tracker</div>

      <div style={{ marginLeft: 16, display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 14, padding: 6 }}>
        <button onClick={() => setTab("live")}
                style={{ padding: "6px 10px", borderRadius: 10,
                         background: tab === "live" ? "#fff" : "transparent",
                         boxShadow: tab === "live" ? "0 2px 8px rgba(0,0,0,.06)" : "none" }}>
          Live Map
        </button>
        <button onClick={() => setTab("k9")}
                style={{ padding: "6px 10px", borderRadius: 10,
                         background: tab === "k9" ? "#fff" : "transparent",
                         boxShadow: tab === "k9" ? "0 2px 8px rgba(0,0,0,.06)" : "none" }}>
          K9 Track
        </button>
      </div>
    </div>

    {/* Content: Sidebar + Map */}
    <div style={{
      display: "grid",
      gridTemplateColumns: panelOpen ? "360px 1fr" : "0 1fr",
      transition: "grid-template-columns .25s ease",
      minHeight: 0
    }}>
      {/* Sidebar */}
      <aside style={{
        overflowY: "auto",
        background: "#ffffff",
        borderRight: "1px solid #e5e7eb",
        padding: panelOpen ? 12 : 0,
        opacity: panelOpen ? 1 : 0,
        transition: "opacity .2s ease"
      }}>
        <ConnectionPanel
          conn={conn}
          setConn={setConn}
          onConnect={connect}
          onDisconnect={disconnect}
          status={status}
          msgs={msgs}
          errorMsg={errorMsg}
          lastPayload={lastPayload}
          crumbs={points.length}
          apiDiag={apiDiag}
        />

        {last && (
          <div style={{
            marginTop: 8, padding: 12, background: "rgba(255,255,255,0.95)",
            border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.08)",
            fontSize: 12
          }}>
            <div style={{ fontWeight: 600 }}>Last fix</div>
            <div>lat: {Number.isFinite(last.lat) ? last.lat.toFixed(6) : "—"}
                &nbsp; lon: {Number.isFinite(last.lon) ? last.lon.toFixed(6) : "—"}</div>
            <div>fix: {String(last.fix)} &nbsp; sats: {Number.isFinite(last.sats) ? last.sats : "—"}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={recenterOnUpdate}
                onChange={(e) => setRecenterOnUpdate(e.target.checked)}
              />
              Recenter on update
            </label>
          </div>
        )}

        {tab === "k9" && (
          <div style={{
            marginTop: 8, padding: 12, background: "rgba(255,255,255,0.95)",
            border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.08)",
            fontSize: 12
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>K9 Track Controls</div>
            <div style={{ display: "flex", gap: 8 }}>
              {!tracking ? (
                <button onClick={startTrack}
                        style={{ padding: "6px 10px", borderRadius: 10, background: "#16a34a", color: "#fff" }}>
                  Start
                </button>
              ) : (
                <button onClick={stopTrack}
                        style={{ padding: "6px 10px", borderRadius: 10, background: "#dc2626", color: "#fff" }}>
                  Stop
                </button>
              )}
              <button onClick={clearTrack} style={{ padding: "6px 10px", borderRadius: 10 }}>Clear</button>
            </div>

            <div style={{ marginTop: 6 }}>Time: {prettyDuration(elapsed)}</div>
            <div>Distance: {prettyDistance(distance)}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={autoBreadcrumbFixOnly}
                onChange={(e) => setAutoBreadcrumbFixOnly(e.target.checked)}
              />
              Only add crumbs when fix=true
            </label>

            {summary && (
              <div style={{ marginTop: 8, padding: 8, background: "#f1f5f9", borderRadius: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
                <div>Distance: {prettyDistance(summary.distance ?? distance)}</div>
                <div>Duration: {prettyDuration(summary.durationMs ?? elapsed)}</div>
                <div>
                  Weather: {summary.weather ? `${summary.weather.temperature}°C, wind ${summary.weather.windspeed} km/h` : "—"}
                </div>
                <div>
                  Elevation: {summary.elevation ? `gain ${Math.round(summary.elevation.gain)} m, loss ${Math.round(summary.elevation.loss)} m` : "—"}
                </div>
                {summary.snapshotUrl && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600 }}>Snapshot</div>
                    <img src={summary.snapshotUrl} alt="Track snapshot" style={{ maxWidth: 320, borderRadius: 8 }} />
                  </div>
                )}
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={downloadSummary}
                    style={{ padding: "6px 10px", borderRadius: 10, background: "#111", color: "#fff" }}
                  >
                    Download JSON
                  </button>
                  {shareCode && (
                    <a href={`?share=${encodeURIComponent(shareCode)}`}
                       style={{ fontSize: 12, color: "#2563eb", textDecoration: "underline" }}>
                      Share link
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Map */}
      <main ref={mapRootRef} style={{ position: "relative", minWidth: 0 }}>
        <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <Recenter lat={last.lat} lon={last.lon} />
          )}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
          )}
          {(tab === "k9" ? points : []).length > 0 && (
            <Polyline
              positions={points.map((p) => [p.lat, p.lon])}
              pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }}
            />
          )}
        </MapContainer>
      </main>
    </div>
  </div>
);

      {/* Map (wrapped in ref for snapshots) */}
      <div ref={mapRootRef} style={{ height: "100%" }}>
        <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <Recenter lat={last.lat} lon={last.lon} />
          )}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
          )}
          {(tab === "k9" ? points : []).length > 0 && (
            <Polyline positions={points.map((p) => [p.lat, p.lon])}
                      pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

