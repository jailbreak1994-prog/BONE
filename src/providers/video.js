// Tạo video clip AI: dùng cho chế độ "video" của Auto Video và cho tab "Video".
// Mỗi provider nhận { prompt, image, lastImage, aspect, duration, size, dest } và trả về file mp4.
// Các API này bất đồng bộ: tạo task → poll trạng thái → tải file.
import fs from "node:fs/promises";
import { fetchJson, fetchToFile, poll, requireEnv } from "../util.js";
import { replicateRun } from "./image.js";
import { mockClip } from "../ffmpeg.js";

async function dataUri(file) {
  const buf = await fs.readFile(file);
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf[0] === 0x52 && buf[8] === 0x57 ? "image/webp" : "image/png";
  return { uri: `data:${mime};base64,${buf.toString("base64")}`, mime, b64: buf.toString("base64") };
}

const pick = (value, allowed) => (allowed.includes(Number(value)) ? Number(value) : allowed[0]);

// --- Runway (ảnh → video, hỗ trợ ảnh đầu + ảnh cuối) ---
const RUNWAY_RATIOS = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" };
async function runwayVideo({ prompt, image, lastImage, aspect, duration, dest }) {
  if (!image) throw new Error("Runway cần ảnh đầu (Ảnh đầu) để tạo video");
  const base = "https://api.dev.runwayml.com/v1";
  const headers = {
    Authorization: `Bearer ${requireEnv("RUNWAY_API_KEY")}`,
    "X-Runway-Version": "2024-11-06",
    "Content-Type": "application/json",
  };
  const first = (await dataUri(image)).uri;
  const promptImage = lastImage
    ? [{ uri: first, position: "first" }, { uri: (await dataUri(lastImage)).uri, position: "last" }]
    : first;
  const task = await fetchJson(`${base}/image_to_video`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.RUNWAY_MODEL || "gen4_turbo",
      promptImage,
      promptText: prompt.slice(0, 1000),
      ratio: RUNWAY_RATIOS[aspect] || RUNWAY_RATIOS["16:9"],
      duration: pick(duration, [5, 10]),
    }),
  });
  const done = await poll(
    async () => {
      const t = await fetchJson(`${base}/tasks/${task.id}`, { headers });
      if (t.status === "SUCCEEDED") return t;
      if (t.status === "FAILED" || t.status === "CANCELLED") throw new Error(`Runway thất bại: ${t.failure || t.status}`);
    },
    { label: "Runway" },
  );
  return fetchToFile(done.output[0], dest);
}

// --- Luma Dream Machine (chữ → video) ---
async function lumaVideo({ prompt, aspect, duration, dest }) {
  const base = "https://api.lumalabs.ai/dream-machine/v1";
  const headers = { Authorization: `Bearer ${requireEnv("LUMA_API_KEY")}`, "Content-Type": "application/json" };
  const gen = await fetchJson(`${base}/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      model: process.env.LUMA_MODEL || "ray-2",
      aspect_ratio: aspect,
      duration: `${pick(duration, [5, 9])}s`,
      resolution: "720p",
    }),
  });
  const done = await poll(
    async () => {
      const g = await fetchJson(`${base}/generations/${gen.id}`, { headers });
      if (g.state === "completed") return g;
      if (g.state === "failed") throw new Error(`Luma thất bại: ${g.failure_reason || "unknown"}`);
    },
    { label: "Luma" },
  );
  return fetchToFile(done.assets.video, dest);
}

// --- Google Veo qua Gemini API (chữ → video hoặc ảnh đầu → video) ---
async function veoVideo({ prompt, image, lastImage, aspect, dest }) {
  const key = requireEnv("GEMINI_API_KEY");
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.VEO_MODEL || "veo-3.0-fast-generate-001";
  const instance = { prompt };
  if (image) {
    const { b64, mime } = await dataUri(image);
    instance.image = { bytesBase64Encoded: b64, mimeType: mime };
  }
  if (lastImage) {
    const { b64, mime } = await dataUri(lastImage);
    instance.lastFrame = { bytesBase64Encoded: b64, mimeType: mime };
  }
  const op = await fetchJson(`${base}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [instance],
      parameters: { aspectRatio: aspect === "9:16" ? "9:16" : "16:9" },
    }),
  });
  const done = await poll(
    async () => {
      const o = await fetchJson(`${base}/${op.name}`, { headers: { "x-goog-api-key": key } });
      if (o.error) throw new Error(`Veo thất bại: ${o.error.message}`);
      if (o.done) return o;
    },
    { label: "Veo", intervalMs: 10000 },
  );
  const uri = done.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new Error("Veo không trả về video (có thể bị bộ lọc an toàn chặn)");
  return fetchToFile(uri, dest, { headers: { "x-goog-api-key": key } });
}

// --- Replicate (Kling, Hailuo/MiniMax, Wan, …) ---
async function replicateVideo({ prompt, image, aspect, dest }) {
  const model = process.env.REPLICATE_VIDEO_MODEL || "minimax/video-01";
  const imageKey = process.env.REPLICATE_VIDEO_IMAGE_KEY || "first_frame_image";
  const input = { prompt };
  if (process.env.REPLICATE_VIDEO_SEND_ASPECT === "true") input.aspect_ratio = aspect;
  if (image) input[imageKey] = (await dataUri(image)).uri;
  const url = await replicateRun(model, input, "Replicate video");
  return fetchToFile(url, dest);
}

async function mockVideo({ image, duration, size, dest }) {
  await mockClip(dest, size, pick(duration, [4, 5, 8, 10]), image);
  return dest;
}

// durations: các thời lượng (giây) cho phép chọn; firstFrame/lastFrame: có nhận ảnh đầu/cuối không.
export const VIDEO_PROVIDERS = {
  runway: { name: "Runway Gen-4", env: "RUNWAY_API_KEY", needsImage: true, firstFrame: true, lastFrame: true, durations: [5, 10], run: runwayVideo },
  veo: { name: "Google Veo", env: "GEMINI_API_KEY", usesImage: true, firstFrame: true, lastFrame: true, durations: [8], run: veoVideo },
  luma: { name: "Luma Dream Machine", env: "LUMA_API_KEY", durations: [5, 9], run: lumaVideo },
  replicate: { name: "Kling / Hailuo (Replicate)", env: "REPLICATE_API_TOKEN", usesImage: true, firstFrame: true, durations: [5], run: replicateVideo },
  mock: { name: "Mock (video thử, miễn phí)", env: null, usesImage: true, firstFrame: true, durations: [4, 5, 8, 10], run: mockVideo },
};

export async function generateVideo(providerId, opts) {
  const provider = VIDEO_PROVIDERS[providerId];
  if (!provider) throw new Error(`Video provider không hợp lệ: ${providerId}`);
  return provider.run(opts);
}
