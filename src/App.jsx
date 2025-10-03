// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useParams, Link } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import * as htmlToImage from "html-to-image";
import "leaflet/dist/leaflet.css";

import { PDFDownloadLink, pdf } from "@react-pdf/renderer";
import ReportPDF from "./components/ReportPDF";
import ReportForm from "./components/ReportForm";
import { supabase } from "./lib/supabaseClient";

/* =========================
   Utilities
========================= */
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

const prettyDistance = (m) =>
  !Number.isFinite(m) ? "—" : m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`;

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

/* =========================
   Point guards for snapshot/fit
========================= */
function isValidLatLon(lat, lon) {
  return Number.isFinite(lat) &&
         Number.isFinite(lon) &&
         Math.abs(lat) <= 85 &&
         Math.abs(lon) <= 180 &&
         !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001); // drop near (0,0)
}

function sanitizeForFit(pts) {
  const v = pts.filter(p => isValidLatLon(p.lat, p.lon));
  if (v.length <= 2) return v;

  const lats = v.map(p => p.lat).sort((a, b) => a - b);
  const lons = v.map(p => p.lon).sort((a, b) => a - b);
  const medLat = lats[Math.floor(lats.length / 2)];
  const medLon = lons[Math.floor(lons.length / 2)];
  const center = { lat: medLat, lon: medLon };

  // keep within 5 km of median to drop far-out spikes
  return v.filter(p => haversine(center, p) < 5000);
}

/* =========================
   SSE bridge to /api/stream
========================= */
const defaultConn = {
  host: "broker.emqx.io",
  port: 8883, // backend MQTT/TLS
  topic: "devices/esp-shelby-01/telemetry",
  ssl: true,
};

function useSSE(conn, onMessage) {
  const [status, setStatus] = useState("idle");
  const [msgs, setMsgs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const esRef = useRef(null);
  const onMsgRef = useRef(onMessage);
  useEffect(() => { onMsgRef.current = onMessage; }, [onMessage]);

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
          try {
            const m = JSON.parse(js.payload);
            const lat = Number(m.lat ?? m.latitude ?? m.Latitude ?? m.Lat);
            const lon = Number(m.lon ?? m.lng ?? m.longitude ?? m.Longitude ?? m.Lon);
            const fix = Boolean(m.fix ?? m.gpsFix ?? true);
            const sats = Number(m.sats ?? m.satellites ?? 0);
            onMsgRef.current && onMsgRef.current({ lat, lon, fix, sats, raw: m });
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

/* =========================
   Map helpers
========================= */
function Recenter({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

/* =========================
   PDF prop builder
========================= */
function buildPdfProps(summary, extras = {}) {
  const {
    distance = 0,
    durationMs = 0,
    pace_label = "—",
    avg_speed_label = "—",
    weather = null,
  } = summary || {};

  const snapshotUrl =
    (summary && (summary.snapshotDataUrl || summary.snapshotUrl)) || "";

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
    snapshotUrl,
    notes: extras.notes || "",
  };
}

/* =========================
   Live Tracker Page
========================= */
function LivePage() {
  const isViewer =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("viewer") === "1";

  const [tab, setTab] = useState(isViewer ? "live" : "k9");
  const [conn, setConn] = useState(defaultConn);
  const [last, setLast] = useState(null);
  const [points, setPoints] = useState([]);
  const [tracking, setTracking] = useState(false);
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [recenterOnUpdate, setRecenterOnUpdate] = useState(true);

  const [trackId, setTrackId] = useState(null);
  const [latestReportNo, setLatestReportNo] = useState("");

  const mapShotRef = useRef(null);
  const mapRef = useRef(null);
  const deviceId = "esp-shelby-01";
  const nav = useNavigate();

  const { status, msgs, errorMsg, connect } = useSSE(conn, (msg) => {
    if (Number.isFinite(msg.lat) && Number.isFinite(msg.lon)) {
      setLast(msg);
      if (tracking && msg.fix && isValidLatLon(msg.lat, msg.lon)) {
        setPoints((prev) => {
          const newPt = { lat: msg.lat, lon: msg.lon, ts: Date.now() };
          const lastPt = prev.length ? prev[prev.length - 1] : null;

          if (lastPt) {
            const seg = haversine(lastPt, newPt);
            if (seg < 0.5) return prev;      // ignore jitter
            if (seg > 2000) return prev;     // drop teleports
            setDistance((d) => d + seg);
          }
          return [...prev, newPt];
        });
      }
    }
  });

  // auto-connect
  useEffect(() => { connect(); /* eslint-disable-next-line */ }, []);

  useInterval(() => { if (tracking && startAt) setElapsed(Date.now() - startAt); }, 1000);

  async function fitMapToTrack(pts) {
    const map = mapRef.current;
    if (!map) return null;

    const clean = sanitizeForFit(pts || []);
    if (clean.length === 0) return null;

    const prevCenter = map.getCenter();
    const prevZoom = map.getZoom();

    const bounds = clean.length === 1
      ? [[clean[0].lat, clean[0].lon], [clean[0].lat, clean[0].lon]]
      : clean.map(p => [p.lat, p.lon]);

    map.invalidateSize();
    map.fitBounds(bounds, { padding: [40, 40] });

    await new Promise((resolve) => {
      let done = false;
      const onEnd = () => {
        if (!done) {
          done = true;
          map.off("moveend", onEnd);
          resolve();
        }
      };
      map.once("moveend", onEnd);
      setTimeout(onEnd, 800);
    });

    return () => map.setView(prevCenter, prevZoom, { animate: false });
  }

  const startTrack = async () => {
    if (isViewer) return;
    setPoints([]); setDistance(0); setElapsed(0); setStartAt(Date.now());
    setTracking(true);

    try {
      const resp = await fetch("/api/tracks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          topic: conn.topic || "",
          started_at: new Date().toISOString(),
        }),
      });
      const js = await resp.json().catch(() => ({}));
      if (resp.ok && js?.id) {
        setTrackId(js.id);
        if (js.report_no) setLatestReportNo(js.report_no);
      }
    } catch {}
  };

  const stopTrack = async () => {
    if (isViewer) return;
    setTracking(false);
    const durMs = startAt ? Date.now() - startAt : 0;

    const pts = sanitizeForFit(points.slice());
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i]);

    const center = pts.length ? pts[Math.floor(pts.length / 2)] : last;

    let weather = null;
    try {
      if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lon}&current_weather=true`
        ).then((r) => r.json());
        weather = w?.current_weather || null;
      }
    } catch {}

    let elevation = null;
    try {
      if (pts.length) {
        const sample = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 100)) === 0);
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
          elevation = { gain, loss };
        }
      }
    } catch {}

    const { avg_speed_kmh, pace_min_per_km, pace_label, avg_speed_label } =
      computeMetrics(dist, durMs);

    // Snapshot (auto-fit → capture → restore)
    let snapshotDataUrl = null;
    let restoreView = null;
    try {
      if (pts.length) restoreView = await fitMapToTrack(pts);
      if (mapShotRef.current) {
        snapshotDataUrl = await htmlToImage.toPng(mapShotRef.current, {
          cacheBust: true,
          useCORS: true,
          imageTimeout: 7000,
          pixelRatio: 2,
          imagePlaceholder:
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='%23f1f5f9'/></svg>",
        });
      }
    } catch {}
    try { if (restoreView) restoreView(); } catch {}

    // Save to backend then redirect to Report page
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
        if (resp.ok) {
          const reportNo = js?.report_no || "(pending)";
          // Redirect to /report/:id
          nav(`/report/${trackId}`, { replace: true, state: { report_no: reportNo } });
          return;
        }
      }
    } catch {}

    // If finish failed, still route to report (they can retry from there)
    if (trackId) nav(`/report/${trackId}`, { replace: true });
  };

  const center = useMemo(
    () => (last && Number.isFinite(last.lat) && Number.isFinite(last.lon) ? [last.lat, last.lon] : [30, -97]),
    [last]
  );

  return (
    <div
      style={{
        height: "100vh",
        width: "100%",
        display: "grid",
        gridTemplateColumns: "360px 1fr",
        gap: 8,
        background: "#f8fafc",
      }}
    >
      {/* Left panel */}
      <div style={{ padding: 12, overflowY: "auto", borderRight: "1px solid #e5e7eb", background: "#fff" }}>
        {/* Header with persistent Reports link */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>K9 Live Tracker</div>
          <Link to="/report/new">
            <button style={{ padding: "6px 10px", borderRadius: 10 }}>Reports</button>
          </Link>
        </div>

        <div style={{ display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 14, padding: 6, marginBottom: 8 }}>
          <button
            onClick={() => setTab("live")}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              background: tab === "live" ? "#fff" : "transparent",
              boxShadow: tab === "live" ? "0 2px 8px rgba(0,0,0,.06)" : "none",
            }}
          >
            Live Map
          </button>
          <button
            onClick={() => setTab("k9")}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              background: tab === "k9" ? "#fff" : "transparent",
              boxShadow: tab === "k9" ? "0 2px 8px rgba(0,0,0,.06)" : "none",
            }}
          >
            K9 Track
          </button>
        </div>

        {/* Connection panel (SSE) */}
        <div
          style={{
            padding: 12,
            background: "rgba(255,255,255,0.98)",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            maxWidth: 420,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>MQTT (SSE bridge)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Host
              <input value={conn.host} onChange={(e) => setConn({ ...conn, host: e.target.value })} style={{ width: "100%" }} />
            </label>
            <label style={{ fontSize: 12 }}>
              Port
              <input value={conn.port} onChange={(e) => setConn({ ...conn, port: Number(e.target.value) || 0 })} style={{ width: "100%" }} />
            </label>
          </div>
          <label style={{ fontSize: 12, display: "block", marginTop: 8 }}>
            Topic
            <input value={conn.topic} onChange={(e) => setConn({ ...conn, topic: e.target.value })} style={{ width: "100%" }} />
          </label>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <input type="checkbox" checked={conn.ssl} onChange={(e) => setConn({ ...conn, ssl: e.target.checked })} /> TLS (8883)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background:
                    status === "connected"
                      ? "#22c55e"
                      : status === "error"
                      ? "#ef4444"
                      : status === "reconnecting"
                      ? "#f59e0b"
                      : "#d1d5db",
                }}
              />
              <span style={{ fontSize: 12, color: "#6b7280" }}>{status || "idle"}</span>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>Msgs: {msgs}</span>
          </div>
          {status === "error" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", whiteSpace: "pre-wrap" }}>{errorMsg}</div>
          )}
        </div>

        {last && (
          <div style={{ marginTop: 8, padding: 12, background: "rgba(255,255,255,0.98)", border: "1px solid #e5e7eb", borderRadius: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Last fix</div>
            <div>lat: {Number.isFinite(last.lat) ? last.lat.toFixed(6) : "—"} lon: {Number.isFinite(last.lon) ? last.lon.toFixed(6) : "—"}</div>
            <div>fix: {String(last.fix)} sats: {Number.isFinite(last.sats) ? last.sats : "—"}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={recenterOnUpdate} onChange={(e) => setRecenterOnUpdate(e.target.checked)} /> Recenter on update
            </label>
          </div>
        )}

        {/* Track controls (hidden for viewer) */}
        {tab === "k9" && !isViewer && (
          <div style={{ marginTop: 8, padding: 12, background: "rgba(255,255,255,0.98)", border: "1px solid #e5e7eb", borderRadius: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>K9 Track Controls</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {!tracking ? (
                <button onClick={startTrack} style={{ padding: "6px 10px", borderRadius: 10, background: "#16a34a", color: "#fff" }}>
                  Start
                </button>
              ) : (
                <button onClick={stopTrack} style={{ padding: "6px 10px", borderRadius: 10, background: "#dc2626", color: "#fff" }}>
                  Stop
                </button>
              )}
              {/* (We also have the persistent Reports button up top now) */}
            </div>

            <div>Time: {prettyDuration(elapsed)}</div>
            <div>Distance: {prettyDistance(distance)}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Crumbs: {points.length}</div>
          </div>
        )}
      </div>

      {/* Right: Map (snapshot target) */}
      <div ref={mapShotRef} style={{ height: "100vh", width: "100%" }}>
        <MapContainer
          whenCreated={(m) => (mapRef.current = m)}
          center={useMemo(
            () =>
              last && Number.isFinite(last.lat) && Number.isFinite(last.lon)
                ? [last.lat, last.lon]
                : [30, -97],
            [last]
          )}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
            crossOrigin="anonymous"
          />
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <Recenter lat={last.lat} lon={last.lon} />
          )}
          {last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
            <CircleMarker center={[last.lat, last.lon]} radius={8} pathOptions={{ color: "#111" }} />
          )}
          {(tab === "k9" ? points : []).length > 0 && (
            <Polyline positions={points.map((p) => [p.lat, p.lon])} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9 }} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

/* =========================
   Report Page (form + history)
========================= */
function ReportPage() {
  const { id } = useParams(); // track id (may be undefined for /report/new)
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState([]);
  const [submittedInfo, setSubmittedInfo] = useState(null);

  const deviceId = "esp-shelby-01";

  useEffect(() => {
    (async () => {
      setLoading(true);
      // fetch current track (if id provided)
      if (id) {
        const { data, error } = await supabase
          .from("tracks")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (!error) setTrack(data || null);
      } else {
        setTrack(null);
      }

      // fetch recent tracks for history (last 15)
      const { data: hist } = await supabase
        .from("tracks")
        .select("id, report_no, created_at, snapshot_url, distance_m, duration_ms")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(15);
      setRecent(hist || []);

      setLoading(false);
    })();
  }, [id]);

  const summaryForPdf = track
    ? {
        distance: Number(track.distance_m || 0),
        durationMs: Number(track.duration_ms || 0),
        pace_min_per_km: Number(track.pace_min_per_km || 0),
        avg_speed_kmh: Number(track.avg_speed_kmh || 0),
        pace_label: track.pace_min_per_km
          ? `${Math.floor(track.pace_min_per_km)}:${String(Math.round((track.pace_min_per_km % 1) * 60)).padStart(2,"0")} /km`
          : "—",
        avg_speed_label: track.avg_speed_kmh ? `${Number(track.avg_speed_kmh).toFixed(2)} km/h` : "—",
        weather: track.weather || null,
        snapshotUrl: track.snapshot_url || "",
      }
    : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "520px 1fr", gap: 16, padding: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Track Report</h2>
          <Link to="/" style={{ fontSize: 14 }}>← Back to Live</Link>
        </div>

        {loading && <div style={{ marginTop: 8 }}>Loading…</div>}

        {!loading && !track && (
          <div style={{ marginTop: 8, color: "#475569" }}>
            Select a recent track on the right to fill its report.
          </div>
        )}

        {track && (
          <>
            <div style={{ marginTop: 8, fontSize: 13, color: "#475569" }}>
              <div><b>Report #:</b> {track.report_no || "(pending)"}</div>
              <div><b>Track ID:</b> {track.id}</div>
              <div><b>Started:</b> {track.started_at ? new Date(track.started_at).toLocaleString() : "—"}</div>
              <div><b>Distance:</b> {prettyDistance(Number(track.distance_m || 0))}</div>
              <div><b>Duration:</b> {prettyDuration(Number(track.duration_ms || 0))}</div>
            </div>

            {/* Snapshot preview */}
            {track.snapshot_url && (
              <div style={{ marginTop: 8 }}>
                <img
                  src={track.snapshot_url}
                  alt="snapshot"
                  style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #e5e7eb" }}
                />
              </div>
            )}

            {/* Report form */}
            <div style={{ marginTop: 12 }}>
              <ReportForm
                defaultTrackId={track.id}
                report_no={track.report_no || "(pending)"}
                snapshotUrl={track.snapshot_url || ""}
                device_id={deviceId}
                onSubmitted={(info) => setSubmittedInfo(info)}
              />
            </div>

            {/* PDF actions only after form submit */}
            {submittedInfo && summaryForPdf && (
              <div style={{ marginTop: 12, padding: 12, border: "1px solid #e5e7eb", borderRadius: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Report PDF</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <PDFDownloadLink
                    document={
                      <ReportPDF
                        {...buildPdfProps(summaryForPdf, {
                          report_no: track.report_no || "(pending)",
                          handler: "Shelby",
                          dog: "Rogue",
                          email: "TestPD@TestCity.Gov",
                          device_id: deviceId,
                          track_id: track.id,
                          notes: submittedInfo?.notes || "",
                        })}
                      />
                    }
                    fileName={`k9_report_${track.report_no || "latest"}.pdf`}
                  >
                    {({ loading }) => (
                      <button style={{ padding: "6px 10px", borderRadius: 10, background: "#111", color: "#fff" }}>
                        {loading ? "Building…" : "Download PDF"}
                      </button>
                    )}
                  </PDFDownloadLink>

                  <button
                    onClick={async () => {
                      const w = window.open("", "_blank");
                      try {
                        const blob = await pdf(
                          <ReportPDF
                            {...buildPdfProps(summaryForPdf, {
                              report_no: track.report_no || "(pending)",
                              handler: "Shelby",
                              dog: "Rogue",
                              email: "TestPD@TestCity.Gov",
                              device_id: deviceId,
                              track_id: track.id,
                              notes: submittedInfo?.notes || "",
                            })}
                          />
                        ).toBlob();
                        const url = URL.createObjectURL(blob);
                        if (w) {
                          w.location.href = url;
                          setTimeout(() => URL.revokeObjectURL(url), 60000);
                        } else {
                          window.open(url, "_blank");
                          setTimeout(() => URL.revokeObjectURL(url), 60000);
                        }
                      } catch (e) {
                        console.error("PDF view error:", e);
                        if (w) w.close();
                      }
                    }}
                    style={{ padding: "6px 10px", borderRadius: 10 }}
                  >
                    View PDF
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Right column: recent history */}
      <div>
        <h3 style={{ marginTop: 0 }}>Recent Tracks</h3>
        {recent.length === 0 && <div>No recent tracks.</div>}
        <div style={{ display: "grid", gap: 10 }}>
          {recent.map((t) => {
            const dist = Number(t.distance_m || 0);
            const dur = Number(t.duration_ms || 0);
            const summ = {
              distance: dist,
              durationMs: dur,
              pace_min_per_km: dist > 0 ? (dur / 60000) / (dist / 1000) : 0,
              avg_speed_kmh: dist > 0 ? (dist / 1000) / (dur / 3600000 || 1) : 0,
              pace_label: dist > 0
                ? `${Math.floor((dur / 60000) / (dist / 1000))}:${String(Math.round((((dur / 60000) / (dist / 1000)) % 1) * 60)).padStart(2,"0")} /km`
                : "—",
              avg_speed_label: dist > 0 ? `${(((dist / 1000) / (dur / 3600000 || 1)) || 0).toFixed(2)} km/h` : "—",
              weather: null,
              snapshotUrl: t.snapshot_url || "",
            };
            return (
              <div key={t.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.report_no || "(pending)"}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{new Date(t.created_at).toLocaleString()}</div>
                    <div style={{ fontSize: 12 }}>Distance: {prettyDistance(dist)} · Duration: {prettyDuration(dur)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Link to={`/report/${t.id}`}><button>Open</button></Link>
                    {t.snapshot_url && <a href={t.snapshot_url} target="_blank" rel="noreferrer"><button>Snapshot</button></a>}
                    <PDFDownloadLink
                      document={
                        <ReportPDF
                          {...buildPdfProps(summ, {
                            report_no: t.report_no || "(pending)",
                            handler: "Shelby",
                            dog: "Rogue",
                            email: "TestPD@TestCity.Gov",
                            device_id: "esp-shelby-01",
                            track_id: t.id,
                          })}
                        />
                      }
                      fileName={`k9_report_${t.report_no || "latest"}.pdf`}
                    >
                      {({ loading }) => <button>{loading ? "Building…" : "PDF"}</button>}
                    </PDFDownloadLink>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* =========================
   App Router
========================= */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LivePage />} />
        <Route path="/report/:id" element={<ReportPage />} />
        {/* Route to open Reports list directly */}
        <Route path="/report/new" element={<ReportPage />} />
      </Routes>
    </BrowserRouter>
  );
}





