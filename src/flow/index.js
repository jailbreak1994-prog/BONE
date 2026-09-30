// Frame Flow: quản lý dự án motion (lưu trữ, chat tạo/sửa, hoàn tác, render).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { OUTPUT_DIR } from "../pipeline.js";
import { buildVoiceTrack, getDuration } from "../ffmpeg.js";
import { IMAGE_PROVIDERS, generateImage } from "../providers/image.js";
import { TTS_PROVIDERS, generateSpeech } from "../providers/tts.js";
import { mapLimit } from "../util.js";
import { FLOW_LLMS, TEMPLATES, generateSpec } from "./generate.js";
import { STAGES } from "./player.js";
import { renderProject, validateProject } from "./render.js";

const FLOW_DIR = path.join(OUTPUT_DIR, "flow");
const MAX_VERSIONS = 20;
const IMAGE_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const projects = new Map();
let baseUrl = "http://127.0.0.1:3000";

export const setBaseUrl = (url) => (baseUrl = url);
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const dirOf = (id) => path.join(FLOW_DIR, id);
const urlOf = (id, file) => `/output/flow/${id}/${file}`;
const fileOfUrl = (id, url) => path.join(dirOf(id), url.split("/").pop());

// ---------- Lưu trữ ----------
export function loadProjects() {
  fs.mkdirSync(FLOW_DIR, { recursive: true });
  for (const id of fs.readdirSync(FLOW_DIR)) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dirOf(id), "project.json"), "utf8"));
      if (p.status === "working") Object.assign(p, { status: "error", error: "Server đã khởi động lại khi đang xử lý" });
      if (p.render?.status === "running") Object.assign(p.render, { status: "error", error: "Server đã khởi động lại khi đang render" });
      projects.set(p.id, p);
    } catch {}
  }
}

const saveTimers = new Map();
function save(p) {
  p.updatedAt = new Date().toISOString();
  clearTimeout(saveTimers.get(p.id));
  saveTimers.set(
    p.id,
    setTimeout(() => {
      const file = path.join(dirOf(p.id), "project.json");
      fsp.writeFile(file + ".tmp", JSON.stringify(p, null, 1)).then(() => fsp.rename(file + ".tmp", file)).catch(console.error);
    }, 200),
  );
}

export function listProjects() {
  return [...projects.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => ({
      id: p.id, title: p.title, aspect: p.aspect, status: p.status, updatedAt: p.updatedAt,
      scenes: p.scenes.length, render: p.render?.status === "done" ? p.render.url : null,
      thumb: p.scenes.find((s) => s.image?.url)?.image.url || null,
    }));
}

export const getProject = (id) => projects.get(id);

export async function deleteProject(id) {
  const p = projects.get(id);
  if (!p) return false;
  if (p.status === "working" || p.render?.status === "running") throw new Error("Dự án đang xử lý, chưa xoá được");
  projects.delete(id);
  await fsp.rm(dirOf(id), { recursive: true, force: true });
  return true;
}

// ---------- Tiện ích ----------
function assertIdle(p) {
  if (p.status === "working") throw new Error("AI đang xử lý yêu cầu trước, vui lòng chờ");
  if (p.render?.status === "running") throw new Error("Đang render video, vui lòng chờ");
}

function checkProvider(registry, id, label) {
  if (id === "none") return;
  const prov = registry[id];
  if (!prov) throw new Error(`${label} không hợp lệ: ${id}`);
  if (prov.env && !process.env[prov.env]) throw new Error(`${prov.name} cần ${prov.env} trong file .env`);
}

