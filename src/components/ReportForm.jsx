import React, { useState } from "react";

export default function ReportForm({
  defaultTrackId = null,
  report_no = null,       // optional display
  snapshotUrl = null,     // optional display
  device_id = null,       // optional display
}) {
  const [handler, setHandler] = useState("");
  const [dog, setDog] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setResult(null);

    try {
      const resp = await fetch("/api/forms/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handler,
          dog,
          email: email || null,
          notes: notes || null,
          track_id: defaultTrackId || null,
          attachment_url: attachmentUrl || null,
          // If you want branding saved with the entry and you have columns for these:
          // department_name: "Test PD",
          // logo_url: "https://example.com/flag.png",
        }),
      });

      const js = await resp.json().catch(() => ({}));
      if (!resp.ok || js.error) {
        throw new Error(js.error || `HTTP ${resp.status}`);
      }
      setResult(js);
    } catch (e) {
      console.error("report submit error:", e);
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 12, background: "rgba(255,255,255,0.98)", border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Track Report</div>

      {/* optional context */}
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>
        {report_no && <div><b>Report #:</b> {report_no}</div>}
        {device_id && <div><b>Device:</b> {device_id}</div>}
        {defaultTrackId && <div><b>Track ID:</b> {defaultTrackId}</div>}
        {snapshotUrl && (
          <div style={{ marginTop: 6 }}>
            <div style={{ marginBottom: 4 }}>Snapshot:</div>
            <img src={snapshotUrl} alt="snapshot" style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #e5e7eb" }} />
          </div>
        )}
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
        <label style={{ fontSize: 12 }}>
          Handler (required)
          <input
            value={handler}
            onChange={(e) => setHandler(e.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          K9 (required)
          <input
            value={dog}
            onChange={(e) => setDog(e.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Attachment URL (optional)
          <input
            value={attachmentUrl}
            onChange={(e) => setAttachmentUrl(e.target.value)}
            style={{ width: "100%" }}
            placeholder="https://..."
          />
        </label>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button disabled={saving} style={{ padding: "6px 10px", borderRadius: 8, background: "#111", color: "#fff" }}>
            {saving ? "Saving..." : "Submit Report"}
          </button>
          {error && <span style={{ color: "#b91c1c", fontSize: 12 }}>{error}</span>}
          {result?.ok && <span style={{ color: "#16a34a", fontSize: 12 }}>Saved ✓</span>}
        </div>
      </form>
    </div>
  );
}



