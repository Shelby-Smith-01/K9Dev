// api/stream.js
// Streams MQTT messages to the browser via Server-Sent Events (SSE).
// Requires "mqtt": "4.3.7" in package.json.

import mqtt from "mqtt";

export const config = {
  // On paid plans you can extend this; Hobby will still be limited.
  runtime: "nodejs20", // or "nodejs18"
};

// Helper: write an SSE event
function sse(res, data, eventName) {
  if (eventName) res.write(`event: ${eventName}\n`);
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

export default function handler(req, res) {
  // Allow streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Query params (all optional)
  const {
    host = "mqtt.eclipseprojects.io",
    port = "",                 // "" → auto by ssl
    topic = "devices/#",
    ssl = "0",                 // "1" = TLS (8883 default), "0" = TCP (1883)
    user = "",
    pass = "",
    insecure = "0",            // "1" = allow self-signed (testing only)
    keepalive = "30",
    clientId = "",
  } = req.query || {};

  const isTLS = ssl === "1";
  const p = Number(port) || (isTLS ? 8883 : 1883);
  const url = `${isTLS ? "tls" : "mqtt"}://${host}:${p}`;

  const options = {
    protocolVersion: 4, // MQTT 3.1.1
    clean: true,
    keepalive: Number(keepalive) || 30,
    clientId: clientId || `sse-${Math.random().toString(16).slice(2)}`,
  };
  if (user) options.username = user;
  if (pass) options.password = pass;
  if (isTLS && insecure === "1") options.rejectUnauthorized = false; // testing only

  sse(res, { connecting: url, topic });

  const client = mqtt.connect(url, options);

  const ka = setInterval(() => {
    // Comment line keeps proxies from closing idle connections
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);

  client.on("connect", () => {
    sse(res, { connected: url });
    client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) sse(res, { error: `subscribe: ${String(err)}` }, "error");
      else sse(res, { subscribed: topic });
    });
  });

  client.on("message", (t, payload) => {
    sse(res, { topic: t, payload: payload.toString() });
  });

  client.on("error", (e) => {
    sse(res, { error: e?.message || String(e) }, "error");
  });

  client.on("close", () => {
    sse(res, { info: "mqtt close" }, "info");
  });

  // Cleanup when the browser disconnects
  req.on("close", () => {
    clearInterval(ka);
    try { client.end(true); } catch {}
    try { res.end(); } catch {}
  });
}
