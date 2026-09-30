// Dựng trang HTML "sân khấu" cho một dự án Frame Flow.
// Trang này dùng cho cả xem trước (trong iframe sandbox) và render (trình duyệt ẩn chụp từng khung hình).
// Mỗi cảnh = HTML + CSS + một hàm JS nhận timeline GSAP để tạo chuyển động.

export const STAGES = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
};

// Font Google hỗ trợ tiếng Việt (và Thái với Prompt / Kanit / Noto Sans Thai).
export const FONTS = [
  "Be Vietnam Pro", "Montserrat", "Inter", "Playfair Display", "Anton", "Oswald", "Prompt", "Kanit", "Noto Sans Thai",
];

const TRANSPARENT_PX = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const escScript = (s) => String(s || "").replace(/<\/script/gi, "<\\/script");
const escStyle = (s) => String(s || "").replace(/<\/style/gi, "<\\/style");
const cssUrl = (u) => `url("${String(u).replace(/"/g, "%22")}")`;

/** Lịch thời gian: mỗi cảnh bắt đầu ngay sau cảnh trước. */
export function timeline(scenes) {
  let t = 0;
  const list = scenes.map((s) => {
    const item = { start: t, dur: s.duration };
    t += s.duration;
    return item;
  });
  return { list, total: t };
}

export function buildPlayerHtml(project, { mode = "preview", scale = 1 } = {}) {
  const aspect = STAGES[project.aspect] ? project.aspect : "9:16";
  const { w, h } = STAGES[aspect];
  const theme = project.theme || {};
  const font = FONTS.includes(theme.font) ? theme.font : "Be Vietnam Pro";
  const { list, total } = timeline(project.scenes);

  const sceneMarkup = project.scenes
    .map((s, i) => {
      const img = s.image?.url || "";
      const html = String(s.html || "").replaceAll("{{IMAGE}}", img || TRANSPARENT_PX);
      const style = img ? ` style='--scene-image:${cssUrl(img)}'` : " style='--scene-image:none'";
      return `<section class="scene" id="scene-${i}"${style}>${html}</section>`;
    })
    .join("\n");

  // CSS của từng cảnh được lồng trong #scene-N (CSS nesting) để không ảnh hưởng cảnh khác.
  const sceneCss = project.scenes.map((s, i) => `#scene-${i} {\n${escStyle(s.css)}\n}`).join("\n");

  const sceneScripts = project.scenes
    .map(
      (s, i) => `<script>
window.__fns[${i}] = function ({ tl, el, dur, q, gsap, W, H }) {
${escScript(s.js)}
};
</script>`,
    )
    .join("\n");

  const fontParam = encodeURIComponent(font).replace(/%20/g, "+");
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fontParam}:wght@400;500;700;800;900&display=block" />
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #stage {
    position: absolute; left: 0; top: 0; width: ${w}px; height: ${h}px; overflow: hidden;
    transform-origin: 0 0; transform: scale(${scale});
    --bg: ${theme.bg || "#0b0b10"}; --primary: ${theme.primary || "#c5f02c"}; --accent: ${theme.accent || "#22d3ee"};
    --text: ${theme.text || "#ffffff"}; --font: "${font}", system-ui, sans-serif;
    --W: ${w}px; --H: ${h}px;
    background: var(--bg); color: var(--text); font-family: var(--font);
  }
  .scene { position: absolute; inset: 0; overflow: hidden; visibility: hidden; }
  .scene * { box-sizing: border-box; }
${escStyle(sceneCss)}
</style>
</head>
<body>
<div id="stage">
${sceneMarkup}
</div>
<script>window.__fns = []; window.__errors = [];
window.addEventListener("error", (e) => window.__errors.push(String(e.message || e)));</script>
<script src="/vendor/gsap.min.js"></script>
${sceneScripts}
<script>
(() => {
  const MODE = ${JSON.stringify(mode)};
  const SCENES = ${JSON.stringify(list)};
  const TOTAL = ${JSON.stringify(total)};
  const errors = window.__errors;
  const post = (msg) => { try { parent.postMessage({ source: "flow-player", ...msg }, "*"); } catch {} };
  if (!window.gsap) { errors.push("Không tải được thư viện chuyển động GSAP"); post({ type: "ready", errors, total: TOTAL }); return; }

  const master = gsap.timeline({ paused: true });
  SCENES.forEach((s, i) => {
    const el = document.getElementById("scene-" + i);
    master.set(el, { visibility: "visible" }, s.start);
    if (i < SCENES.length - 1) master.set(el, { visibility: "hidden" }, s.start + s.dur);
    const tl = gsap.timeline();
    const fn = window.__fns[i];
    if (typeof fn !== "function") errors.push("Cảnh " + (i + 1) + ": code bị lỗi cú pháp");
    else {
      try { fn({ tl, el, dur: s.dur, q: gsap.utils.selector(el), gsap, W: ${w}, H: ${h} }); }
      catch (e) { errors.push("Cảnh " + (i + 1) + ": " + e.message); }
    }
    master.add(tl, s.start);
  });
  master.set({}, {}, TOTAL);

  window.__seek = (t) => { master.seek(Math.max(0, Math.min(t, TOTAL - 0.0001)), false); };
  window.__total = TOTAL;

  // Chờ font và ảnh tải xong trước khi báo sẵn sàng.
  const imgs = [...document.images].map((img) => img.decode ? img.decode().catch(() => {}) : null);
  const bgs = [...document.querySelectorAll(".scene")].map((sc) => {
    const m = sc.getAttribute("style")?.match(/url\\("([^"]+)"\\)/);
    if (!m) return null;
    return new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = m[1]; });
  });
  const timeout = new Promise((r) => setTimeout(r, 8000));
  window.__ready = Promise.race([Promise.all([document.fonts.ready, ...imgs, ...bgs]), timeout]).then(() => {
    window.__seek(0);
    return true;
  });

  if (MODE === "preview") {
    const fit = () => {
      const s = Math.min(innerWidth / ${w}, innerHeight / ${h});
      const stage = document.getElementById("stage");
      stage.style.transform = "scale(" + s + ")";
      stage.style.left = (innerWidth - ${w} * s) / 2 + "px";
      stage.style.top = (innerHeight - ${h} * s) / 2 + "px";
    };
    addEventListener("resize", fit);
    fit();
    addEventListener("message", (e) => {
      if (e.data?.cmd === "seek") window.__seek(e.data.t);
    });
    window.__ready.then(() => post({ type: "ready", errors, total: TOTAL, scenes: SCENES }));
  }
})();
</script>
</body>
</html>`;
}
