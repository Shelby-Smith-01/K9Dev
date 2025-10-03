import React, { useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** Optional client for uploading attachments to Supabase Storage (public bucket). */
const supabase =
  (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
    ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
    : null;

/** Department header (name + logo) shown at top of the form */
function FormHeader() {
  const dept = import.meta.env.VITE_DEPT_NAME || "Test PD";
  const logo =
    import.meta.env.VITE_DEPT_LOGO_URL ||
    "https://upload.wikimedia.org/wikipedia/commons/a/a4/Flag_of_the_United_States.svg";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingBottom: 12,
        marginBottom: 16,
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      <img
        src={logo}
        alt={`${dept} logo`}
        style={{ height: 44, width: "auto", borderRadius: 6, objectFit: "contain" }}
      />
      <div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{dept}</div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>K9 Report Form</div>
      </div>
    </div>
  );
}

export default function ReportForm({ defaultTrackId }) {
  const [form, setForm] = useState({
    handler: "",
    dog: "",
    email: "",
    track_id: defaultTrackId || "",
    notes: "",
  });
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  async function maybeUploadFile() {
    if (!file || !supabase) return null;
    const path = `reports/${crypto.randomUUID()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("attachments").upload(path, file, {
      upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from("attachments").getPublicUrl(path);
    return data?.publicUrl || null;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError("");
    setResult(null);

    try {
      let attachment_url = null;
      if (file) attachment_url = await maybeUploadFile();

      const resp = await fetch("/api/forms/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, attachment_url }),
      }).then((r) => r.json());

      if (!resp.ok) throw new Error(resp.error || "Submit failed");
      setResult(resp);

      // Reset form
      setForm({
        handler: "",
        dog: "",
        email: "",
        track_id: defaultTrackId || "",
        notes: "",
      });
      setFile(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 560,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 10px 30px rgba(0,0,0,.06)",
      }}
    >
      <FormHeader />

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Handler*
            <input
              name="handler"
              value={form.handler}
              onChange={onChange}
              required
              style={inputStyle}
              placeholder="Officer Name"
            />
          </label>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Dog*
            <input
              name="dog"
              value={form.dog}
              onChange={onChange}
              required
              style={inputStyle}
              placeholder="K9 Name"
            />
          </label>
        </div>

        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Email
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={onChange}
              style={inputStyle}
              placeholder="handler@agency.gov"
            />
          </label>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Track ID
            <input
              name="track_id"
              value={form.track_id}
              onChange={onChange}
              style={inputStyle}
              placeholder="optional – links to a track"
            />
          </label>
        </div>

        <label style={{ fontSize: 12, color: "#374151" }}>
          Notes
          <textarea
            name="notes"
            value={form.notes}
            onChange={onChange}
            rows={5}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="Summary, conditions, outcome…"
          />
        </label>

        <label style={{ fontSize: 12, color: "#374151" }}>
          Attachment (photo/PDF)
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{
              display: "block",
              padding: 8,
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              width: "100%",
              background: "#f9fafb",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            disabled={sending}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "none",
              background: "#111827",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {sending ? "Submitting…" : "Submit"}
          </button>
          {error && <div style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div>}
          {result?.ok && (
            <div style={{ color: "#16a34a", fontSize: 12 }}>Saved! ID: {result.id}</div>
          )}
        </div>
      </form>
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
