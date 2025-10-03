// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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

/* =========================
   Metrics helper
========================= */
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
   Main App
========================= */
export default function App() {
  // viewer mode hides controls: ?viewer=1
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

  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [submittedReport, setSubmittedReport] = useState(null);

  const [trackId, setTrackId] = useState(null);
  const [latestReportNo, setLatestReportNo] = useState("");

  const mapShotRef = useRef(null);
  const mapRef = useRef(null); // for fit to track
  const deviceId = "esp-shelby-01";

  const { status, msgs, errorMsg, connect, disconnect } = useSSE(conn, (msg) => {
    if (Number.isFinite(msg.lat) && Number.isFinite(msg.lon)) {
      setLast(msg);
      if (tracking) {
        setPoints((prev) => {
          const newPt = { lat: msg.lat, lon: msg.lon, ts: Date.now() };
          if (!Number.isFinite(newPt.lat) || !Number.isFinite(newPt.lon)) return prev;
          const lastPt = prev.length ? prev[prev.length - 1] : null;
          const seg = lastPt ? haversine(lastPt, newPt) : 0;
          if (lastPt && seg < 0.5) return prev; // ignore tiny jitter <0.5m
          if (lastPt) setDistance((d) => d + seg);
          return [...prev, newPt];
        });
      }
    }
  });

  // Auto-connect SSE on mount
  useEffect(() => { connect(); /* eslint-disable-next-line */ }, []);

  // timer for K9 elapsed
  useInterval(() => { if (tracking && startAt) setElapsed(Date.now() - startAt); }, 1000);

  // Fit map to full track and wait until render completes; return restorer
  async function fitMapToTrack(pts) {
    const map = mapRef.current;
    if (!map || !pts || pts.length === 0) return null;

    const prevCenter = map.getCenter();
    const prevZoom = map.getZoom();

    const bounds =
      pts.length === 1
        ? [[pts[0].lat, pts[0].lon], [pts[0].lat, pts[0].lon]]
        : pts.map((p) => [p.lat, p.lon]);

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
      setTimeout(onEnd, 700); // fallback
    });

    return () => map.setView(prevCenter, prevZoom, { animate: false });
  }

  const startTrack = async () => {
    if (isViewer) return;
    setPoints([]); setDistance(0); setElapsed(0); setStartAt(Date.now());
    setTracking(true); setSummary(null);
    setReportSubmitted(false); setSubmittedReport(null);
    setLatestReportNo(""); setTrackId(null);

    // create the track record now to get id + report_no
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
      } else {
        console.warn("create track failed:", js);
      }
    } catch (e) {
      console.warn("create error:", e);
    }
  };

  const stopTrack = async () => {
    if (isViewer) return;
    setTracking(false);
    const durMs = startAt ? Date.now() - startAt : 0;

    const pts = points.slice();
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

    // Snapshot (auto-fit → capture → restore). Hardened for CORS with fallback.
    let snapshotDataUrl = null;
    let restoreView = null;

    try {
      if (pts.length) restoreView = await fitMapToTrack(pts);

      if (mapShotRef.current) {
        // first attempt: full map + tiles
        snapshotDataUrl = await htmlToImage.toPng(mapShotRef.current, {
          cacheBust: true,
          useCORS: true,
          imageTimeout: 7000,
          pixelRatio: 2,
          imagePlaceholder:
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='%23f1f5f9'/></svg>",
        });
      }
    } catch (e) {
      console.warn("snapshot with tiles failed:", e);
    }

    if (!snapshotDataUrl && mapShotRef.current) {
      // fallback: snapshot overlays only (hide raster tiles)
      const tileImgs = mapShotRef.current.querySelectorAll(".leaflet-tile-pane img");
      const prev = [];
      tileImgs.forEach((img) => { prev.push(img.style.opacity); img.style.opacity = "0"; });

      try {
        snapshotDataUrl = await htmlToImage.toPng(mapShotRef.current, {
          cacheBust: true,
          useCORS: true,
          imageTimeout: 5000,
          pixelRatio: 2,
          backgroundColor: "#f8fafc",
        });
      } catch (e2) {
        console.warn("fallback snapshot failed:", e2);
      } finally {
        tileImgs.forEach((img, i) => (img.style.opacity = prev[i] ?? ""));
      }
    }

    try { if (restoreView) restoreView(); } catch {}

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
      snapshotDataUrl, // keep in-memory snapshot immediately
    });

    // persist to backend
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
          // Merge carefully: keep data URL, add server URL if present
          setSummary((s) => ({
            ...s,
            snapshotUrl: js?.snapshot_url || s?.snapshotUrl || null,
            report_no:   js?.report_no     || s?.report_no   || null,
          }));
          if (js?.report_no) setLatestReportNo(js.report_no);
        } else {
          console.warn("finish failed:", js);
        }
      }
    } catch (e) {
      console.warn("finish error:", e);
    }
  };

  // Backfill report_no if API didn't return it immediately
  useEffect(() => {
    (async () => {
      if (trackId && !latestReportNo) {
        const { data, error } = await supabase
          .from("tracks")
          .select("report_no")
          .eq("id", trackId)
          .maybeSingle();
        if (!error && data?.report_no) setLatestReportNo(data.report_no);
      }
    })();
  }, [trackId, latestReportNo]);

  const center = useMemo(
    () => (last && Number.isFinite(last.lat) && Number.isFinite(last.lon) ? [last.lat, last.lon] : [30, -97]),
    [last]
  );

  const finalReportNo =
    (summary && summary.report_no) ||
    (submittedReport && submittedReport.report_no) ||
    latestReportNo ||
    "(pending)";

  const pdfProps = buildPdfProps(summary, {
    report_no: finalReportNo,
    handler: "Shelby",
    dog: "Rogue",
    email: "TestPD@TestCity.Gov",
    device_id: deviceId,
    track_id: trackId || "",
    notes: submittedReport?.notes || "",
  });

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
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>K9 Live Tracker</div>

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
            <button onClick={connect} style={{ padding: "6px 10px", borderRadius: 10, background: "#111", color: "#fff" }}>Connect</button>
            <button onClick={disconnect} style={{ padding: "6px 10px", borderRadius: 10 }}>Disconnect</button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
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
          {status === "error" && errorMsg && (
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
              <button
                onClick={() => {
                  setPoints([]); setDistance(0); setElapsed(0); setStartAt(null);
                  setSummary(null); setReportSubmitted(false); setSubmittedReport(null);
                  setLatestReportNo(""); setTrackId(null);
                }}
                style={{ padding: "6px 10px", borderRadius: 10 }}
              >
                Clear
              </button>
            </div>

            <div>Time: {prettyDuration(elapsed)}</div>
            <div>Distance: {prettyDistance(distance)}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Crumbs: {points.length}</div>

            {/* Summary after Stop */}
            {summary && !tracking && (
              <div style={{ marginTop: 8, padding: 8, background: "#f1f5f9", borderRadius: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
                <div>Track #: {finalReportNo}</div>
                <div>Track ID: {trackId || "—"}</div>
                <div>Distance: {prettyDistance(summary.distance)}</div>
                <div>Duration: {prettyDuration(summary.durationMs)}</div>
                <div>Pace: {summary.pace_label ?? "—"}</div>
                <div>Avg speed: {summary.avg_speed_label ?? "—"}</div>
                <div>
                  Weather: {summary.weather ? `${summary.weather.temperature}°C, wind ${summary.weather.windspeed} km/h` : "—"}
                </div>
                <div>
                  Elevation: {summary.elevation ? `gain ${Math.round(summary.elevation.gain)} m, loss ${Math.round(summary.elevation.loss)} m` : "—"}
                </div>

                {/* Snapshot preview: prefer data URL, fallback to server URL, then friendly text */}
                {(() => {
                  const snapData = summary?.snapshotDataUrl || "";
                  const snapUrl  = summary?.snapshotUrl || "";
                  const src = snapData || snapUrl;
                  if (!src) return null;
                  return (
                    <div style={{ marginTop: 8 }}>
                      <img
                        src={src}
                        alt="snapshot"
                        style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #e5e7eb" }}
                        onError={(e) => {
                          if (snapData && snapUrl && e.currentTarget.src === snapData) {
                            e.currentTarget.src = snapUrl; // try server URL
                          } else {
                            const note = document.createElement("div");
                            note.style.cssText = "color:#b91c1c;font-size:12px;margin-top:4px";
                            note.textContent = "Snapshot preview failed to load.";
                            e.currentTarget.replaceWith(note);
                          }
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Report form after stop (operators only) */}
        {!isViewer && tab === "k9" && summary && !tracking && (
          <div style={{ marginTop: 8 }}>
            <ReportForm
              defaultTrackId={trackId}
              report_no={finalReportNo}
              snapshotUrl={summary?.snapshotDataUrl || summary?.snapshotUrl || ""}
              device_id={deviceId}
              onSubmitted={(info) => {
                setReportSubmitted(true);
                setSubmittedReport(info);
                if (info?.report_no) setLatestReportNo(info.report_no);
              }}
            />
          </div>
        )}

        {/* PDF buttons ONLY after report submitted */}
        {!isViewer && reportSubmitted && summary && (
          <div style={{ marginTop: 8, padding: 12, background: "rgba(255,255,255,0.98)", border: "1px solid #e5e7eb", borderRadius: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Report PDF</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <PDFDownloadLink
                document={
                  <ReportPDF
                    {...buildPdfProps(summary, {
                      report_no: finalReportNo,
                      handler: "Shelby",
                      dog: "Rogue",
                      email: "TestPD@TestCity.Gov",
                      device_id: deviceId,
                      track_id: trackId || "",
                      notes: submittedReport?.notes || "",
                    })}
                  />
                }
                fileName={`k9_report_${finalReportNo || "latest"}.pdf`}
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
                        {...buildPdfProps(summary, {
                          report_no: finalReportNo,
                          handler: "Shelby",
                          dog: "Rogue",
                          email: "TestPD@TestCity.Gov",
                          device_id: deviceId,
                          track_id: trackId || "",
                          notes: submittedReport?.notes || "",
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
            attribution="&copy; OpenStreetMap"
            crossOrigin="anonymous"
          />
          {recenterOnUpdate && last && Number.isFinite(last.lat) && Number.isFinite(last.lon) && (
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




