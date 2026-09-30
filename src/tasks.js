// Các yêu cầu tạo đơn lẻ từ tab Ảnh / Video / Giọng đọc.
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { OUTPUT_DIR } from "./pipeline.js";
import { SIZES, getDuration } from "./ffmpeg.js";
import { IMAGE_PROVIDERS, generateImage } from "./providers/image.js";
import { VIDEO_PROVIDERS, generateVideo } from "./providers/video.js";
import { TTS_PROVIDERS, generateSpeech } from "./providers/tts.js";
import { addItem, saveLibrary } from "./library.js";
import { mapLimit } from "./util.js";

const TASK_CONCURRENCY = Number(process.env.TASK_CONCURRENCY || 3);
const MAX_REF_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const queue = [];
let running = 0;

function pump() {
  while (running < TASK_CONCURRENCY && queue.length) {
    const { item, work } = queue.shift();
    running++;
    item.status = "running";
    saveLibrary();
    work(item)
      .then(() => {
        item.status = "done";
        item.progress = 100;
      })
      .catch((err) => {
        item.status = "error";
        item.error = err.message;
      })
      .finally(() => {
        item.finishedAt = new Date().toISOString();
        running--;
        saveLibrary();
        pump();
      });
  }
}

function newId(kind) {
  return `${kind}-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Nhận ảnh từ trình duyệt: data URL (ảnh tải lên) hoặc đường dẫn /output/... (ảnh có sẵn trong thư viện).
 * Trả về { path, mime } của file trên đĩa.
 */
async function resolveImage(src, dir, name) {
  if (typeof src !== "string" || !src) return null;
  if (src.startsWith("/output/")) {
    const file = path.resolve(OUTPUT_DIR, "." + path.posix.normalize("/" + decodeURIComponent(src.slice(8).split("?")[0])));
    if (!file.startsWith(OUTPUT_DIR + path.sep)) throw new Error("Đường dẫn ảnh không hợp lệ");
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = Object.keys(IMAGE_MIME).find((m) => IMAGE_MIME[m] === ext) || (ext === "jpeg" ? "image/jpeg" : null);
    if (!mime) throw new Error("Chỉ dùng được ảnh PNG / JPG / WEBP");
    await fsp.access(file);
    return { path: file, mime };
  }
  const m = src.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if (!m || !IMAGE_MIME[m[1]]) throw new Error("Ảnh tải lên phải là PNG / JPG / WEBP");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_REF_BYTES) throw new Error("Mỗi ảnh tối đa 10MB");
  const file = path.join(dir, `${name}.${IMAGE_MIME[m[1]]}`);
  await fsp.writeFile(file, buf);
  return { path: file, mime: m[1] };
}

async function cleanupOnError(dir, fn) {
  try {
    await fn();
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw err;
  }
}

const url = (id, file) => `/output/${id}/${file}`;

function baseItem(kind, input, registry, providerKey) {
  const provider = registry[input[providerKey]];
  if (!provider) throw new Error("Vui lòng chọn model hợp lệ");
  if (provider.env && !process.env[provider.env]) throw new Error(`Model này cần ${provider.env} trong file .env`);
  return {
    id: newId(kind),
    kind,
    status: "queued",
    progress: 0,
    model: input[providerKey],
    modelName: provider.name,
    outputs: [],
    error: null,
    createdAt: new Date().toISOString(),
  };
}

// ---------- Ảnh ----------
export async function createImageTask(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Vui lòng nhập mô tả hình ảnh");
  const aspect = SIZES[input.aspect] ? input.aspect : "1:1";
  const count = Math.min(Math.max(Number(input.count) || 1, 1), 4);
  const item = baseItem("image", input, IMAGE_PROVIDERS, "model");
  const provider = IMAGE_PROVIDERS[item.model];
  Object.assign(item, { prompt, params: { aspect, quality: input.quality || "medium", count } });
  if (Array.isArray(input.refs) && input.refs.length && !provider.supportsRefs) throw new Error(`${provider.name} không hỗ trợ ảnh tham chiếu`);

  const dir = path.join(OUTPUT_DIR, item.id);
  await fsp.mkdir(dir, { recursive: true });
  const refs = [];
  const refInputs = Array.isArray(input.refs) ? input.refs.slice(0, 8) : [];
  if (refInputs.length && !provider.supportsRefs) throw new Error(`${provider.name} không hỗ trợ ảnh tham chiếu`);
  await cleanupOnError(dir, async () => {
    for (const [i, src] of refInputs.entries()) refs.push(await resolveImage(src, dir, `ref${i + 1}`));
  });
  item.params.refs = refs.map((r) => url(item.id, path.basename(r.path)));

  queue.push({
    item: addItem(item),
    work: async () => {
      let done = 0;
      const files = await mapLimit(Array.from({ length: count }), 2, async (_, i) => {
        const file = `image${i + 1}.png`;
        await generateImage(item.model, {
          prompt, aspect, size: SIZES[aspect], index: i, quality: item.params.quality, refs, dest: path.join(dir, file),
        });
        item.progress = Math.round((++done / count) * 100);
        item.outputs.push({ type: "image", url: url(item.id, file) });
        saveLibrary();
        return file;
      });
      item.outputs = files.map((f) => ({ type: "image", url: url(item.id, f) }));
    },
  });
  pump();
  return item;
}

// ---------- Video ----------
export async function createVideoTask(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Vui lòng nhập kịch bản / mô tả chuyển động");
  const aspect = ["16:9", "9:16", "1:1"].includes(input.aspect) ? input.aspect : "16:9";
  const item = baseItem("video", input, VIDEO_PROVIDERS, "model");
  const provider = VIDEO_PROVIDERS[item.model];
  const duration = provider.durations.includes(Number(input.duration)) ? Number(input.duration) : provider.durations[0];
  Object.assign(item, { prompt, params: { aspect, duration } });

  const dir = path.join(OUTPUT_DIR, item.id);
  await fsp.mkdir(dir, { recursive: true });
  if (provider.needsImage && !input.firstFrame) throw new Error(`${provider.name} cần “Ảnh đầu” để tạo video`);
  let first = null;
  let last = null;
  await cleanupOnError(dir, async () => {
    if (provider.firstFrame) first = await resolveImage(input.firstFrame, dir, "first");
    if (provider.lastFrame) last = await resolveImage(input.lastFrame, dir, "last");
  });
  if (first) item.params.firstFrame = url(item.id, path.basename(first.path));
  if (last) item.params.lastFrame = url(item.id, path.basename(last.path));

  queue.push({
    item: addItem(item),
    work: async () => {
      await generateVideo(item.model, {
        prompt, aspect, duration, size: SIZES[aspect], image: first?.path, lastImage: last?.path, dest: path.join(dir, "video.mp4"),
      });
      item.outputs = [{ type: "video", url: url(item.id, "video.mp4") }];
      item.params.actualDuration = await getDuration(path.join(dir, "video.mp4")).catch(() => null);
    },
  });
  pump();
  return item;
}

// ---------- Giọng đọc ----------
export async function createAudioTask(input) {
  const text = String(input.prompt || "").trim();
  if (!text) throw new Error("Vui lòng nhập nội dung cần đọc");
  if (text.length > 4000) throw new Error("Nội dung tối đa 4000 ký tự mỗi lần");
  const item = baseItem("audio", input, TTS_PROVIDERS, "model");
  Object.assign(item, { prompt: text, params: { voice: String(input.voice || "") } });
  const dir = path.join(OUTPUT_DIR, item.id);
  await fsp.mkdir(dir, { recursive: true });

  queue.push({
    item: addItem(item),
    work: async () => {
      const dest = path.join(dir, "audio.mp3");
      await generateSpeech(item.model, { text, voice: item.params.voice, dest });
      item.outputs = [{ type: "audio", url: url(item.id, "audio.mp3") }];
      item.params.actualDuration = await getDuration(dest).catch(() => null);
    },
  });
  pump();
  return item;
}
