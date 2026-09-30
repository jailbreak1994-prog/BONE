// Pipeline tạo video: kịch bản → hình ảnh/video → giọng đọc → dựng cảnh → ghép + phụ đề.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { generateScript, LLM_PROVIDERS } from "./providers/llm.js";
import { generateImage, IMAGE_PROVIDERS } from "./providers/image.js";
import { generateVideo, VIDEO_PROVIDERS } from "./providers/video.js";
import { generateSpeech, TTS_PROVIDERS } from "./providers/tts.js";
import { SIZES, concatScenes, getDuration, mixMusic, renderScene } from "./ffmpeg.js";
import { mapLimit } from "./util.js";

export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || "output");
const CONCURRENCY = Number(process.env.SCENE_CONCURRENCY || 3);

export const DEFAULTS = {
  topic: "",
  language: "Tiếng Việt",
  durationSec: 30,
  sceneCount: 5,
  aspect: "9:16",
  style: "cinematic, photorealistic, soft lighting",
  visualMode: "image", // "image" = ảnh AI + hiệu ứng Ken Burns, "video" = clip video AI
  llm: "anthropic",
  image: "openai",
  video: "runway",
  tts: "openai",
  voice: "",
  subtitles: true,
};

function listProviders(registry) {
  return Object.entries(registry).map(([id, p]) => ({
    id,
    name: p.name,
    ready: !p.env || Boolean(process.env[p.env]),
    env: p.env,
  }));
}

export function providerCatalog() {
  return {
    llm: listProviders(LLM_PROVIDERS),
    image: listProviders(IMAGE_PROVIDERS),
    video: listProviders(VIDEO_PROVIDERS),
    tts: listProviders(TTS_PROVIDERS),
  };
}

export function validateOptions(input) {
  const opts = { ...DEFAULTS, ...input };
  opts.topic = String(opts.topic || "").trim();
  if (!opts.topic) throw new Error("Vui lòng nhập chủ đề video");
  if (!SIZES[opts.aspect]) throw new Error(`Khung hình không hợp lệ: ${opts.aspect}`);
  opts.durationSec = Math.min(Math.max(Number(opts.durationSec) || 30, 5), 600);
  opts.sceneCount = Math.min(Math.max(Math.round(Number(opts.sceneCount) || 5), 1), 30);
  opts.subtitles = opts.subtitles !== false && opts.subtitles !== "false";
  if (!["image", "video"].includes(opts.visualMode)) throw new Error("visualMode phải là image hoặc video");
  for (const [kind, registry] of [["llm", LLM_PROVIDERS], ["image", IMAGE_PROVIDERS], ["tts", TTS_PROVIDERS]]) {
    if (!registry[opts[kind]]) throw new Error(`Provider ${kind} không hợp lệ: ${opts[kind]}`);
  }
  if (opts.visualMode === "video" && !VIDEO_PROVIDERS[opts.video]) throw new Error(`Provider video không hợp lệ: ${opts.video}`);
  return opts;
}

// ---------- Phụ đề SRT ----------
function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

