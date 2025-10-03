import React, { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** Optional client for uploading attachments to Supabase Storage (public bucket). */
const supabase =
  (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
    ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
    : null;

/** Department header (name + logo) */
function FormHeader() {
  const dept = import.meta.env.VITE_DEPT_NAME || "Test PD";
  const logo =
    import.meta.env.VITE_DEPT_LOGO_URL ||
    "https://upload.wikimedia.org/wikipedia/commons/a/a4/Flag_of_the_United_States.svg";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
      <img src={logo} alt={`${dept} logo`} style={{ height: 44, width: "auto", borderRadius: 6, objectFit: "contain" }} />
      <div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{dept}</div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>K9 Report Form</div>
      </div>
    </div>
  );
}

const inputStyle = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  outline: "none",
};

function prettyDistance(m) {
  if (!m && m !== 0) return "—";
  return m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`;
}
function prettyDuration(ms) {
  if (!ms && ms !== 0) return "—";
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => n.toString().padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

export default function ReportForm({
  defaultTrackId,
  // Optional snapshot & stats from your App.jsx
  snapshotUrl,            // e.g. summary?.snapshotUrl
  distance_m,             // number (meters)
  duration_ms,            // number (ms)
  pace_min_per_km,        // string like "5:42 min/km"
  avg_speed_kmh,          // string like "10.45 km/h"
  weather                 // e.g. { temperature, windspeed }
}) {
  const [form, setForm] = useState({
    handler: "",
    dog: "",
    email: "",
    track_id: defaultTrackId || "",
    notes: "",
  });
  const [file, setFile] = useState(null);
  const [includeSnapshot, setIncludeSnapshot] = useState(Boolean(snapshotUrl));
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  async function maybeUploadFile() {
    if (!file || !supabase) return null;
    const path = `reports/${crypto.randomUUID()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("attachments").upload(path, file, { upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from("attachments").getPublicUrl(path);
    return data?.publicUrl || null;
  }

  const payloadPreview = useMemo(() => ({
    handler: form.handler || "(required)",
    dog: form.dog || "(required)",
    email: form.email || "",
    track_id: form.track_id || "",
    notes: form.notes || "",
    attachment_url: file ? "(uploaded file will be linked)" : (includeSnapshot && snapshotUrl ? snapshotUrl : ""),
  }), [form, file, includeSnapshot, snapshotUrl]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError("");
    setResult(null);

    try {
      let attachment_url = null;

      // 1) A file overrides the snapshot
      if (file) {
        attachment_url = await maybeUploadFile();
      } else if (includeSnapshot && snapshotUrl) {
        // 2) No file selected -> use the map snapshot URL if allowed
        attachment_url = snapshotUrl;
      }

      const resp = await fetch("/api/forms/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, attachment_url }),
      }).then((r) => r.json());

      if (!resp.ok) throw new Error(resp.error || "Submit failed");
      setResult(resp);

      // Reset form fields, keep track_id prefill
      setForm({ handler: "", dog: "", email: "", track_id: defaultTrackId || "", notes: "" });
      setFile(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,.06)" }}>
      <FormHeader />

      {/* Optional Track Summary & Snapshot Preview */}
      {(snapshotUrl || distance_m != null || duration_ms != null || pace_min_per_km || avg_speed_kmh || weather) && (
        <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ fontSize: 12, color: "#374151", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Track Summary</div>
              <div><b>Distance:</b> {prettyDistance(distance_m)}</div>
              <div><b>Duration:</b> {prettyDuration(duration_ms)}</div>
              <div><b>Pace:</b> {pace_min_per_km || "—"}</div>
              <div><b>Avg Speed:</b> {avg_speed_kmh || "—"}</div>
              <div><b>Weather:</b> {weather ? `${weather.temperature}°C, wind ${weather.windspeed} km/h` : "—"}</div>
            </div>

            {snapshotUrl && (
              <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>Map Snapshot</div>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={includeSnapshot} onChange={(e)=>setIncludeSnapshot(e.target.checked)} />
                    Include with report
                  </label>
                </div>
                <div style={{ width: "100%", aspectRatio: "16/9", overflow: "hidden", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                  <img src={snapshotUrl} alt="Map snapshot" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280" }}>
                  The image above was generated when you stopped the live track.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Handler*
            <input name="handler" value={form.handler} onChange={onChange} required style={inputStyle} placeholder="Officer Name" />
          </label>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Dog*
            <input name="dog" value={form.dog} onChange={onChange} required style={inputStyle} placeholder="K9 Name" />
          </label>
        </div>

        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Email
            <input name="email" type="email" value={form.email} onChange={onChange} style={inputStyle} placeholder="handler@agency.gov" />
          </label>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Track ID
            <input name="track_id" value={form.track_id} onChange={onChange} style={inputStyle} placeholder="links this report to a track" />
          </label>
        </div>

        <label style={{ fontSize: 12, color: "#374151" }}>
          Notes
          <textarea name="notes" value={form.notes} onChange={onChange} rows={5} style={{ ...inputStyle, resize: "vertical" }} placeholder="Summary, conditions, outcome…" />
        </label>

        <label style={{ fontSize: 12, color: "#374151" }}>
          Attachment (photo/PDF)
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ display: "block", padding: 8, border: "1px solid #e5e7eb", borderRadius: 10, width: "100%", background: "#f9fafb" }}
          />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            If you attach a file, it will be used instead of the map snapshot.
          </div>
        </label>

        <button disabled={sending} style={{ padding: "8px 12px", borderRadius: 10, border: "none", background: "#111827", color: "#fff", cursor: "pointer" }}>
          {sending ? "Submitting…" : "Submit"}
        </button>

        {error && <div style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div>}
        {result?.ok && <div style={{ color: "#16a34a", fontSize: 12 }}>Saved! ID: {result.id}</div>}

        {/* Tiny payload preview to verify what will be sent */}
        <details style={{ fontSize: 12, color: "#334155" }}>
          <summary>Payload preview</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(payloadPreview, null, 2)}</pre>
        </details>
      </form>
    </div>
  );
}