async function saveAttachments(p, attachments) {
  const saved = [];
  for (const src of (Array.isArray(attachments) ? attachments : []).slice(0, 4)) {
    const m = String(src).match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
    if (!m || !IMAGE_MIME[m[1]]) throw new Error("Ảnh đính kèm phải là PNG / JPG / WEBP");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 5 * 1024 * 1024) throw new Error("Mỗi ảnh đính kèm tối đa 5MB");
    const file = `asset-${hash(m[2])}.${IMAGE_MIME[m[1]]}`;
    await fsp.writeFile(path.join(dirOf(p.id), file), buf);
    const asset = { url: urlOf(p.id, file), name: `Ảnh ${p.assets.length + 1}`, mime: m[1] };
    if (!p.assets.some((a) => a.url === asset.url)) p.assets.push(asset);
    saved.push(asset.url);
  }
  p.assets = p.assets.slice(-8);
  return saved;
}

function snapshot(p) {
  return { at: new Date().toISOString(), title: p.title, theme: p.theme, scenes: p.scenes, voiceTrack: p.voiceTrack };
}

const step = (p, text, progress) => {
  Object.assign(p, { step: text, progress });
  save(p);
};

// ---------- Tạo tài nguyên cho cảnh (ảnh, giọng) và ghép giọng ----------
async function materialize(p, newScenes, warnings) {
  const old = p.scenes;
  const size = STAGES[p.aspect];
  const aspect = p.aspect;
  const voiceKey = `${p.tts}|${p.voice}`;

  // Ảnh: dùng lại nếu prompt không đổi.
  const needImages = newScenes.filter((s) => s.image_prompt && p.image !== "none");
  step(p, needImages.length ? "Tạo ảnh cho cảnh" : "Chuẩn bị cảnh", 45);
  await mapLimit(newScenes, 2, async (s, i) => {
    s.image = null;
    if (!s.image_prompt || p.image === "none") return;
    const reuse = old.find((o) => o.image?.prompt === s.image_prompt && o.image?.provider === p.image);
    if (reuse) return (s.image = reuse.image);
    const file = `img-${hash(p.image + s.image_prompt + aspect)}.png`;
    try {
      const dest = path.join(dirOf(p.id), file);
      if (!fs.existsSync(dest)) await generateImage(p.image, { prompt: s.image_prompt, aspect, size, index: i, dest });
      s.image = { prompt: s.image_prompt, provider: p.image, url: urlOf(p.id, file) };
    } catch (err) {
      warnings.push(`Cảnh ${i + 1}: tạo ảnh lỗi (${err.message.slice(0, 160)})`);
    }
  });

  // Giọng đọc: dùng lại nếu lời đọc và giọng không đổi.
  step(p, "Tạo giọng đọc", 65);
  await mapLimit(newScenes, 3, async (s, i) => {
    s.voice = null;
    if (!s.narration || p.tts === "none") return;
    const reuse = old.find((o) => o.voice?.text === s.narration && o.voice?.key === voiceKey);
    if (reuse) return (s.voice = reuse.voice);
    const file = `voice-${hash(voiceKey + s.narration)}.mp3`;
    const dest = path.join(dirOf(p.id), file);
    try {
      if (!fs.existsSync(dest)) await generateSpeech(p.tts, { text: s.narration, voice: p.voice, dest });
      s.voice = { text: s.narration, key: voiceKey, url: urlOf(p.id, file), duration: await getDuration(dest) };
    } catch (err) {
      warnings.push(`Cảnh ${i + 1}: tạo giọng đọc lỗi (${err.message.slice(0, 160)})`);
    }
  });

  // Thời lượng thật: theo giọng đọc nếu có.
  for (const s of newScenes) {
    s.estDuration = s.estDuration ?? s.duration;
    s.duration = s.voice ? Math.max(s.voice.duration + 0.6, 1.5) : s.estDuration;
    s.duration = Math.round(s.duration * 100) / 100;
  }
  p.scenes = newScenes;
  await rebuildVoiceTrack(p);
}

async function rebuildVoiceTrack(p) {
  const parts = p.scenes.map((s) => ({ file: s.voice ? fileOfUrl(p.id, s.voice.url) : null, duration: s.duration }));
  if (!parts.some((x) => x.file)) {
    p.voiceTrack = null;
    return;
  }
  const file = `track-${hash(JSON.stringify(parts))}.mp3`;
  const dest = path.join(dirOf(p.id), file);
  if (!fs.existsSync(dest)) await buildVoiceTrack(parts, dest);
  p.voiceTrack = urlOf(p.id, file);
}

