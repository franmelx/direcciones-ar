import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHandler } from "./http";
const handler = createHandler({
  geoapifyKey: process.env.GEOAPIFY_API_KEY || undefined,
  georefUrl: process.env.GEOREF_URL || undefined,
  usigUrl:
    process.env.USIG_URL === "disabled"
      ? false
      : process.env.USIG_URL || undefined,
  photonUrl: process.env.PHOTON_URL,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .filter(Boolean),
});
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/demo.js": ["demo.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const server = http.createServer((req, res) => {
  const asset = assets[new URL(req.url || "/", "http://localhost").pathname];
  if (asset && req.method === "GET") {
    res.setHeader("Content-Type", asset[1]);
    fs.createReadStream(
      path.join(
        __dirname,
        asset[0] === "demo.js" ? "demo" : "../demo",
        asset[0],
      ),
    ).pipe(res);
    return;
  }
  handler(req, res);
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT || 3030),
  process.env.HOST || "127.0.0.1",
  () => console.log("Direcciones AR listo"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close());
