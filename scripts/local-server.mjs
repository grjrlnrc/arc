import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { catalogFile, generateCatalog, projectRoot } from "./generate-catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

export const PORT = 4173;
export const HOST = "127.0.0.1";

const CATALOG_PATH = "/Resources/catalog.json";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
};

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  const left = import.meta.url;
  const right = pathToFileURL(path.resolve(entry)).href;
  if (left === right) return true;
  return process.platform === "win32" && left.toLowerCase() === right.toLowerCase();
}

function sendText(res, method, status, body, type = "text/plain; charset=utf-8") {
  const buffer = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": buffer.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(method === "HEAD" ? undefined : buffer);
}

function resolveInsideRoot(pathname) {
  const relative = pathname.replace(/^\/+/, "");
  const full = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (full !== root && !full.startsWith(rootWithSep)) return null;
  return full;
}

async function handle(req, res) {
  if (!req.url || (req.method !== "GET" && req.method !== "HEAD")) {
    sendText(res, req.method, req.method === "GET" || req.method === "HEAD" ? 400 : 405, "Method not allowed");
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    sendText(res, req.method, 400, "Bad request");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, req.method, 400, "Bad request");
    return;
  }

  if (pathname.includes("\0") || pathname.includes("\\")) {
    sendText(res, req.method, 400, "Bad request");
    return;
  }

  if (pathname === CATALOG_PATH) {
    await generateCatalog();
  }

  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const full = resolveInsideRoot(requestPath);
  if (!full) {
    sendText(res, req.method, 403, "Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    sendText(res, req.method, 404, "Not found");
    return;
  }

  if (!stat.isFile()) {
    sendText(res, req.method, 404, "Not found");
    return;
  }

  const type = MIME[path.extname(full).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = createReadStream(full);
  stream.on("error", () => {
    res.destroy();
  });
  stream.pipe(res);
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) {
        sendText(res, req.method ?? "GET", 500, "Internal server error");
        return;
      }
      res.end();
    });
  });
}

export function listen(port = PORT, host = HOST) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve(server);
    });
  });
}

if (isDirectRun()) {
  const server = createServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Serving ARC - Reformed Learners at http://${HOST}:${PORT}/`);
    console.log(`Catalog file: ${path.relative(projectRoot, catalogFile)}`);
  });
}