async function tryValidate(p) {
  try {
    save(p);
    await new Promise((r) => setTimeout(r, 250)); // đợi ghi project.json
    return { errors: await validateProject(p, baseUrl), skipped: false };
  } catch (err) {
    return { errors: [], skipped: err.message };
  }
}

// ---------- Chạy một lượt AI (tạo mới hoặc sửa) ----------
async function runTurn(p, request) {
  const warnings = [];
  const before = p.scenes.length ? snapshot(p) : null;
  try {
    Object.assign(p, { status: "working", error: null });
    step(p, "AI đang viết kịch bản & chuyển động", 10);
    const assets = p.assets.map((a) => ({ ...a, path: fileOfUrl(p.id, a.url) }));
    let spec = await generateSpec(p.llm, p, request, { assets });

    const apply = async (s) => {
      Object.assign(p, { title: s.title, theme: s.theme });
      await materialize(p, s.scenes.map((x) => ({ ...x })), warnings);
    };
    await apply(spec);

    // Chạy thử code; nếu lỗi thì nhờ AI sửa một lần.
    step(p, "Chạy thử chuyển động", 85);
    let check = await tryValidate(p);
    if (check.errors.length && p.llm !== "mock") {
      step(p, "AI đang sửa lỗi code", 88);
      spec = await generateSpec(p.llm, p, "Sửa các lỗi khi chạy thử code bên dưới, giữ nguyên nội dung.", { assets, errors: check.errors });
      await apply(spec);
      check = await tryValidate(p);
    }
    if (check.errors.length) warnings.push(`Còn lỗi khi chạy thử: ${check.errors.slice(0, 3).join(" | ")}`);
    if (check.skipped) warnings.push(`Chưa chạy thử được bằng trình duyệt ẩn: ${check.skipped}`);

    if (before) {
      p.versions.push(before);
      p.versions = p.versions.slice(-MAX_VERSIONS);
    }
    p.render = { status: "none" };
    p.messages.push({
      role: "assistant",
      text: [spec.reply || "Xong.", ...warnings.map((w) => `⚠️ ${w}`)].join("\n"),
      at: new Date().toISOString(),
    });
    Object.assign(p, { status: "idle", step: "Sẵn sàng", progress: 100 });
  } catch (err) {
    // Lỗi giữa chừng: quay về trạng thái trước lượt này.
    if (before) Object.assign(p, { title: before.title, theme: before.theme, scenes: before.scenes, voiceTrack: before.voiceTrack });
    p.messages.push({ role: "assistant", text: `❌ Lỗi: ${err.message}`, at: new Date().toISOString() });
    Object.assign(p, { status: "error", error: err.message, step: "Lỗi" });
  }
  save(p);
}

// ---------- API ----------
export async function createProject(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Vui lòng nhập ý tưởng video");
  const llm = FLOW_LLMS[input.llm] ? input.llm : "anthropic";
  if (FLOW_LLMS[llm].env && !process.env[FLOW_LLMS[llm].env]) throw new Error(`${FLOW_LLMS[llm].name} cần ${FLOW_LLMS[llm].env} trong file .env`);
  const image = input.image || "none";
  const tts = input.tts || "none";
  checkProvider(IMAGE_PROVIDERS, image, "Model ảnh");
  checkProvider(TTS_PROVIDERS, tts, "Model giọng đọc");

  const id = `flow-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}`;
  await fsp.mkdir(dirOf(id), { recursive: true });
  const now = new Date().toISOString();
  const p = {
    id,
    title: prompt.slice(0, 60),
    template: TEMPLATES[input.template] ? input.template : null,
    aspect: STAGES[input.aspect] ? input.aspect : "9:16",
    language: String(input.language || "Tiếng Việt"),
    durationSec: Math.min(Math.max(Number(input.durationSec) || 25, 8), 120),
    llm, image, tts,
    voice: String(input.voice || ""),
    theme: null,
    scenes: [],
    messages: [],
    assets: [],
    versions: [],
    voiceTrack: null,
    status: "idle", step: "", progress: 0, error: null,
    render: { status: "none" },
    createdAt: now, updatedAt: now,
  };
  projects.set(id, p);
  const attachments = await saveAttachments(p, input.attachments);
  p.messages.push({ role: "user", text: prompt, attachments, at: now });
  save(p);
  runTurn(p, prompt);
  return p;
}

