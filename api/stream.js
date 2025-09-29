// api/stream.js
const mqtt = require("mqtt");

module.exports = (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  });

  // Query params
  const {
    host = "broker.emqx.io",
    port = "",
    topic = "devices/#",
    ssl = "0",          // "1" -> MQTT over TLS (mqtts), "0" -> plain TCP (mqtt)
    user = "",
    pass = "",
    insecure = "0",     // "1" -> allow self-signed (testing only)
    keepalive = "30",
    clientId = ""
  } = req.query || {};

  const isTLS = ssl === "1";
  const p = Number(port) || (isTLS ? 8883 : 1883);
  const url = `${isTLS ? "mqtts" : "mqtt"}://${host}:${p}`;

  const opts = {
    protocolVersion: 4,
    clean: true,
    keepalive: Number(keepalive) || 30,
    clientId: clientId || `sse-${Math.random().toString(16).slice(2)}`
  };
  if (user) opts.username = user;
  if (pass) opts.password = pass;
  if (isTLS && insecure === "1") opts.rejectUnauthorized = false;

  const send = (obj, event) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // Emit diagnostics immediately
  send({ connecting: url, topic });

  let client;
  try {
    client = mqtt.connect(url, opts);
  } catch (e) {
    send({ error: `client create: ${e?.message || String(e)}` }, "diag");
    return;
  }

  // Keep connection from idling out at proxies
  const ka = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25000);

  client.on("connect", () => {
    send({ connected: url });
    client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) send({ error: `subscribe: ${String(err)}` }, "diag");
      else send({ subscribed: topic });
    });
  });

  client.on("message", (t, payload) => {
    send({ topic: t, payload: payload.toString() });
  });

  client.on("error", (e) => {
    send({ error: e?.message || String(e) }, "diag");
  });

  client.on("close", () => {
    send({ info: "mqtt close" }, "diag");
  });

  req.on("close", () => {
    clearInterval(ka);
    try { client && client.end(true); } catch {}
    try { res.end(); } catch {}
  });
};


