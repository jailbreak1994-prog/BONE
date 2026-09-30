// Bước 3: chuyển lời đọc thành giọng nói (mp3).
import { fetchToFile, requireEnv } from "../util.js";
import { silentAudio } from "../ffmpeg.js";

async function openaiTts({ text, voice, dest }) {
  return fetchToFile("https://api.openai.com/v1/audio/speech", dest, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: voice || process.env.OPENAI_TTS_VOICE || "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
}

async function elevenlabsTts({ text, voice, dest }) {
  const voiceId = voice || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  return fetchToFile(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, dest, {
    method: "POST",
    headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
    }),
  });
}

/** Không gọi API: tạo khoảng lặng với độ dài ước tính theo số từ (~2.5 từ/giây). */
async function mockTts({ text, dest }) {
  const words = text.split(/\s+/).filter(Boolean).length;
  await silentAudio(dest, Math.max(2, words / 2.5).toFixed(2));
  return dest;
}

export const TTS_PROVIDERS = {
  openai: { name: "OpenAI TTS", env: "OPENAI_API_KEY", run: openaiTts },
  elevenlabs: { name: "ElevenLabs (đa ngôn ngữ)", env: "ELEVENLABS_API_KEY", run: elevenlabsTts },
  mock: { name: "Mock (im lặng)", env: null, run: mockTts },
};

export async function generateSpeech(providerId, opts) {
  const provider = TTS_PROVIDERS[providerId];
  if (!provider) throw new Error(`TTS provider không hợp lệ: ${providerId}`);
  return provider.run(opts);
}
