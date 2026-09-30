import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, OUTPUT_DIR, newJob, providerCatalog, runJob, validateOptions } from "./pipeline.js";
import { FFMPEG } from "./ffmpeg.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_PARALLEL_JOBS = Number(process.env.MAX_PARALLEL_JOBS || 1);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".srt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

// ---------- Hàng đợi job (giữ trong bộ nhớ) ----------
const jobs = new Map();
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_PARALLEL_JOBS && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job).finally(() => {
      running--;
      pump();
    });
  }
}

function publicJob(job) {
  const { id, status, step, progress, logs, script, result, error, createdAt, options } = job;
  return { id, status, step, progress, logs, script, result, error, createdAt, topic: options.topic, options };
}

// ---------- HTTP helpers ----------
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Payload quá lớn"), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error("JSON không hợp lệ"), { status: 400 });
  }
}

/** Phục vụ file tĩnh, hỗ trợ Range để tua video trong trình duyệt. */
async function serveFile(req, res, root, relPath) {
  const file = path.resolve(root, "." + path.posix.normalize("/" + decodeURIComponent(relPath)));
  if (!file.startsWith(root + path.sep) && file !== root) return sendJson(res, 403, { error: "Forbidden" });
  let stat;
  try {
    stat = await fsp.stat(file);
    if (stat.isDirectory()) return serveFile(req, res, root, path.join(relPath, "index.html"));
  } catch {
    return sendJson(res, 404, { error: "Không tìm thấy" });
  }
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------- Routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  try {
    if (p === "/api/providers" && req.method === "GET") {
      return sendJson(res, 200, { providers: providerCatalog(), defaults: DEFAULTS });
    }
    if (p === "/api/jobs" && req.method === "GET") {
      const list = [...jobs.values()].reverse().map(({ id, status, step, progress, createdAt, options }) => ({
        id, status, step, progress, createdAt, topic: options.topic,
      }));
      return sendJson(res, 200, { jobs: list });
    }
    if (p === "/api/jobs" && req.method === "POST") {
      const options = validateOptions(await readBody(req));
      const job = newJob(options);
      jobs.set(job.id, job);
      queue.push(job);
      pump();
      return sendJson(res, 202, publicJob(job));
    }
    const m = p.match(/^\/api\/jobs\/([\w-]+)$/);
    if (m && req.method === "GET") {
      const job = jobs.get(m[1]);
      return job ? sendJson(res, 200, publicJob(job)) : sendJson(res, 404, { error: "Không tìm thấy job" });
    }
    const isRead = req.method === "GET" || req.method === "HEAD";
    if (p.startsWith("/output/") && isRead) {
      return serveFile(req, res, OUTPUT_DIR, p.slice("/output/".length));
    }
    if (isRead) return serveFile(req, res, PUBLIC_DIR, p === "/" ? "index.html" : p.slice(1));
    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message });
  }
});

await fsp.mkdir(OUTPUT_DIR, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`🎬 AI Video Studio đang chạy: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`   ffmpeg: ${FFMPEG}`);
  const ready = Object.entries(providerCatalog())
    .map(([kind, list]) => `${kind}: ${list.filter((x) => x.ready).map((x) => x.id).join(", ")}`)
    .join(" | ");
  console.log(`   Provider sẵn sàng → ${ready}`);
});
