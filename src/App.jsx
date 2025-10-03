import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { toPng } from "html-to-image";
import L from "leaflet";
import ReportForm from "./components/ReportForm";

/* ---------- Utilities ---------- */
const haversine = (a, b) => {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
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
const paceStr = (distance_m, duration_ms) => {
  if (!distance_m || !duration_ms) return "—";
  const minPerKm = (duration_ms / 60000) / (distance_m / 1000);
  if (!isFinite(minPerKm) || minPerKm <= 0) return "—";
  const mm = Math.floor(minPerKm);
  const ss = Math.round((minPerKm - mm) * 60);
  return `${mm}:${ss.toString().padStart(2, "0")} min/km`;
};
const speedStr = (distance_m, duration_ms) => {
  if (!distance_m || !duration_ms) return "—";
  const kmh = (distance_m / 1000) / (duration_ms / 3600000);
  if (!isFinite(kmh) || kmh <= 0) return "—";
  return `${kmh.toFixed(2)} km/h`;
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

/* ---------- Default connection (SSE backend talks to MQTT) ---------- */
const defaultConn = {
  host: "broker.emqx.io",
  port: 1883,            // 1883 for TCP, 8883 for TLS when ssl=true
  ssl: false,
  topic: "devices/esp-shelby-01/telemetry",
  useSSE: true           // use /api/stream proxy
};

/* ---------- Connection Panel (hidden in viewer mode) ---------- */
function ConnectionPanel({
  conn, setConn, onConnect, onDisconnect,
  status, msgs, errorMsg, lastPayload, crumbs, apiDiag
}) {
  return (
    <div style={{
      padding: 12, background: "rgba(255,255,255,0.95)",
      border: "1px solid #e5e7eb", borderRadius: 16,
      boxShadow: "0 4px 16px rgba(0,0,0,.08)"
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

/* ---------- SSE hook ---------- */
function useMQTT_SSE(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastPayload, setLastPayload] = useState("");
  const esRef = useRef(null);

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
  // Viewer mode detection
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams("");
  const viewerViaFlag = params.get("viewer") === "1";
  const shareCodeParam = params.get("share");
  const isViewer = viewerViaFlag || !!shareCodeParam;

  const [tab, setTab] = useState(isViewer ? "k9" : "live");
  const [panelOpen, setPanelOpen] = useState(!isViewer);
  const [conn, setConn] = useState(defaultConn);

  const [last, setLast] = useState(null);
  const [points, setPoints] = useState([]);
  const [tracking, setTracking] = useState(false);   // operator-only
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [autoBreadcrumbFixOnly, setAutoBreadcrumbFixOnly] = useState(true);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);

  const [summary, setSummary] = useState(null);
  const [trackId, setTrackId] = useState(null);
  const [shareCode, setShareCode] = useState(null);
  const [apiDiag, setApiDiag] = useState("");

  // VIEWER: whether a track is active (controls breadcrumbing)
  const [viewerTrackActive, setViewerTrackActive] = useState(false);
  const prevActiveRef = useRef(false);

  const mapRootRef = useRef(null);
  const mapRef = useRef(null);

  const MIN_STEP_M = 2;

  // Derived distance
  const distance = useMemo(() => {
    if (!points || points.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i]);
    return sum;
  }, [points]);

  // SSE connection
  const { status, msgs, errorMsg, lastPayload, connect, disconnect } =
    useMQTT_SSE(conn, (msg) => {
      if (!Number.isFinite(msg.lat) || !Number.isFinite(msg.lon)) return;
      setLast(msg);

      // VIEWER: breadcrumb ONLY if server reports an active track
      if (isViewer) {
        if (viewerTrackActive && (!autoBreadcrumbFixOnly || msg.fix)) {
          setPoints((prev) => {
            const p = { lat: msg.lat, lon: msg.lon, ts: Date.now() };
            if (prev.length === 0) return [p];
            const moved = haversine(prev[prev.length - 1], p);
            return moved >= MIN_STEP_M ? [...prev, p] : prev;
          });
        }
        return;
      }

      // OPERATOR: breadcrumb when tracking
      if (tracking && (!autoBreadcrumbFixOnly || msg.fix)) {
        setPoints((prev) => {
          const p = { lat: msg.lat, lon: msg.lon, ts: Date.now() };
          if (prev.length === 0) return [p];
          const moved = haversine(prev[prev.length - 1], p);
          return moved >= MIN_STEP_M ? [...prev, p] : prev;
        });
      }
    });

  // Elapsed timer
  useInterval(() => {
    if (isViewer) {
      if (viewerTrackActive) {
        if (!startAt && points.length > 0) setStartAt(points[0].ts);
        if (startAt) setElapsed(Date.now() - startAt);
      } else {
        // no active track -> reset timer for viewer
        setStartAt(null);
        setElapsed(0);
      }
    } else if (tracking && startAt) {
      setElapsed(Date.now() - startAt);
    }
  }, 1000);

  // Load/save connection (non-viewer only)
  useEffect(() => {
    if (isViewer) return;
    try {
      const raw = localStorage.getItem("k9-conn");
      if (raw) setConn(JSON.parse(raw));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewer]);
  useEffect(() => {
    if (isViewer) return;
    try { localStorage.setItem("k9-conn", JSON.stringify(conn)); } catch {}
  }, [conn, isViewer]);

  // Viewer: allow URL overrides
  useEffect(() => {
    if (!isViewer) return;
    const h = params.get("host");
    const port = params.get("port");
    const ssl = params.get("ssl");
    const topic = params.get("topic");
    setConn((c) => ({
      ...c,
      host: h || c.host,
      port: port ? Number(port) : c.port,
      ssl: ssl === "1" ? true : ssl === "0" ? false : c.ssl,
      topic: topic || c.topic,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewer]);

  // Viewer: resolve share code -> topic (optional)
  useEffect(() => {
    if (!shareCodeParam) return;
    (async () => {
      try {
        const r = await fetch(`/api/tracks/byShare?code=${encodeURIComponent(shareCodeParam)}`).then((res) => res.json());
        if (r?.topic) {
          setConn((c) => ({
            ...c,
            topic: r.topic,
            host: r.host || c.host,
            port: r.port || c.port,
            ssl: typeof r.ssl === "boolean" ? r.ssl : c.ssl,
          }));
        }
      } catch (e) {
        console.warn("byShare fetch failed", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareCodeParam]);

  // Viewer: auto-connect
  useEffect(() => {
    if (!isViewer) return;
    if (!conn.host || !conn.port || !conn.topic) return;
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewer, conn.host, conn.port, conn.topic, conn.ssl]);

  // Viewer: poll server for ACTIVE track status (every 10s)
  useEffect(() => {
    if (!isViewer) return;
    const q = async () => {
      try {
        const qs = shareCodeParam
          ? `code=${encodeURIComponent(shareCodeParam)}`
          : `topic=${encodeURIComponent(conn.topic)}`;
        const r = await fetch(`/api/tracks/active?${qs}`).then((res) => res.json());
        setViewerTrackActive(Boolean(r?.active));
      } catch {}
    };
    q();
    const id = setInterval(q, 10000);
    return () => clearInterval(id);
  }, [isViewer, shareCodeParam, conn.topic]);

  // Viewer: when active -> false, clear breadcrumbs (show only live dot)
  useEffect(() => {
    if (!isViewer) return;
    if (prevActiveRef.current && !viewerTrackActive) setPoints([]);
    prevActiveRef.current = viewerTrackActive;
  }, [viewerTrackActive, isViewer]);

  /* -------- Snapshot helpers (unchanged for viewer) -------- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function fitTrackBounds(map, pts, pad = 0.12) {
    if (!map) return;
    if (!pts || pts.length === 0) {
      if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) {
        map.setView([last.lat, last.lon], 15, { animate: false });
      }
      return;
    }
    if (pts.length === 1) {
      map.setView([pts[0].lat, pts[0].lon], 16, { animate: false });
      return;
    }
    const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds.pad(pad), { animate: false });
  }

  async function captureAndUploadSnapshot(id) {
    try {
      const node = mapRootRef.current;
      const map = mapRef.current;
      if (!node || !map || !id) return null;
      const prev = { center: map.getCenter(), zoom: map.getZoom() };
      fitTrackBounds(map, points, 0.12);
      await nextFrame();
      await wait(200);
      const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 2 });
      map.setView(prev.center, prev.zoom, { animate: false });
      const resp = await fetch("/api/tracks/uploadSnapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, dataUrl })
      }).then((r) => r.json());
      return resp?.url || null;
    } catch (e) {
      console.warn("snapshot failed", e);
      return null;
    }
  }

  /* -------- Operator K9 controls (hidden in viewer) -------- */
  const startTrack = async () => {
    setSummary(null);
    setTrackId(null);
    setShareCode(null);
    setStartAt(Date.now());
    setElapsed(0);
    setTracking(true);
    setApiDiag("");
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) {
      setPoints([{ lat: last.lat, lon: last.lon, ts: Date.now() }]);
    } else {
      setPoints([]);
    }
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
    }
  };

  const stopTrack = async () => {
    setTracking(false);
    const dist = distance;
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

    const pace = paceStr(dist, durMs);
    const speed = speedStr(dist, durMs);
    setSummary({ distance: dist, durationMs: durMs, weather, elevation: elevationStats, points, paceMinPerKm: pace, avgSpeedKmh: speed });

    let snapshotUrl = null;
    if (trackId) {
      snapshotUrl = await captureAndUploadSnapshot(trackId);
      if (snapshotUrl) setSummary((s) => (s ? { ...s, snapshotUrl } : s));
    }

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
            points
          }),
        }).then((res) => res.json());
        setApiDiag((d) => `${d}\nfinish: ${JSON.stringify(r)}`);
        if (r?.shareCode) setShareCode(r.shareCode);
      } catch (e) {
        setApiDiag((d) => `${d}\nfinish error: ${String(e)}`);
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
        pace_min_per_km: summary.paceMinPerKm,
        avg_speed_kmh: summary.avgSpeedKmh,
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
        {!isViewer && (
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
        )}

        <div style={{ fontSize: 18, fontWeight: 600, marginLeft: 8 }}>
          K9 Live Tracker {isViewer && <span style={{
            marginLeft: 8, fontSize: 12, fontWeight: 700,
            color: "#1f2937", background: viewerTrackActive ? "#bbf7d0" : "#fde68a",
            border: "1px solid #94a3b8", borderRadius: 8, padding: "2px 6px"
          }}>{viewerTrackActive ? "VIEW ONLY • TRACK ACTIVE" : "VIEW ONLY • LIVE POSITION"}</span>}
        </div>
      </div>

      {/* Content: Sidebar + Map */}
      <div style={{
        display: "grid",
        gridTemplateColumns: panelOpen ? "360px 1fr" : "0 1fr",
        transition: "grid-template-columns .25s ease",
        minHeight: 0
      }}>
        {/* Sidebar (hidden in viewer) */}
        <aside style={{
          overflowY: "auto",
          background: "#ffffff",
          borderRight: "1px solid #e5e7eb",
          padding: panelOpen ? 12 : 0,
          opacity: panelOpen ? 1 : 0,
          transition: "opacity .2s ease"
        }}>
{!isViewer && (
  <>
    {/* ...ConnectionPanel + Last fix + K9 Track Controls... */}

    {/* Report Form card */}
    <div
      style={{
        marginTop: 8,
        padding: 12,
        background: "rgba(255,255,255,0.95)",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        boxShadow: "0 4px 16px rgba(0,0,0,.08)",
      }}
    >
      <ReportForm defaultTrackId={trackId} />
    </div>
  </>
)}

          {!isViewer && (
            <>
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
              <div style={{ marginTop: 8, padding: 12, background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.08)", fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>Last fix</div>
                <div>lat: {Number.isFinite(last?.lat) ? last.lat.toFixed(6) : "—"}
                    &nbsp; lon: {Number.isFinite(last?.lon) ? last.lon.toFixed(6) : "—"}</div>
                <div>fix: {String(last?.fix ?? false)} &nbsp; sats: {Number.isFinite(last?.sats) ? last.sats : "—"}</div>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={recenterOnUpdate} onChange={(e) => setRecenterOnUpdate(e.target.checked)} />
                  Recenter on update
                </label>
              </div>

              <div style={{ marginTop: 8, padding: 12, background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,.08)", fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>K9 Track Controls</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!tracking ? (
                    <button onClick={startTrack} style={{ padding: "6px 10px", borderRadius: 10, background: "#16a34a", color: "#fff" }}>
                      Start
                    </button>
                  ) : (
                    <button onClick={stopTrack} style={{ padding: "6px 10px", borderRadius: 10, background: "#dc2626", color: "#fff" }}>
                      Stop
                    </button>
                  )}
                  <button onClick={clearTrack} style={{ padding: "6px 10px", borderRadius: 10 }}>Clear</button>
                </div>
                <div style={{ marginTop: 6 }}>Time: {prettyDuration(elapsed)}</div>
                <div>Distance: {prettyDistance(distance)}</div>
                <div>Pace: {paceStr(distance, elapsed)}</div>
                <div>Avg speed: {speedStr(distance, elapsed)}</div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <input type="checkbox" checked={autoBreadcrumbFixOnly} onChange={(e) => setAutoBreadcrumbFixOnly(e.target.checked)} />
                  Only add crumbs when fix=true
                </label>
              </div>
            </>
          )}
        </aside>

        {/* Map */}
        <main ref={mapRootRef} style={{ position: "relative", minWidth: 0 }}>
          {/* Overlay (always visible) */}
          <div style={{
            position: "absolute", top: 12, right: 12, zIndex: 400,
            background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb",
            borderRadius: 12, padding: 10, minWidth: 240,
            boxShadow: "0 6px 20px rgba(0,0,0,.12)", pointerEvents: "none"
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Track Summary</div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <div><b>Device:</b> {(conn.topic.split("/")[1] || "unknown")}</div>
              <div><b>Distance:</b> {prettyDistance(distance)}</div>
              <div><b>Duration:</b> {prettyDuration(elapsed)}</div>
              <div><b>Pace:</b> {paceStr(distance, elapsed)}</div>
              <div><b>Avg speed:</b> {speedStr(distance, elapsed)}</div>
              {/* Weather shown only after operator Stop() populates summary */}
              {summary?.weather ? (
                <div><b>Weather:</b> {summary.weather.temperature}°C, wind {summary.weather.windspeed} km/h</div>
              ) : (
                <div><b>Weather:</b> —</div>
              )}
            </div>
          </div>

          <MapContainer
            center={useMemo(() => {
              if (last && Number.isFinite(last.lat) && Number.isFinite(last.lon)) return [last.lat, last.lon];
              return [30, -97];
            }, [last])}
            zoom={14}
            style={{ height: "100%", width: "100%" }}
            whenCreated={(m) => (mapRef.current = m)}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
            {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
              <Recenter lat={last.lat} lon={last.lon} />
            )}
            {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
              <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
            )}
            {/* Show polyline: operator during tracking, viewer only when a track is active */}
            {((!isViewer && points.length > 0) || (isViewer && viewerTrackActive && points.length > 0)) && (
              <Polyline positions={points.map((p) => [p.lat, p.lon])} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />
            )}
          </MapContainer>
        </main>
      </div>
    </div>
  );
}




