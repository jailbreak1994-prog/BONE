// Bước 1: viết kịch bản video (danh sách cảnh: lời thoại + prompt hình ảnh).
import Anthropic from "@anthropic-ai/sdk";
import { extractJson, fetchJson, requireEnv } from "../util.js";

const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "scenes"],
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["narration", "visual_prompt"],
        properties: {
          narration: { type: "string", description: "Lời đọc của cảnh, đúng ngôn ngữ yêu cầu" },
          visual_prompt: {
            type: "string",
            description: "Prompt tiếng Anh, mô tả chi tiết hình ảnh/cảnh quay cho model tạo ảnh/video",
          },
        },
      },
    },
  },
};

const SYSTEM = `Bạn là biên kịch video ngắn chuyên nghiệp cho mạng xã hội (TikTok, Reels, YouTube Shorts).
Nhiệm vụ: nhận chủ đề và viết kịch bản chia thành các cảnh.
- "narration": lời đọc tự nhiên, cuốn hút, viết bằng ngôn ngữ người dùng yêu cầu. Cảnh đầu phải có "hook" gây tò mò. Không ghi chú đạo diễn, không emoji, không hashtag trong lời đọc.
- "visual_prompt": viết bằng tiếng Anh, mô tả cụ thể chủ thể, bối cảnh, ánh sáng, góc máy, chuyển động; giữ phong cách hình ảnh nhất quán giữa các cảnh; không yêu cầu chữ/văn bản trong hình.
- Tốc độ đọc khoảng 2.5 từ/giây: tổng lời đọc phải khớp thời lượng mục tiêu.
Chỉ trả về JSON đúng schema.`;

function userPrompt({ topic, language, durationSec, sceneCount, style, aspect }) {
  return [
    `Chủ đề: ${topic}`,
    `Ngôn ngữ lời đọc: ${language}`,
    `Thời lượng mục tiêu: khoảng ${durationSec} giây`,
    `Số cảnh: ${sceneCount}`,
    `Phong cách hình ảnh: ${style || "cinematic, photorealistic"}`,
    `Khung hình: ${aspect}`,
  ].join("\n");
}

function normalize(script, sceneCount) {
  if (!script?.scenes?.length) throw new Error("Kịch bản rỗng");
  return {
    title: String(script.title || "Video AI"),
    scenes: script.scenes.slice(0, Math.max(sceneCount, 1)).map((s) => ({
      narration: String(s.narration || "").trim(),
      visual_prompt: String(s.visual_prompt || "").trim(),
    })),
  };
}

async function anthropicScript(opts) {
  const client = new Anthropic(); // đọc ANTHROPIC_API_KEY từ môi trường
  const response = await client.beta.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: process.env.ANTHROPIC_EFFORT || "medium",
      format: { type: "json_schema", schema: SCRIPT_SCHEMA },
    },
    // Nếu bộ lọc an toàn từ chối, server tự chạy lại bằng model dự phòng phù hợp.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(opts) }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude từ chối yêu cầu: ${response.stop_details?.explanation || "vi phạm chính sách"}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Kịch bản bị cắt do vượt max_tokens");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

async function openaiScript(opts) {
  const data = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(opts) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "video_script", strict: true, schema: SCRIPT_SCHEMA } },
    }),
  });
  return JSON.parse(data.choices[0].message.content);
}

async function geminiScript(opts) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": requireEnv("GEMINI_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(opts) }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return extractJson(text);
}

async function mockScript({ topic, sceneCount, language }) {
  const vi = /viet|việt/i.test(language);
  return {
    title: topic,
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      narration: vi
        ? `Đây là lời đọc mẫu số ${i + 1} cho chủ đề ${topic}.`
        : `Scene ${i + 1}: sample narration about ${topic}.`,
      visual_prompt: `Cinematic shot ${i + 1} illustrating ${topic}`,
    })),
  };
}

export const LLM_PROVIDERS = {
  anthropic: { name: "Claude (Anthropic)", env: "ANTHROPIC_API_KEY", run: anthropicScript },
  openai: { name: "OpenAI GPT", env: "OPENAI_API_KEY", run: openaiScript },
  gemini: { name: "Google Gemini", env: "GEMINI_API_KEY", run: geminiScript },
  mock: { name: "Mock (thử nghiệm, không tốn phí)", env: null, run: mockScript },
};

export async function generateScript(providerId, opts) {
  const provider = LLM_PROVIDERS[providerId];
  if (!provider) throw new Error(`LLM provider không hợp lệ: ${providerId}`);
  return normalize(await provider.run(opts), opts.sceneCount);
}
