import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG } from "../config.js";
import { getLanAddresses } from "./network-addresses.js";
import { handleArbLive, shutdownArbLive, writeArbPlaylist } from "../arb-live.js";
import { handleOfficialLive, shutdownOfficialGateway } from "../official-gateway.js";

export function startLocalServer(
  port = DEFAULT_CONFIG.serverPort,
  outputDir = DEFAULT_CONFIG.outputDir
): http.Server {
  writeArbPlaylist(outputDir, port);

  const server = http.createServer((req, res) => {
    // Enable CORS and disable caching
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    let reqUrl = req.url || "/";
    const rawPath = reqUrl.split("?")[0] || "/";
    const liveMatch = rawPath.match(/^\/live\/([a-z0-9-]+)$/i);
    if (liveMatch?.[1]) {
      if (liveMatch[1] === "arb") void handleArbLive(req, res);
      else void handleOfficialLive(req, res, liveMatch[1]);
      return;
    }

    if (reqUrl === "/" || reqUrl === "") {
      reqUrl = "/index.html";
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(reqUrl.split("?")[0] || "/index.html");
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain");
      res.end("400 Bad Request");
      return;
    }
    const filePath = path.join(outputDir, pathname);

    // Directory traversal protection
    const resolvedPath = path.resolve(filePath);
    const resolvedOutputDir = path.resolve(outputDir);
    const relativePath = path.relative(resolvedOutputDir, resolvedPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain");
      res.end("403 Forbidden");
      return;
    }

    if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain");
      res.end("404 Not Found");
      return;
    }

    let contentType = "application/octet-stream";
    if (resolvedPath.endsWith(".html")) {
      contentType = "text/html; charset=utf-8";
    } else if (resolvedPath.endsWith(".m3u")) {
      contentType = "application/x-mpegurl";
    } else if (resolvedPath.endsWith(".m3u8")) {
      contentType = "application/x-mpegurl";
    } else if (resolvedPath.endsWith(".json")) {
      contentType = "application/json; charset=utf-8";
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);

    const stream = fs.createReadStream(resolvedPath);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("500 Internal Server Error");
      }
    });
    stream.pipe(res);
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[ERROR] Port ${port} is already in use by another process.`);
      console.error(`Please close that process or specify a different port (e.g. PORT=8888 npm run serve).\n`);
      process.exit(1);
    } else {
      console.error("Server error:", err);
    }
  });

  server.listen(port, "0.0.0.0", () => {
    const lanIps = getLanAddresses();
    console.log(`\n========================================`);
    console.log(`  IPTV Local Serving Server Ready`);
    console.log(`========================================`);
    console.log(`Local Access:`);
    console.log(`  Dashboard:           http://localhost:${port}/`);
    console.log(`  Playlist:            http://localhost:${port}/playlist.m3u`);
    console.log(`  ARB Playlist:        http://localhost:${port}/playlist-arb.m3u`);
    console.log(`  ARB Channel:         http://localhost:${port}/live/arb`);
    console.log(`  Experimental Play:   http://localhost:${port}/playlist-experimental.m3u`);
    console.log(`  Status Report:       http://localhost:${port}/status.json`);
    console.log(`  Source Report:       http://localhost:${port}/source-report.json`);

    if (lanIps.length > 0) {
      console.log(`\nLAN Access (e.g. for Smart TV):`);
      for (const ip of lanIps) {
        console.log(`  Dashboard:           http://${ip}:${port}/`);
        console.log(`  Playlist:            http://${ip}:${port}/playlist.m3u`);
        console.log(`  ARB Playlist:        http://${ip}:${port}/playlist-arb.m3u`);
        console.log(`  ARB Channel:         http://${ip}:${port}/live/arb`);
        console.log(`  Experimental Play:   http://${ip}:${port}/playlist-experimental.m3u`);
      }
    } else {
      console.log(`\nNo active LAN IPv4 addresses found.`);
    }
    console.log(`========================================\n`);
  });

  const shutdown = () => {
    void shutdownArbLive();
    shutdownOfficialGateway();
  };
  server.on("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return server;
}
