// Tab Frame Flow: màn hình đầu (tạo mới, mẫu, danh sách) + màn hình làm việc (chat, xem trước, render).
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
};
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const TEMPLATE_ICONS = { typography: "Aa", product: "✦", explainer: "①", brand: "◎" };
const TEMPLATE_EXAMPLES = {
  typography: "Video 20 giây: 3 con số ấn tượng về thị trường cà phê Việt Nam, chữ đập theo nhịp",
  product: "Video 25 giây giới thiệu tai nghe không dây 'Sona X', nhấn mạnh pin 40 giờ, chống ồn, giá 1.290.000đ",
  explainer: "Video 30 giây giải thích 4 bước pha cà phê phin ngon tại nhà",
  brand: "Video 25 giây kể câu chuyện thương hiệu tiệm bánh 'Mộc', làm bằng tay từ 1998, slogan 'Ngọt từ tâm'",
};

let ctx; // { api, toast, store, readAsDataUrl, getProviders }
const state = {
  catalog: null,
  template: null,
  createAttachments: [],
  chatAttachments: [],
  project: null,
  pollTimer: null,
  sig: "",
  total: 0,
  scenes: [],
  playing: false,
  clockStart: 0,
  clockOffset: 0,
};

// ---------- Chọn model ----------
function fillSelects() {
  const providers = ctx.getProviders();
  const opts = {
    "flow-llm": state.catalog.llm.map((p) => [p.id, `${p.ready ? "" : "⚠️ "}AI: ${p.name}`, p.ready]),
    "flow-image": [["none", "Không dùng ảnh AI", true], ...providers.image.map((p) => [p.id, `${p.ready ? "" : "⚠️ "}Ảnh: ${p.name}`, p.ready])],
    "flow-tts": [["none", "Không giọng đọc", true], ...providers.tts.map((p) => [p.id, `${p.ready ? "" : "⚠️ "}Giọng: ${p.name}`, p.ready])],
  };
  for (const [cls, list] of Object.entries(opts)) {
    for (const select of $$(`select.${cls}`)) {
      select.innerHTML = "";
      list.forEach(([id, name]) => select.add(new Option(name, id)));
      const saved = ctx.store.get(`flow:${select.name}`, null);
      const firstReady = list.find(([id, , ready]) => ready && id !== "mock" && id !== "none") || list.find(([, , ready]) => ready);
      select.value = list.some(([id]) => id === saved) ? saved : cls === "flow-image" ? "none" : firstReady[0];
    }
  }
  for (const input of $$("input.flow-voice")) input.value = ctx.store.get("flow:voice", "");
}

function syncSetting(e) {
  const f = e.target;
  if (!f.name || !["llm", "image", "tts", "voice"].includes(f.name)) return;
  ctx.store.set(`flow:${f.name}`, f.value);
  $$(`[name="${f.name}"].flow-${f.name}`).forEach((x) => x !== f && (x.value = f.value));
}

function settingsOf(form) {
  return { llm: form.llm.value, image: form.image.value, tts: form.tts.value, voice: form.voice.value };
}

// ---------- Đính kèm ảnh ----------
function setupAttach(form, listKey, rowId) {
  const input = $('input[type="file"]', form);
  const render = () => {
    const row = $(rowId);
    row.replaceChildren();
    state[listKey].forEach((src, i) => {
      const rm = el("button", { type: "button", textContent: "✕" });
      rm.onclick = () => {
        state[listKey].splice(i, 1);
        render();
      };
      row.append(el("div", { className: "thumb" }, el("img", { src }), rm));
    });
  };
  input.onchange = async () => {
    for (const file of input.files) {
      if (state[listKey].length >= 4) break;
      try {
        state[listKey].push(await ctx.readAsDataUrl(file, 5));
      } catch (err) {
        ctx.toast(err.message);
      }
    }
    input.value = "";
    render();
  };
  return render;
}

