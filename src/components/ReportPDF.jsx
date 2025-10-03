// src/components/ReportPDF.jsx
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 11 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  logo: { width: 48, height: 48, marginRight: 12 },
  titleWrap: { flexGrow: 1 },
  title: { fontSize: 16, fontWeight: 700 },
  sub: { fontSize: 11, color: "#555" },
  section: { marginTop: 12, paddingTop: 8, borderTop: "1 solid #ddd" },
  row: { flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" },
  label: { width: 110, color: "#555" },
  value: { flexGrow: 1 },
  snapshot: { width: "100%", marginTop: 10, border: "1 solid #ddd" },
});

export default function ReportPDF({
  departmentName = "Test PD",
  logoUrl = "https://flagcdn.com/w320/us.png", // placeholder flag
  reportNo,
  createdAt,
  handler,
  dog,
  email,
  deviceId,
  trackId,
  distance_m,
  duration_ms,
  pace_label,
  avg_speed_label,
  weather,            // e.g. { temperature, windspeed }
  snapshotUrl,        // PNG from your track snapshot
  notes,
}) {
  const prettyDistance = (m) => (m < 1000 ? `${m.toFixed(1)} m` : `${(m/1000).toFixed(2)} km`);
  const prettyDuration = (ms) => {
    const s = Math.floor(ms/1000);
    const hh = Math.floor(s/3600); const mm = Math.floor((s%3600)/60); const ss = s%60;
    const pad = (n)=>String(n).padStart(2,"0");
    return hh>0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{departmentName} — K9 Track Report</Text>
            <Text style={styles.sub}>
              {reportNo ? `Report #: ${reportNo}` : ""} {createdAt ? `   •   ${new Date(createdAt).toLocaleString()}` : ""}
            </Text>
          </View>
        </View>

        {/* Details */}
        <View style={styles.section}>
          <View style={styles.row}><Text style={styles.label}>Handler</Text><Text style={styles.value}>{handler || "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>K9</Text><Text style={styles.value}>{dog || "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Email</Text><Text style={styles.value}>{email || "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Device</Text><Text style={styles.value}>{deviceId || "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Track ID</Text><Text style={styles.value}>{trackId || "—"}</Text></View>
        </View>

        {/* Stats */}
        <View style={styles.section}>
          <View style={styles.row}><Text style={styles.label}>Distance</Text><Text style={styles.value}>{Number.isFinite(distance_m) ? prettyDistance(distance_m) : "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Duration</Text><Text style={styles.value}>{Number.isFinite(duration_ms) ? prettyDuration(duration_ms) : "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Pace</Text><Text style={styles.value}>{pace_label || "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Avg Speed</Text><Text style={styles.value}>{avg_speed_label || "—"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Weather</Text>
            <Text style={styles.value}>
              {weather ? `${weather.temperature}°C, wind ${weather.windspeed} km/h` : "—"}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {notes ? (
          <View style={styles.section}>
            <Text>Notes</Text>
            <Text>{notes}</Text>
          </View>
        ) : null}

        {/* Snapshot */}
        {snapshotUrl ? (
          <View style={styles.section}>
            <Text>Map Snapshot</Text>
            <Image src={snapshotUrl} style={styles.snapshot} />
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
