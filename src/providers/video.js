// Bước 2b (tuỳ chọn): biến mỗi cảnh thành video clip AI (text-to-video / image-to-video).
// Các API này bất đồng bộ: tạo task → poll trạng thái → tải file mp4.
import fs from "node:fs/promises";
import { fetchJson, fetchToFile, poll, requireEnv } from "../util.js";
import { replicateRun } from "./image.js";

async function dataUri(file) {
  const ext = file.endsWith(".jpg") || file.endsWith(".jpeg") ? "jpeg" : "png";
  return `data:image/${ext};base64,${(await fs.readFile(file)).toString("base64")}`;
}

// --- Runway (image-to-video) ---
const RUNWAY_RATIOS = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" };
async function runwayVideo({ prompt, image, aspect, dest }) {
  const base = "https://api.dev.runwayml.com/v1";
  const headers = {
    Authorization: `Bearer ${requireEnv("RUNWAY_API_KEY")}`,
    "X-Runway-Version": "2024-11-06",
    "Content-Type": "application/json",
  };
  const task = await fetchJson(`${base}/image_to_video`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.RUNWAY_MODEL || "gen4_turbo",
      promptImage: await dataUri(image),
      promptText: prompt.slice(0, 1000),
      ratio: RUNWAY_RATIOS[aspect],
      duration: 5,
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

// --- Luma Dream Machine (text-to-video) ---
async function lumaVideo({ prompt, aspect, dest }) {
  const base = "https://api.lumalabs.ai/dream-machine/v1";
  const headers = { Authorization: `Bearer ${requireEnv("LUMA_API_KEY")}`, "Content-Type": "application/json" };
  const gen = await fetchJson(`${base}/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      model: process.env.LUMA_MODEL || "ray-2",
      aspect_ratio: aspect,
      duration: "5s",
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

// --- Google Veo qua Gemini API ---
async function veoVideo({ prompt, image, aspect, dest }) {
  const key = requireEnv("GEMINI_API_KEY");
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.VEO_MODEL || "veo-3.0-fast-generate-001";
  const instance = { prompt };
  if (image) instance.image = { bytesBase64Encoded: (await fs.readFile(image)).toString("base64"), mimeType: "image/png" };
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
  if (image) input[imageKey] = await dataUri(image);
  const url = await replicateRun(model, input, "Replicate video");
  return fetchToFile(url, dest);
}

export const VIDEO_PROVIDERS = {
  runway: { name: "Runway Gen-4 (image→video)", env: "RUNWAY_API_KEY", needsImage: true, run: runwayVideo },
  veo: { name: "Google Veo", env: "GEMINI_API_KEY", usesImage: true, run: veoVideo },
  luma: { name: "Luma Dream Machine (text→video)", env: "LUMA_API_KEY", run: lumaVideo },
  replicate: { name: "Replicate (Kling/Hailuo/Wan…)", env: "REPLICATE_API_TOKEN", usesImage: true, run: replicateVideo },
};

export async function generateVideo(providerId, opts) {
  const provider = VIDEO_PROVIDERS[providerId];
  if (!provider) throw new Error(`Video provider không hợp lệ: ${providerId}`);
  return provider.run(opts);
}
