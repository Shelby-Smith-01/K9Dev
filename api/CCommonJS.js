// api/stream.js
// Streams MQTT messages to the browser via Server-Sent Events (SSE).
// Ensure package.json has:  "mqtt": "4.3.7"

const mqtt = require("mqtt");

// No runtime config needed. If you keep one, use:  export const config = { runtime: "nodejs" };

module.exports = (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  // Query params
  const {
    host = "mqtt.eclipseprojects.io",
    port = "",
    topic = "devices/#",
    ssl = "0",          // "1" = TLS (defaults 8883), "0" = TCP (defaults 1883)
    user = "",
    pass = "",
    insecure = "0",     // "1" = allow self-signed (testing only)
    keepalive = "30",
    clientId = "",
  } = req.query || {};

  const isTLS = ssl === "1";
  const p = Number(port) || (isTLS ? 8883 : 1883);
  const url = `${isTLS ? "tls" : "mqtt"}://${host}:${p}`;

  const opts = {
    protocolVersion: 4, // MQTT 3.1.1
    clean: true,
    keepalive: Number(keepalive) || 30,
    clientId: clientId || `sse-${Math.random().toString(16).slice(2)}`
  };
  if (user) opts.username = user;
  if (pass) opts.password = pass;
  if (isTLS && insecure === "1") opts.rejectUnauthorized = false;

  // helper to write SSE data lines
  const send = (obj, event) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  send({ connecting: url, topic });

  const client = mqtt.connect(url, opts);

  // keep connection alive through proxies
  const ka = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25000);

  client.on("connect", () => {
    send({ connected: url });
    client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) send({ error: `subscribe: ${String(err)}` }, "error");
      else send({ subscribed: topic });
    });
  });

  client.on("message", (t, payload) => {
    send({ topic: t, payload: payload.toString() });
  });

  client.on("error", (e) => {
    send({ error: e?.message || String(e) }, "error");
  });

  client.on("close", () => {
    send({ info: "mqtt close" }, "info");
  });

  // cleanup when browser disconnects
  req.on("close", () => {
    clearInterval(ka);
    try { client.end(true); } catch {}
    try { res.end(); } catch {}
  });
};