// ---------- Màn hình đầu ----------
function renderTemplates() {
  const box = $("#templates");
  box.replaceChildren();
  for (const t of state.catalog.templates) {
    const card = el("button", { type: "button", className: `tpl ${state.template === t.id ? "on" : ""}` },
      el("div", { className: "ic", textContent: TEMPLATE_ICONS[t.id] || "✦" }),
      el("b", { textContent: t.name }),
      el("span", { textContent: t.hint }),
    );
    card.onclick = () => {
      state.template = state.template === t.id ? null : t.id;
      const ta = $("#flowCreate textarea");
      if (state.template && !ta.value.trim()) ta.value = TEMPLATE_EXAMPLES[t.id] || "";
      renderTemplates();
      ta.focus();
    };
    box.append(card);
  }
}

async function loadHome() {
  const { projects, catalog } = await ctx.api("/api/flow");
  if (!state.catalog) {
    state.catalog = catalog;
    fillSelects();
    renderTemplates();
  }
  const box = $("#projects");
  box.replaceChildren();
  if (!projects.length) {
    box.append(el("div", { className: "empty-note", textContent: "Chưa có motion. Tạo cái đầu tiên để bắt đầu." }));
    return;
  }
  for (const p of projects) {
    const cover = el("div", { className: "cover", textContent: p.thumb ? "" : "🎞️" });
    if (p.thumb) cover.style.backgroundImage = `url("${p.thumb}")`;
    const del = el("button", { className: "del", textContent: "🗑", title: "Xoá" });
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Xoá motion "${p.title}"?`)) return;
      try {
        await ctx.api(`/api/flow/${p.id}`, { method: "DELETE" });
        loadHome();
      } catch (err) {
        ctx.toast(err.message);
      }
    };
    const status = p.status === "working" ? "⏳ đang xử lý" : p.render ? "✅ đã render" : `${p.scenes} cảnh`;
    const card = el("div", { className: "proj" }, cover, del,
      el("div", { className: "info" },
        el("b", { textContent: p.title }),
        el("small", { textContent: `${p.aspect} · ${status} · ${new Date(p.updatedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` }),
      ),
    );
    card.onclick = () => openProject(p.id);
    box.append(card);
  }
}

async function createProject(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = $(".primary", form);
  btn.disabled = true;
  try {
    const p = await ctx.api("/api/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: form.prompt.value,
        template: state.template,
        aspect: form.aspect.value,
        durationSec: Number(form.durationSec.value),
        language: form.language.value,
        attachments: state.createAttachments,
        ...settingsOf(form),
      }),
    });
    form.prompt.value = "";
    state.createAttachments = [];
    state.renderCreateAttach();
    state.template = null;
    renderTemplates();
    openProject(p.id, p);
  } catch (err) {
    ctx.toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Màn hình làm việc ----------
function showHome() {
  stop();
  clearTimeout(state.pollTimer);
  state.project = null;
  state.sig = "";
  $("#flowWork").hidden = true;
  $("#flowHome").hidden = false;
  $("#playerFrame").removeAttribute("src");
  history.replaceState(null, "", "#flow");
  loadHome();
}

async function openProject(id, initial) {
  $("#flowHome").hidden = true;
  $("#flowWork").hidden = false;
  history.replaceState(null, "", `#flow/${id}`);
  state.sig = "";
  state.project = null;
  $("#messages").replaceChildren();
  $("#renderStatus").replaceChildren();
  if (initial) renderProject(initial);
  await refresh(id);
}

async function refresh(id = state.project?.id) {
  clearTimeout(state.pollTimer);
  if (!id) return;
  try {
    const p = await ctx.api(`/api/flow/${id}`);
    if ($("#flowWork").hidden) return;
    renderProject(p);
    if (p.status === "working" || p.render?.status === "running") state.pollTimer = setTimeout(() => refresh(id), 1500);
  } catch (err) {
    ctx.toast(err.message);
  }
}

function renderProject(p) {
  const prev = state.project;
  state.project = p;
  $("#flowTitle").textContent = p.title;
  const busy = p.status === "working";
  $("#flowStatus").textContent = busy ? "Đang xử lý" : p.status === "error" ? "Lỗi" : `${p.scenes.length} cảnh · ${p.aspect}`;

  // Tin nhắn
  if (!prev || prev.messages.length !== p.messages.length || prev.id !== p.id) {
    const box = $("#messages");
    box.replaceChildren();
    for (const m of p.messages) {
      const bubble = el("div", { className: `msg ${m.role}` }, m.text);
      if (m.attachments?.length) {
        const row = el("div", { className: "attach-row" });
        m.attachments.forEach((src) => row.append(el("div", { className: "thumb" }, el("img", { src }))));
        bubble.append(row);
      }
      bubble.append(el("time", { textContent: new Date(m.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) }));
      box.append(bubble);
    }
    box.scrollTop = box.scrollHeight;
  }
  $("#working").hidden = !busy;
  $("#workingText").textContent = `${p.step || "Đang xử lý"}… ${p.progress ? p.progress + "%" : ""}`;
  $('#chatForm button[type="submit"]').disabled = busy;

  // Cài đặt hiện tại của dự án
  const form = $("#chatForm");
  for (const k of ["llm", "image", "tts"]) if ([...form[k].options].some((o) => o.value === p[k])) form[k].value = p[k];
  form.voice.value = p.voice || "";

  // Xem trước: chỉ tải lại khi nội dung cảnh đổi.
  const sig = JSON.stringify([p.aspect, p.theme, p.voiceTrack, p.scenes.map((s) => [s.duration, s.html, s.css, s.js, s.image?.url])]);
  if (sig !== state.sig && !busy) {
    state.sig = sig;
    loadPlayer(p);
  }
  $("#undoBtn").disabled = busy || !p.versions.length;
  $("#undoBtn").textContent = `↩ Hoàn tác${p.versions.length ? ` (${p.versions.length})` : ""}`;
  renderRender(p);
}

function loadPlayer(p) {
  stop();
  const frame = $("#playerFrame");
  $("#stageEmpty").hidden = p.scenes.length > 0;
  $("#playerErrors").hidden = true;
  state.total = p.scenes.reduce((n, s) => n + s.duration, 0);
  state.scenes = [];
  let t = 0;
  for (const s of p.scenes) {
    state.scenes.push({ start: t, dur: s.duration, narration: s.narration });
    t += s.duration;
  }
  renderStrip();
  if (!p.scenes.length) {
    frame.removeAttribute("src");
    return;
  }
  frame.src = `/flow/${p.id}/player?mode=preview&v=${Date.now()}`;
  const audio = $("#voiceAudio");
  if (p.voiceTrack) audio.src = p.voiceTrack;
  else audio.removeAttribute("src");
  seekTo(0);
}

function renderStrip() {
  const strip = $("#sceneStrip");
  strip.replaceChildren();
  state.scenes.forEach((s, i) => {
    const chip = el("button", { type: "button", className: "scene-chip" },
      el("b", { textContent: `Cảnh ${i + 1} · ${s.dur.toFixed(1)}s` }),
      el("span", { textContent: s.narration || "(không lời)" }),
    );
    chip.onclick = () => seekTo(s.start + 0.01);
    strip.append(chip);
  });
}

// ---------- Phát / tua (âm thanh ở trang chính, iframe chỉ nhận thời gian) ----------
function currentTime() {
  const audio = $("#voiceAudio");
  if (state.playing) return audio.src ? audio.currentTime : state.clockOffset + (performance.now() - state.clockStart) / 1000;
  return state.clockOffset;
}

function postSeek(t) {
  $("#playerFrame").contentWindow?.postMessage({ cmd: "seek", t }, "*");
  $("#seek").value = state.total ? Math.round((t / state.total) * 1000) : 0;
  $("#timeLabel").textContent = `${fmt(t)} / ${fmt(state.total)}`;
  const idx = state.scenes.findIndex((s) => t >= s.start && t < s.start + s.dur);
  $$(".scene-chip").forEach((c, i) => c.classList.toggle("on", i === idx));
}

function seekTo(t) {
  t = Math.max(0, Math.min(t, state.total));
  state.clockOffset = t;
  state.clockStart = performance.now();
  const audio = $("#voiceAudio");
  if (audio.src) audio.currentTime = t;
  postSeek(t);
}

function tick() {
  if (!state.playing) return;
  const t = currentTime();
  if (t >= state.total) {
    stop();
    seekTo(state.total);
    return;
  }
  postSeek(t);
  requestAnimationFrame(tick);
}

function play() {
  if (!state.total) return;
  if (currentTime() >= state.total - 0.05) seekTo(0);
  state.playing = true;
  state.clockStart = performance.now();
  const audio = $("#voiceAudio");
  if (audio.src) {
    audio.currentTime = state.clockOffset;
    audio.play().catch(() => {});
  }
  $("#playBtn").textContent = "❚❚";
  requestAnimationFrame(tick);
}

function stop() {
  if (state.playing) state.clockOffset = currentTime();
  state.playing = false;
  $("#voiceAudio").pause();
  $("#playBtn").textContent = "▶";
}

// ---------- Chat ----------
async function sendChat(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const text = form.text.value.trim();
  if (!text || !state.project) return;
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  try {
    const p = await ctx.api(`/api/flow/${state.project.id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments: state.chatAttachments, settings: settingsOf(form) }),
    });
    form.text.value = "";
    state.chatAttachments = [];
    state.renderChatAttach();
    renderProject(p);
    refresh(p.id);
  } catch (err) {
    ctx.toast(err.message);
    btn.disabled = false;
  }
}

// ---------- Render ----------
function renderRender(p) {
  const box = $("#renderStatus");
  const r = p.render || { status: "none" };
  const busy = p.status === "working" || r.status === "running";
  $("#renderBtn").disabled = busy || !p.scenes.length;
  const key = `${r.status}:${r.progress}:${r.url}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  if (r.status === "running") {
    const bar = el("div", { className: "bar" }, el("i"));
    bar.firstChild.style.width = `${r.progress || 1}%`;
    box.append(el("small", { className: "note", textContent: `Đang render ${r.quality}… ${r.progress || 0}% (video dài thì lâu hơn, cứ để trang mở)` }), bar);
  } else if (r.status === "done") {
    box.append(
      el("video", { src: r.url, controls: true, playsInline: true }),
      el("div", { className: "viewer-links" }, el("a", { className: "btn accent", href: r.url, download: `${p.title}.mp4`, textContent: "⬇ Tải video MP4" })),
    );
  } else if (r.status === "error") {
    box.append(el("p", { className: "error", textContent: `Render lỗi: ${r.error}` }));
  }
}

async function startRender() {
  if (!state.project) return;
  stop();
  try {
    const p = await ctx.api(`/api/flow/${state.project.id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality: $("#renderQuality").value }),
    });
    renderProject(p);
    refresh(p.id);
  } catch (err) {
    ctx.toast(err.message);
  }
}

async function undo() {
  if (!state.project) return;
  try {
    renderProject(await ctx.api(`/api/flow/${state.project.id}/undo`, { method: "POST" }));
  } catch (err) {
    ctx.toast(err.message);
  }
}

// ---------- Khởi động ----------
export function initFlow(context) {
  ctx = context;
  state.renderCreateAttach = setupAttach($("#flowCreate"), "createAttachments", "#createAttachments");
  state.renderChatAttach = setupAttach($("#chatForm"), "chatAttachments", "#chatAttachments");
  $("#flowCreate").addEventListener("submit", createProject);
  $("#chatForm").addEventListener("submit", sendChat);
  $("#chatForm textarea").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("#chatForm").requestSubmit();
    }
  });
  document.addEventListener("change", syncSetting);
  $("#flowBack").onclick = showHome;
  $("#playBtn").onclick = () => (state.playing ? stop() : play());
  $("#seek").addEventListener("input", (e) => {
    const t = (Number(e.target.value) / 1000) * state.total;
    const wasPlaying = state.playing;
    stop();
    seekTo(t);
    if (wasPlaying) play();
  });
  $("#renderBtn").onclick = startRender;
  $("#undoBtn").onclick = undo;
  addEventListener("message", (e) => {
    if (e.source !== $("#playerFrame").contentWindow || e.data?.source !== "flow-player") return;
    if (e.data.type === "ready") {
      if (e.data.errors?.length) {
        $("#playerErrors").textContent = `⚠️ Lỗi code hoạt hình: ${e.data.errors.slice(0, 3).join(" | ")}`;
        $("#playerErrors").hidden = false;
      }
      postSeek(state.clockOffset);
    }
  });
}

export function showFlow(route) {
  const id = route?.split("/")[1];
  if (id) openProject(id).catch(() => showHome());
  else showHome();
}

export function hideFlow() {
  stop();
  clearTimeout(state.pollTimer);
}
