import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Ưu tiên FFMPEG_PATH → ffmpeg-static (đi kèm npm) → ffmpeg trong PATH. */
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require("ffmpeg-static");
    if (p) return p;
  } catch {}
  return "ffmpeg";
}

export const FFMPEG = resolveFfmpeg();

export const SIZES = {
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
  "1:1": { w: 1080, h: 1080 },
  "4:3": { w: 1024, h: 768 },
  "3:4": { w: 768, h: 1024 },
};

const FPS = 30;

export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-y", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => reject(new Error(`Không chạy được ffmpeg (${FFMPEG}): ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg lỗi (code ${code}): ${stderr.slice(-1500)}`));
    });
  });
}

/** Lấy thời lượng (giây) của file media bằng cách đọc dòng "Duration:" của ffmpeg. */
export async function getDuration(file) {
  const stderr = await new Promise((resolve) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-i", file]);
    let out = "";
    proc.stderr.on("data", (d) => (out += d));
    proc.on("close", () => resolve(out));
    proc.on("error", () => resolve(out));
  });
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`Không đọc được thời lượng của ${path.basename(file)}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function silentAudio(dest, seconds) {
  return runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(seconds), "-c:a", "libmp3lame", dest]);
}

/** Ảnh nền màu đặc – dùng cho provider "mock" để thử pipeline không tốn API. */
export function solidImage(dest, color, { w, h }) {
  return runFfmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=${w}x${h}`, "-frames:v", "1", dest]);
}

/** Clip mẫu (không gọi API): ảnh đầu vào chuyển động nhẹ, hoặc hình test màu. */
export function mockClip(dest, { w, h }, seconds, image) {
  const out = ["-t", String(seconds), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", dest];
  if (image) {
    const frames = Math.ceil(seconds * 30);
    const vf = `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
      `zoompan=z='min(zoom+0.001,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30`;
    return runFfmpeg(["-i", image, "-vf", vf, ...out]);
  }
  return runFfmpeg(["-f", "lavfi", "-i", `testsrc2=s=${w}x${h}:r=30`, ...out]);
}

/**
 * Dựng một cảnh: hình ảnh (hiệu ứng Ken Burns) hoặc video clip (lặp/cắt)
 * + giọng đọc, xuất ra mp4 có cùng codec/kích thước để ghép nhanh.
 */
export async function renderScene({ visual, visualType, audio, duration, size, dest, sceneIndex = 0 }) {
  const { w, h } = size;
  const frames = Math.ceil(duration * FPS);
  const common = [
    "-map", "0:v", "-map", "1:a",
    "-af", "apad",
    "-t", duration.toFixed(3),
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    dest,
  ];

  if (visualType === "video") {
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},setsar=1`;
    return runFfmpeg(["-stream_loop", "-1", "-i", visual, "-i", audio, "-vf", vf, ...common]);
  }

  // Luân phiên zoom vào / zoom ra để các cảnh không đơn điệu.
  const zoomIn = sceneIndex % 2 === 0;
  const z = zoomIn ? "min(zoom+0.0007,1.2)" : `if(eq(on,0),1.2,max(zoom-0.0007,1.0))`;
  const vf = [
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase`,
    `crop=${w * 2}:${h * 2}`,
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS}`,
    "setsar=1",
  ].join(",");
  return runFfmpeg(["-i", visual, "-i", audio, "-vf", vf, ...common]);
}

/** Ghép các cảnh (cùng định dạng) + gắn phụ đề mềm (SRT). */
export async function concatScenes({ scenes, srt, dest, workDir }) {
  const list = path.join(workDir, "concat.txt");
  await fs.writeFile(list, scenes.map((s) => `file '${path.resolve(s).replace(/'/g, "'\\''")}'`).join("\n"));
  const args = ["-f", "concat", "-safe", "0", "-i", list];
  if (srt) args.push("-i", srt, "-map", "0", "-map", "1", "-c:s", "mov_text", "-metadata:s:s:0", "language=vie");
  args.push("-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", dest);
  return runFfmpeg(args);
}

/** Trộn nhạc nền (lặp lại, giảm âm lượng) vào video đã ghép. */
export async function mixMusic({ video, music, dest, volume = 0.15 }) {
  return runFfmpeg([
    "-i", video, "-stream_loop", "-1", "-i", music,
    "-filter_complex", `[1:a]volume=${volume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]`,
    "-map", "0:v", "-map", "[a]", "-map", "0:s?",
    "-c:v", "copy", "-c:s", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    dest,
  ]);
}