/** Chia lời đọc mỗi cảnh thành các câu ngắn, phân bổ thời gian theo độ dài ký tự. */
export function buildSrt(scenes) {
  const cues = [];
  let t = 0;
  for (const scene of scenes) {
    // Tách theo câu; câu dài (>80 ký tự) tách tiếp theo dấu phẩy.
    const chunks = scene.narration
      .split(/(?<=[.!?…;:])\s+/)
      .flatMap((s) => (s.length > 80 ? s.split(/(?<=,)\s+/) : [s]))
      .map((c) => c.trim())
      .filter(Boolean);
    const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
    const speech = scene.speechDuration ?? scene.duration;
    let cursor = t;
    for (const chunk of chunks) {
      const len = (chunk.length / total) * speech;
      cues.push({ start: cursor, end: cursor + len, text: chunk });
      cursor += len;
    }
    t += scene.duration;
  }
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

// ---------- Job ----------
export function newJob(options) {
  const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}`;
  return {
    id,
    options,
    status: "queued", // queued | running | done | error
    step: "Đang chờ",
    progress: 0,
    logs: [],
    script: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
}

export async function runJob(job, onUpdate = () => {}) {
  const opts = job.options;
  const dir = path.join(OUTPUT_DIR, job.id);
  const size = SIZES[opts.aspect];
  await fs.mkdir(dir, { recursive: true });

  const update = (patch, log) => {
    Object.assign(job, patch);
    if (log) job.logs.push(`[${new Date().toLocaleTimeString("vi-VN")}] ${log}`);
    onUpdate(job);
  };

  try {
    update({ status: "running", step: "Viết kịch bản", progress: 5 }, `Viết kịch bản bằng ${LLM_PROVIDERS[opts.llm].name}…`);
    const script = await generateScript(opts.llm, opts);
    await fs.writeFile(path.join(dir, "script.json"), JSON.stringify(script, null, 2));
    update({ script, progress: 15 }, `Kịch bản "${script.title}" – ${script.scenes.length} cảnh`);

    // Tạo hình ảnh/video + giọng đọc cho từng cảnh (song song có giới hạn).
    const n = script.scenes.length;
    let finished = 0;
    const videoProvider = opts.visualMode === "video" ? VIDEO_PROVIDERS[opts.video] : null;
    const needImage = !videoProvider || videoProvider.needsImage || videoProvider.usesImage;
    update({ step: "Tạo hình ảnh, video & giọng đọc" });

    const assets = await mapLimit(script.scenes, CONCURRENCY, async (scene, i) => {
      const tag = `Cảnh ${i + 1}/${n}`;
      const audio = path.join(dir, `scene${i + 1}.mp3`);
      const speechTask = generateSpeech(opts.tts, { text: scene.narration, voice: opts.voice, dest: audio });

      const prompt = `${scene.visual_prompt}. Style: ${opts.style}.`;
      let visual = null;
      let visualType = "image";
      if (needImage) {
        visual = await generateImage(opts.image, {
          prompt, aspect: opts.aspect, size, index: i, dest: path.join(dir, `scene${i + 1}.png`),
        });
        update({}, `${tag}: đã tạo ảnh`);
      }
      if (videoProvider) {
        try {
          visual = await generateVideo(opts.video, {
            prompt, image: visual, aspect: opts.aspect, dest: path.join(dir, `scene${i + 1}.clip.mp4`),
          });
          visualType = "video";
          update({}, `${tag}: đã tạo video clip`);
        } catch (err) {
          if (!visual) throw err;
          update({}, `${tag}: tạo video lỗi (${err.message.slice(0, 200)}) → dùng ảnh tĩnh`);
        }
      }
      await speechTask;
      const speechDuration = await getDuration(audio);
      finished++;
      update({ progress: 15 + Math.round((finished / n) * 60) }, `${tag}: đã tạo giọng đọc (${speechDuration.toFixed(1)}s)`);
      return { visual, visualType, audio, speechDuration, duration: speechDuration + 0.5 };
    });

    update({ step: "Dựng từng cảnh" }, "Dựng cảnh bằng ffmpeg…");
    const clips = [];
    for (let i = 0; i < n; i++) {
      const dest = path.join(dir, `scene${i + 1}.render.mp4`);
      await renderScene({ ...assets[i], size, dest, sceneIndex: i });
      clips.push(dest);
      update({ progress: 75 + Math.round(((i + 1) / n) * 15) });
    }

    update({ step: "Ghép video & phụ đề" }, "Ghép các cảnh…");
    const scenesWithTiming = script.scenes.map((s, i) => ({ ...s, ...assets[i] }));
    const srtPath = path.join(dir, "subtitles.srt");
    await fs.writeFile(srtPath, buildSrt(scenesWithTiming));
    const final = path.join(dir, "video.mp4");
    const music = process.env.BACKGROUND_MUSIC;
    if (music) {
      const raw = path.join(dir, "video.nomusic.mp4");
      await concatScenes({ scenes: clips, srt: opts.subtitles ? srtPath : null, dest: raw, workDir: dir });
      await mixMusic({ video: raw, music, dest: final, volume: Number(process.env.BACKGROUND_MUSIC_VOLUME || 0.15) });
    } else {
      await concatScenes({ scenes: clips, srt: opts.subtitles ? srtPath : null, dest: final, workDir: dir });
    }

    const duration = await getDuration(final);
    const base = `/output/${job.id}`;
    update(
      {
        status: "done",
        step: "Hoàn tất",
        progress: 100,
        result: { video: `${base}/video.mp4`, subtitles: `${base}/subtitles.srt`, script: `${base}/script.json`, duration },
      },
      `Xong! Video dài ${duration.toFixed(1)}s`,
    );
  } catch (err) {
    update({ status: "error", error: err.message, step: "Lỗi" }, `LỖI: ${err.message}`);
  } finally {
    await fs.writeFile(path.join(dir, "job.json"), JSON.stringify(job, null, 2)).catch(() => {});
  }
  return job;
}
