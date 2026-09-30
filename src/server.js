import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, OUTPUT_DIR, newJob, providerCatalog, runJob, validateOptions } from "./pipeline.js";
import { FFMPEG } from "./ffmpeg.js";
import { addItem, getItem, listItems, loadLibrary, removeItem, saveLibrary } from "./library.js";
import { createAudioTask, createImageTask, createVideoTask } from "./tasks.js";
import { LLM_PROVIDERS } from "./providers/llm.js";
import * as flow from "./flow/index.js";
import { buildPlayerHtml } from "./flow/player.js";

const GSAP_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/gsap/dist/gsap.min.js");

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
  ".webp": "image/webp",
};

// ---------- Hàng đợi Auto Video ----------
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_PARALLEL_JOBS && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job, (j) => {
      if (j.status === "done") j.outputs = [{ type: "video", url: j.result.video }];
      saveLibrary();
    }).finally(() => {
      running--;
      pump();
    });
  }
}

function createAutoJob(input) {
  const options = validateOptions(input);
  const job = newJob(options);
  Object.assign(job, {
    kind: "auto",
    prompt: options.topic,
    model: options.llm,
    modelName: LLM_PROVIDERS[options.llm].name,
    params: { aspect: options.aspect, durationSec: options.durationSec, sceneCount: options.sceneCount },
    outputs: [],
  });
  addItem(job);
  queue.push(job);
  pump();
  return job;
}

const GENERATORS = { image: createImageTask, video: createVideoTask, audio: createAudioTask, auto: createAutoJob };

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
    if (p === "/api/items" && req.method === "GET") {
      return sendJson(res, 200, { items: listItems(url.searchParams.get("kind")) });
    }
    const gen = p.match(/^\/api\/generate\/(image|video|audio|auto)$/);
    if (gen && req.method === "POST") {
      const item = await GENERATORS[gen[1]](await readBody(req, 60_000_000));
      return sendJson(res, 202, item);
    }
    const one = p.match(/^\/api\/(?:items|jobs)\/([\w-]+)$/);
    if (one && req.method === "GET") {
      const item = getItem(one[1]);
      return item ? sendJson(res, 200, item) : sendJson(res, 404, { error: "Không tìm thấy" });
    }
    if (one && req.method === "DELETE") {
      return (await removeItem(one[1])) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "Không tìm thấy" });
    }
    // ---------- Frame Flow ----------
    if (p === "/api/flow" && req.method === "GET") {
      return sendJson(res, 200, { projects: flow.listProjects(), catalog: flow.flowCatalog() });
    }
    if (p === "/api/flow" && req.method === "POST") {
      return sendJson(res, 202, await flow.createProject(await readBody(req, 30_000_000)));
    }
    const fm = p.match(/^\/api\/flow\/([\w-]+)(?:\/(message|undo|render))?$/);
    if (fm) {
      const [, id, action] = fm;
      if (!action && req.method === "GET") {
        const proj = flow.getProject(id);
        return proj ? sendJson(res, 200, proj) : sendJson(res, 404, { error: "Không tìm thấy dự án" });
      }
      if (!action && req.method === "DELETE") {
        return (await flow.deleteProject(id)) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "Không tìm thấy dự án" });
      }
      if (req.method === "POST" && action === "message") return sendJson(res, 202, await flow.sendMessage(id, await readBody(req, 30_000_000)));
      if (req.method === "POST" && action === "undo") return sendJson(res, 200, await flow.undo(id));
      if (req.method === "POST" && action === "render") return sendJson(res, 202, await flow.startRender(id, await readBody(req)));
    }
    const pm = p.match(/^\/flow\/([\w-]+)\/player$/);
    if (pm && req.method === "GET") {
      const proj = flow.getProject(pm[1]);
      if (!proj) return sendJson(res, 404, { error: "Không tìm thấy dự án" });
      const mode = url.searchParams.get("mode") === "render" ? "render" : "preview";
      const scale = Math.min(Math.max(Number(url.searchParams.get("scale")) || 1, 0.1), 1);
      res.writeHead(200, {
        "Content-Type": MIME[".html"],
        "Cache-Control": "no-store",
        // Code hoạt hình do AI viết chạy trong sandbox, không truy cập được app.
        "Content-Security-Policy": "sandbox allow-scripts",
      });
      return res.end(buildPlayerHtml(proj, { mode, scale }));
    }
    if (p === "/vendor/gsap.min.js" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" });
      return fs.createReadStream(GSAP_FILE).pipe(res);
    }

    // Giữ tương thích API cũ.
    if (p === "/api/jobs" && req.method === "POST") return sendJson(res, 202, createAutoJob(await readBody(req)));
    if (p === "/api/jobs" && req.method === "GET") return sendJson(res, 200, { jobs: listItems("auto") });
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
loadLibrary();
flow.loadProjects();
server.listen(PORT, HOST, () => {
  const local = ["0.0.0.0", "::", "127.0.0.1", "localhost"].includes(HOST) ? "127.0.0.1" : HOST;
  flow.setBaseUrl(`http://${local}:${PORT}`);
  console.log(`🎬 AI Video Studio đang chạy: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`   ffmpeg: ${FFMPEG}`);
  const ready = Object.entries(providerCatalog())
    .map(([kind, list]) => `${kind}: ${list.filter((x) => x.ready).map((x) => x.id).join(", ")}`)
    .join(" | ");
  console.log(`   Provider sẵn sàng → ${ready}`);
});