export async function sendMessage(id, input) {
  const p = projects.get(id);
  if (!p) throw new Error("Không tìm thấy dự án");
  assertIdle(p);
  const text = String(input.text || "").trim();
  if (!text) throw new Error("Vui lòng nhập nội dung");
  // Cho phép đổi cài đặt giọng/ảnh/model giữa chừng.
  if (input.settings) {
    const s = input.settings;
    if (s.llm && FLOW_LLMS[s.llm]) p.llm = s.llm;
    if (s.image) { checkProvider(IMAGE_PROVIDERS, s.image, "Model ảnh"); p.image = s.image; }
    if (s.tts) { checkProvider(TTS_PROVIDERS, s.tts, "Model giọng đọc"); p.tts = s.tts; }
    if (s.voice !== undefined) p.voice = String(s.voice);
  }
  if (FLOW_LLMS[p.llm].env && !process.env[FLOW_LLMS[p.llm].env]) throw new Error(`${FLOW_LLMS[p.llm].name} cần ${FLOW_LLMS[p.llm].env} trong file .env`);
  const attachments = await saveAttachments(p, input.attachments);
  p.messages.push({ role: "user", text, attachments, at: new Date().toISOString() });
  Object.assign(p, { status: "working", step: "Đang gửi cho AI", progress: 5 });
  save(p);
  runTurn(p, text);
  return p;
}

export async function undo(id) {
  const p = projects.get(id);
  if (!p) throw new Error("Không tìm thấy dự án");
  assertIdle(p);
  const prev = p.versions.pop();
  if (!prev) throw new Error("Không còn phiên bản trước để hoàn tác");
  Object.assign(p, { title: prev.title, theme: prev.theme, scenes: prev.scenes, voiceTrack: prev.voiceTrack, render: { status: "none" } });
  p.messages.push({ role: "assistant", text: "↩️ Đã hoàn tác về phiên bản trước.", at: new Date().toISOString() });
  save(p);
  return p;
}

export async function startRender(id, { quality } = {}) {
  const p = projects.get(id);
  if (!p) throw new Error("Không tìm thấy dự án");
  assertIdle(p);
  if (!p.scenes.length) throw new Error("Dự án chưa có cảnh nào");
  const q = quality === "720p" ? "720p" : "1080p";
  const oldUrl = p.render?.url;
  p.render = { status: "running", progress: 0, quality: q, startedAt: new Date().toISOString() };
  save(p);
  const file = `video-${Date.now()}.mp4`;
  renderProject(p, {
    baseUrl,
    quality: q,
    voiceTrack: p.voiceTrack ? fileOfUrl(p.id, p.voiceTrack) : null,
    music: process.env.BACKGROUND_MUSIC || null,
    dest: path.join(dirOf(p.id), file),
    onProgress: (n) => {
      p.render.progress = n;
      save(p);
    },
  })
    .then(async () => {
      if (oldUrl) await fsp.rm(fileOfUrl(p.id, oldUrl), { force: true }).catch(() => {});
      p.render = { status: "done", progress: 100, quality: q, url: urlOf(p.id, file), at: new Date().toISOString() };
    })
    .catch((err) => {
      p.render = { status: "error", error: err.message, quality: q };
    })
    .finally(() => save(p));
  return p;
}

export function flowCatalog() {
  return {
    llm: Object.entries(FLOW_LLMS).map(([id, x]) => ({ id, name: x.name, env: x.env, ready: !x.env || Boolean(process.env[x.env]) })),
    templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, hint: t.hint })),
  };
}
