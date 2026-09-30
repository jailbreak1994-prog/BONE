// Bước 2a: tạo ảnh cho từng cảnh.
import fs from "node:fs/promises";
import { fetchJson, fetchToFile, poll, requireEnv } from "../util.js";
import { solidImage } from "../ffmpeg.js";

const OPENAI_SIZES = { "16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024" };

async function openaiImage({ prompt, aspect, dest }) {
  const data = await fetchJson("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: OPENAI_SIZES[aspect] || "1024x1024",
      n: 1,
    }),
  });
  const item = data.data[0];
  if (item.b64_json) await fs.writeFile(dest, Buffer.from(item.b64_json, "base64"));
  else await fetchToFile(item.url, dest);
  return dest;
}

/** Chạy một model bất kỳ trên Replicate và trả về URL output đầu tiên. */
export async function replicateRun(model, input, label = "Replicate") {
  const token = requireEnv("REPLICATE_API_TOKEN");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" };
  let pred = await fetchJson(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });
  pred = await poll(
    async () => {
      if (["succeeded", "failed", "canceled"].includes(pred.status)) return pred;
      pred = await fetchJson(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } });
      return ["succeeded", "failed", "canceled"].includes(pred.status) ? pred : undefined;
    },
    { label },
  );
  if (pred.status !== "succeeded") throw new Error(`${label} thất bại: ${pred.error || pred.status}`);
  return Array.isArray(pred.output) ? pred.output[0] : pred.output;
}

async function replicateImage({ prompt, aspect, dest }) {
  const model = process.env.REPLICATE_IMAGE_MODEL || "black-forest-labs/flux-schnell";
  const url = await replicateRun(model, { prompt, aspect_ratio: aspect, output_format: "png" }, "Replicate image");
  return fetchToFile(url, dest);
}

async function geminiImage({ prompt, aspect, dest }) {
  const model = process.env.GEMINI_IMAGE_MODEL || "imagen-4.0-generate-001";
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, {
    method: "POST",
    headers: { "x-goog-api-key": requireEnv("GEMINI_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect } }),
  });
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Imagen không trả về ảnh (có thể prompt bị bộ lọc an toàn chặn)");
  await fs.writeFile(dest, Buffer.from(b64, "base64"));
  return dest;
}

const PALETTE = ["0x1e3a8a", "0x7c2d12", "0x14532d", "0x581c87", "0x0f766e", "0x9f1239"];
async function mockImage({ index, size, dest }) {
  await solidImage(dest, PALETTE[index % PALETTE.length], size);
  return dest;
}

export const IMAGE_PROVIDERS = {
  openai: { name: "OpenAI gpt-image", env: "OPENAI_API_KEY", run: openaiImage },
  replicate: { name: "Replicate (FLUX…)", env: "REPLICATE_API_TOKEN", run: replicateImage },
  gemini: { name: "Google Imagen", env: "GEMINI_API_KEY", run: geminiImage },
  mock: { name: "Mock (ảnh màu)", env: null, run: mockImage },
};

export async function generateImage(providerId, opts) {
  const provider = IMAGE_PROVIDERS[providerId];
  if (!provider) throw new Error(`Image provider không hợp lệ: ${providerId}`);
  return provider.run(opts);
}
