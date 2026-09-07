"use strict";
const { createGeocoder } = require("./index");
const { spec, docs } = require("./openapi");
const { version } = require("../package.json");
function createHandler(options = {}) {
  const geocoder = options.geocoder || createGeocoder(options);
  const clients = new Map();
  return async function handler(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, value) => {
      if (!res.destroyed) {
        res.statusCode = status;
        res.end(JSON.stringify(value));
      }
    };
    const origin = req.headers.origin;
    if (origin && options.allowedOrigins?.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.statusCode = 204;
      res.end();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    const endpoint = url.pathname.replace(/^\/v1(?=\/)/, "");
    if (endpoint === "/health") return send(200, { status: "ok", version });
    if (endpoint === "/openapi.json") return send(200, spec);
    if (endpoint === "/docs") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(docs);
      return;
    }
    if (endpoint === "/providers") return send(200, geocoder.providers());
    if (
      ![
        "/suggest",
        "/search",
        "/reverse",
        "/provinces",
        "/localities",
      ].includes(endpoint)
    )
      return send(404, { error: "not_found" });
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      return send(405, { error: "method_not_allowed" });
    }
    // Do not trust X-Forwarded-For supplied by callers. Add proxy-level limits for larger deployments.
    const ip = req.socket.remoteAddress || "local";
    const now = Date.now();
    for (const [key, item] of clients)
      if (item.until <= now) clients.delete(key);
    if (!clients.has(ip) && clients.size >= 4096)
      return send(429, { error: "rate_limited" });
    const bucket = clients.get(ip) || { count: 0, until: now + 60000 };
    bucket.count++;
    clients.set(ip, bucket);
    if (bucket.count > (options.requestsPerMinute ?? 40)) {
      res.setHeader("Retry-After", "60");
      return send(429, { error: "rate_limited" });
    }
    try {
      let input = Object.fromEntries(url.searchParams);
      if (req.method === "POST") {
        if (
          !String(req.headers["content-type"] || "").includes(
            "application/json",
          )
        )
          return send(415, { error: "json_required" });
        if (req.body !== undefined) {
          if (Buffer.byteLength(JSON.stringify(req.body)) > 2048)
            return send(413, { error: "input_too_large" });
          input = req.body;
        } else {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 2048) return send(413, { error: "input_too_large" });
            chunks.push(chunk);
          }
          try {
            input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return send(400, { error: "invalid_json" });
          }
        }
      }
      const data = await geocoder[endpoint.slice(1)](input);
      if (data.status === "unavailable") res.setHeader("Retry-After", "5");
      send(data.status === "unavailable" ? 503 : 200, data);
    } catch (error) {
      send(error.status || 500, { error: error.code || "internal_error" });
    }
  };
}
module.exports = { createHandler };
