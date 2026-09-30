// Kiểm tra code hoạt hình và render ra mp4 bằng trình duyệt ẩn + ffmpeg.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { FFMPEG, mixMusic } from "../ffmpeg.js";
import { launchBrowser } from "./browser.js";
import { STAGES, timeline } from "./player.js";

const FPS = 30;
const QUALITY_SCALE = { "1080p": 1, "720p": 2 / 3 };

/** Chỉ cho trang hoạt hình tải tài nguyên của app và font Google. */
async function lockDown(page, baseUrl) {
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(baseUrl) || u.startsWith("https://fonts.googleapis.com/") || u.startsWith("https://fonts.gstatic.com/") || u.startsWith("data:")) {
      return route.continue();
    }
    return route.abort();
  });
}

async function openPlayer(browser, project, baseUrl, scale) {
  const { w, h } = STAGES[project.aspect] || STAGES["9:16"];
  const page = await browser.newPage({ viewport: { width: Math.round(w * scale), height: Math.round(h * scale) } });
  page.on("pageerror", () => {}); // lỗi đã được gom trong window.__errors
  await lockDown(page, baseUrl);
  await page.goto(`${baseUrl}/flow/${project.id}/player?mode=render&scale=${scale}&v=${Date.now()}`, { waitUntil: "load", timeout: 60000 });
  await page.evaluate(() => window.__ready);
  return page;
}

/** Chạy thử toàn bộ hoạt hình, trả về danh sách lỗi (rỗng = ổn). */
export async function validateProject(project, baseUrl) {
  const browser = await launchBrowser();
  try {
    const page = await openPlayer(browser, project, baseUrl, 0.25);
    const { list } = timeline(project.scenes);
    for (const s of list) {
      for (const f of [0.1, 0.5, 0.95]) await page.evaluate((t) => window.__seek(t), s.start + s.dur * f);
    }
    return await page.evaluate(() => [...new Set(window.__errors)]);
  } finally {
    await browser.close();
  }
}

export async function renderProject(project, { baseUrl, voiceTrack, dest, quality = "1080p", music, onProgress = () => {} }) {
  const scale = QUALITY_SCALE[quality] || 1;
  const { total } = timeline(project.scenes);
  const frames = Math.ceil(total * FPS);
  const browser = await launchBrowser();
  const tmp = dest.replace(/\.mp4$/, ".tmp.mp4");
  try {
    const page = await openPlayer(browser, project, baseUrl, scale);
    const errors = await page.evaluate(() => [...new Set(window.__errors)]);
    if (errors.length) throw new Error(`Code hoạt hình lỗi: ${errors.slice(0, 3).join(" | ")}`);

    const audioIn = voiceTrack ? ["-i", voiceTrack] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
    const ff = spawn(FFMPEG, [
      "-hide_banner", "-y",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      ...audioIn,
      "-map", "0:v", "-map", "1:a",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k",
      "-t", total.toFixed(3), "-movflags", "+faststart",
      music ? tmp : dest,
    ]);
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const done = new Promise((resolve, reject) => {
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg lỗi: ${stderr.slice(-800)}`))));
    });
    const write = (buf) => new Promise((resolve, reject) => ff.stdin.write(buf, (err) => (err ? reject(err) : resolve())));

    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => window.__seek(t), i / FPS);
      await write(await page.screenshot({ type: "jpeg", quality: 90 }));
      if (i % 15 === 0) onProgress(Math.round((i / frames) * 100));
    }
    ff.stdin.end();
    await done;
    if (music) {
      await mixMusic({ video: tmp, music, dest, volume: Number(process.env.BACKGROUND_MUSIC_VOLUME || 0.15) });
      await fs.rm(tmp, { force: true });
    }
    onProgress(100);
    return dest;
  } finally {
    await browser.close();
  }
}
