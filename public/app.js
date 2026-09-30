const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TITLES = { auto: "Auto Video", image: "Ảnh", video: "Video", audio: "Giọng đọc" };
const KIND_OF_SELECT = { image: "image", video: "video", tts: "tts", llm: "llm" };

const state = {
  tab: "image",
  providers: null,
  items: [],
  sort: "new",
  search: "",
  refs: [], // ảnh tham chiếu: data URL hoặc /output/...
  frames: { firstFrame: null, lastFrame: null },
};

// ---------- Tiện ích ----------
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function showError(msg) {
  $("#formError").textContent = msg || "";
  $("#formError").hidden = !msg;
}

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error("Chỉ nhận ảnh PNG / JPG / WEBP"));
    if (file.size > 10 * 1024 * 1024) return reject(new Error("Mỗi ảnh tối đa 10MB"));
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const ratio = (aspect) => (aspect || "1:1").replace(":", " / ");
const timeAgo = (iso) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
};

// ---------- Provider ----------
function provider(kind, id) {
  return state.providers?.[kind]?.find((p) => p.id === id);
}

function fillModelSelects() {
  for (const select of $$("select.model")) {
    const kind = KIND_OF_SELECT[select.dataset.kind];
    const list = state.providers[kind];
    select.innerHTML = "";
    for (const p of list) {
      const opt = new Option(`${p.ready ? "" : "⚠️ "}${p.name}`, p.id);
      if (!p.ready) opt.title = `Cần ${p.env} trong file .env`;
      select.add(opt);
    }
    select.value = (list.find((p) => p.ready && p.id !== "mock") || list.find((p) => p.ready) || list[0]).id;
  }
}

function applyProviderUI() {
  // Ảnh: tham chiếu + chất lượng
  const imgForm = $('[data-tool="image"]');
  const ip = provider("image", imgForm.model.value) || {};
  $$("[data-show=supportsRefs]", imgForm).forEach((n) => (n.hidden = !ip.supportsRefs));
  $$("[data-hide=supportsRefs]", imgForm).forEach((n) => (n.hidden = !!ip.supportsRefs));
  $$("[data-show=qualities]", imgForm).forEach((n) => (n.hidden = !ip.qualities));

  // Video: thời lượng + ảnh đầu/cuối
  const vidForm = $('[data-tool="video"]');
  const vp = provider("video", vidForm.model.value) || {};
  const durSel = $("#durations");
  const prevDur = durSel.value;
  durSel.innerHTML = "";
  for (const d of vp.durations || [5]) durSel.add(new Option(`${d}s`, d));
  if ([...durSel.options].some((o) => o.value === prevDur)) durSel.value = prevDur;
  $('[data-frame="firstFrame"]').classList.toggle("off", !vp.firstFrame);
  $('[data-frame="lastFrame"]').classList.toggle("off", !vp.lastFrame);

  // Giọng đọc: danh sách giọng hoặc ô nhập voice_id
  const audForm = $('[data-tool="audio"]');
  const ap = provider("tts", audForm.model.value) || {};
  const voiceSel = $("#voiceSelect");
  const voices = ap.voices || [];
  voiceSel.innerHTML = "";
  voices.forEach((v) => voiceSel.add(new Option(v, v)));
  const savedVoice = store.get("form:audio", {}).voice;
  if (voices.includes(savedVoice)) voiceSel.value = savedVoice;
  voiceSel.hidden = !voices.length;
  $("#voiceInput").hidden = voices.length > 0 || ap.id === "mock";

  // Auto: chỉ hiện ô tạo video khi chọn chế độ video
  const autoForm = $('[data-tool="auto"]');
  $$("[data-mode=video]", autoForm).forEach((n) => (n.hidden = autoForm.visualMode.value !== "video"));
}

// ---------- Lưu / khôi phục form ----------
function saveForm(form) {
  const data = {};
  for (const f of form.elements) {
    if (!f.name || f.type === "file") continue;
    data[f.name] = f.type === "checkbox" ? f.checked : f.value;
  }
  store.set(`form:${form.dataset.tool}`, data);
}

function restoreForm(form) {
  const data = store.get(`form:${form.dataset.tool}`, {});
  for (const [name, value] of Object.entries(data)) {
    const f = form.elements[name];
    if (!f || f instanceof RadioNodeList) continue;
    if (f.type === "checkbox") f.checked = value;
    else if (f.tagName !== "SELECT" || [...f.options].some((o) => o.value === value)) f.value = value;
  }
}

// ---------- Tab ----------
function setTab(tab) {
  if (!TITLES[tab]) tab = "image";
  state.tab = tab;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $$(".tool").forEach((f) => f.classList.toggle("on", f.dataset.tool === tab));
  history.replaceState(null, "", `#${tab}`);
  showError("");
  state.items = [];
  renderGallery();
  loadItems();
}

// ---------- Ảnh tham chiếu ----------
function renderRefs() {
  const box = $("#refs");
  box.innerHTML = "";
  state.refs.forEach((src, i) => {
    const rm = el("button", { type: "button", textContent: "✕", title: "Bỏ ảnh" });
    rm.onclick = () => {
      state.refs.splice(i, 1);
      renderRefs();
    };
    box.append(el("div", { className: "thumb" }, el("img", { src }), rm));
  });
  $("#refCount").textContent = `${state.refs.length}/8`;
  $("#refDrop").hidden = state.refs.length >= 8;
}

async function addRefFiles(files) {
  for (const file of files) {
    if (state.refs.length >= 8) break;
    try {
      state.refs.push(await readAsDataUrl(file));
    } catch (err) {
      toast(err.message);
    }
  }
  renderRefs();
}

function setupRefs() {
  const drop = $("#refDrop");
  const input = $("input", drop);
  input.onchange = () => {
    addRefFiles([...input.files]);
    input.value = "";
  };
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    addRefFiles([...e.dataTransfer.files]);
  });
}

// ---------- Ảnh đầu / cuối ----------
function renderFrames() {
  for (const frame of $$(".frame")) {
    const src = state.frames[frame.dataset.frame];
    $("img", frame)?.remove();
    frame.classList.toggle("has", !!src);
    $(".frame-empty", frame).hidden = !!src;
    if (src) frame.prepend(el("img", { src }));
  }
}

function setupFrames() {
  for (const frame of $$(".frame")) {
    const input = $("input", frame);
    frame.addEventListener("click", (e) => {
      if (!e.target.closest(".frame-x")) input.click();
    });
    input.onchange = async () => {
      try {
        if (input.files[0]) state.frames[frame.dataset.frame] = await readAsDataUrl(input.files[0]);
        renderFrames();
      } catch (err) {
        toast(err.message);
      }
      input.value = "";
    };
    $(".frame-x", frame).onclick = () => {
      state.frames[frame.dataset.frame] = null;
      renderFrames();
    };
  }
}

// ---------- Gửi yêu cầu tạo ----------
function buildBody(form) {
  const kind = form.dataset.tool;
  const f = form.elements;
  if (kind === "image") {
    const p = provider("image", f.model.value);
    return { model: f.model.value, prompt: f.prompt.value, aspect: f.aspect.value, quality: f.quality.value, count: f.count.value, refs: p?.supportsRefs ? state.refs : [] };
  }
  if (kind === "video") {
    const p = provider("video", f.model.value);
    return {
      model: f.model.value, prompt: f.prompt.value, aspect: f.aspect.value, duration: f.duration.value,
      firstFrame: p?.firstFrame ? state.frames.firstFrame : null,
      lastFrame: p?.lastFrame ? state.frames.lastFrame : null,
    };
  }
  if (kind === "audio") {
    const p = provider("tts", f.model.value);
    return { model: f.model.value, prompt: f.prompt.value, voice: p?.voices?.length ? f.voice.value : f.voiceId.value };
  }
  return {
    topic: f.topic.value, language: f.language.value, aspect: f.aspect.value, durationSec: Number(f.durationSec.value),
    sceneCount: Number(f.sceneCount.value), style: f.style.value, llm: f.llm.value, visualMode: f.visualMode.value,
    image: f.image.value, video: f.video.value, tts: f.tts.value, voice: f.voice.value, subtitles: f.subtitles.checked,
  };
}

async function submit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = $(".primary", form);
  showError("");
  btn.disabled = true;
  try {
    await api(`/api/generate/${form.dataset.tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(form)),
    });
    toast("Đã gửi yêu cầu – kết quả sẽ hiện ở bên phải");
    await loadItems();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Thư viện ----------
async function loadItems() {
  const tab = state.tab;
  try {
    const { items } = await api(`/api/items?kind=${tab}`);
    if (tab === state.tab) {
      state.items = items;
      renderGallery();
    }
  } catch (err) {
    console.error(err);
  }
}

const isActive = (item) => item.status === "queued" || item.status === "running";

function visibleCards() {
  const q = state.search.trim().toLowerCase();
  let items = state.items.filter((i) => !q || `${i.prompt} ${i.modelName} ${i.script?.title || ""}`.toLowerCase().includes(q));
  if (state.sort === "old") items = [...items].reverse();
  // Mỗi output là một thẻ; việc chưa xong / lỗi là một thẻ trạng thái.
  return items.flatMap((item) =>
    item.status === "done" && item.outputs?.length
      ? item.outputs.map((output, index) => ({ item, output, index }))
      : [{ item, output: null, index: 0 }],
  );
}

function renderGallery() {
  const cards = visibleCards();
  const grid = $("#grid");
  $("#galleryTitle").textContent = `Lịch sử ${TITLES[state.tab]} (${state.items.length})`;
  $("#empty").hidden = cards.length > 0;

  // Giữ nguyên thẻ video đang phát / đã tải, chỉ vẽ lại khi dữ liệu đổi.
  const keyOf = (c) => `${c.item.id}:${c.index}:${c.item.status}:${c.item.progress}:${c.output?.url || ""}`;
  const existing = new Map($$(".card", grid).map((n) => [n.dataset.key, n]));
  const nodes = cards.map((c) => existing.get(keyOf(c)) || renderCard(c, keyOf(c)));
  grid.replaceChildren(...nodes);
}

function renderCard({ item, output }, key) {
  const aspect = item.kind === "audio" ? "16:9" : item.params?.aspect;
  const media = el("div", { className: "media" });
  media.style.setProperty("--ar", ratio(aspect));
  const card = el("article", { className: "card" }, media);
  card.dataset.key = key;

  if (item.kind === "auto") media.append(el("span", { className: "tag", textContent: "AUTO" }));

  if (!output) {
    const status = el("div", { className: `status ${item.status === "error" ? "err" : ""}` });
    if (item.status === "error") {
      status.append(el("b", { textContent: "⚠️ Lỗi" }), el("span", { textContent: (item.error || "").slice(0, 220) }));
    } else {
      const bar = el("div", { className: "bar" }, el("i"));
      bar.firstChild.style.width = `${item.progress || 3}%`;
      status.append(
        el("div", { className: "spinner" }),
        el("span", { textContent: item.status === "queued" ? "Đang chờ…" : item.step || `Đang tạo… ${item.progress || 0}%` }),
        bar,
      );
    }
    media.append(status);
  } else if (output.type === "image") {
    media.append(el("img", { src: output.url, loading: "lazy", alt: item.prompt }));
  } else if (output.type === "video") {
    const v = el("video", { src: output.url, muted: true, loop: true, playsInline: true, preload: "metadata" });
    media.addEventListener("mouseenter", () => v.play().catch(() => {}));
    media.addEventListener("mouseleave", () => v.pause());
    media.append(v);
  } else if (output.type === "audio") {
    media.append(el("div", { className: "audio-icon", textContent: "🔊" }));
  }
  media.onclick = () => openViewer(item, output);

  if (output?.type === "audio") card.append(el("audio", { src: output.url, controls: true, preload: "none" }));

  const title = item.script?.title || item.prompt;
  card.append(
    el("div", { className: "meta" },
      el("p", { textContent: title, title }),
      el("small", { textContent: `${item.modelName || item.model} · ${timeAgo(item.createdAt)}` }),
    ),
  );
  card.append(renderActions(item, output));
  return card;
}

function renderActions(item, output) {
  const box = el("div", { className: "actions" });
  const btn = (icon, title, fn) => {
    const b = el("button", { type: "button", textContent: icon, title });
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    box.append(b);
  };
  if (output) box.append(el("a", { href: output.url, download: "", textContent: "⬇", title: "Tải về" }));
  if (output?.type === "image") btn("🎬", "Dùng làm ảnh đầu video", () => useAsFirstFrame(output.url));
  btn("↻", "Dùng lại mô tả", () => reuse(item));
  if (!isActive(item)) btn("🗑", "Xoá", () => removeItem(item));
  return box;
}

function useAsFirstFrame(url) {
  state.frames.firstFrame = url;
  renderFrames();
  $("#viewer").close();
  setTab("video");
  toast("Đã đặt làm Ảnh đầu – nhập kịch bản chuyển động rồi bấm Tạo Video");
}

function reuse(item) {
  $("#viewer").close();
  setTab(item.kind);
  const form = $(`[data-tool="${item.kind}"]`);
  if (item.kind === "auto") form.topic.value = item.prompt;
  else form.prompt.value = item.prompt;
  if (form.model && [...form.model.options].some((o) => o.value === item.model)) form.model.value = item.model;
  if (item.params?.aspect && form.aspect) form.aspect.value = item.params.aspect;
  if (item.kind === "image" && item.params?.refs?.length) {
    state.refs = [...item.params.refs];
    renderRefs();
  }
  applyProviderUI();
  saveForm(form);
  form.scrollIntoView({ behavior: "smooth" });
}

async function removeItem(item) {
  if (!confirm("Xoá mục này khỏi thư viện? File trên máy cũng sẽ bị xoá.")) return;
  try {
    await api(`/api/items/${item.id}`, { method: "DELETE" });
    $("#viewer").close();
    loadItems();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Xem chi tiết ----------
function openViewer(item, output) {
  const body = $("#viewerBody");
  body.replaceChildren();
  const media = el("div", { className: "viewer-media" });
  if (output?.type === "image") media.append(el("img", { src: output.url }));
  else if (output?.type === "video") media.append(el("video", { src: output.url, controls: true, autoplay: true, playsInline: true }));
  else if (output?.type === "audio") media.append(el("audio", { src: output.url, controls: true, autoplay: true }));
  else media.append(el("div", { className: "status" + (item.status === "error" ? " err" : ""), textContent: item.error || item.step || "Đang xử lý…" }));
  media.style.minHeight = output ? "" : "200px";
  media.style.position = "relative";

  const info = el("div", { className: "viewer-info" });
  if (item.script?.title) info.append(el("h2", { textContent: item.script.title }));
  info.append(el("div", { className: "prompt", textContent: item.prompt }));
  const p = item.params || {};
  const facts = [item.modelName, p.aspect, p.quality, p.duration && `${p.duration}s`, p.actualDuration && `dài ${p.actualDuration.toFixed(1)}s`, p.voice && `giọng ${p.voice}`, timeAgo(item.createdAt)];
  info.append(el("small", { className: "note", textContent: facts.filter(Boolean).join(" · ") }));

  const links = el("div", { className: "viewer-links" });
  if (output) links.append(el("a", { className: "btn accent", href: output.url, download: "", textContent: "⬇ Tải về" }));
  if (item.result?.subtitles) links.append(el("a", { className: "btn", href: item.result.subtitles, download: "", textContent: "⬇ Phụ đề .srt" }));
  if (output?.type === "image") {
    const b = el("button", { className: "btn", textContent: "🎬 Làm ảnh đầu video" });
    b.onclick = () => useAsFirstFrame(output.url);
    links.append(b);
  }
  const again = el("button", { className: "btn", textContent: "↻ Dùng lại mô tả" });
  again.onclick = () => reuse(item);
  links.append(again);
  if (!isActive(item)) {
    const del = el("button", { className: "btn", textContent: "🗑 Xoá" });
    del.onclick = () => removeItem(item);
    links.append(del);
  }
  info.append(links);

  if (item.script?.scenes) {
    const list = el("ol");
    item.script.scenes.forEach((s) => list.append(el("li", { className: "scene" }, s.narration, el("br"), el("small", { textContent: `🎨 ${s.visual_prompt}` }))));
    info.append(el("details", {}, el("summary", { textContent: "Kịch bản" }), list));
  }
  if (item.logs?.length) info.append(el("details", {}, el("summary", { textContent: "Nhật ký" }), el("pre", { textContent: item.logs.join("\n") })));
  if (p.refs?.length || p.firstFrame || p.lastFrame) {
    const refs = el("div", { className: "refs" });
    [...(p.refs || []), p.firstFrame, p.lastFrame].filter(Boolean).forEach((src) => refs.append(el("div", { className: "thumb" }, el("img", { src }))));
    info.append(el("details", {}, el("summary", { textContent: "Ảnh đầu vào" }), refs));
  }

  body.append(media, info);
  $("#viewer").showModal();
}

// ---------- API key ----------
function openKeys() {
  const groups = { llm: "✍️ Viết kịch bản", image: "🖼️ Tạo ảnh", video: "🎥 Tạo video", tts: "🔊 Giọng đọc" };
  const body = $("#keysBody");
  body.replaceChildren();
  for (const [kind, title] of Object.entries(groups)) {
    const g = el("div", { className: "keys-group" }, el("h3", { textContent: title }));
    for (const p of state.providers[kind]) {
      if (p.id === "mock") continue;
      g.append(
        el("div", { className: "keys-row" },
          el("span", { textContent: p.name }),
          el("span", { className: p.ready ? "ok" : "no", textContent: p.ready ? "✓ Đã kết nối" : `Thiếu ${p.env}` }),
        ),
      );
    }
    body.append(g);
  }
  $("#keys").showModal();
}

// ---------- Khởi động ----------
async function init() {
  try {
    ({ providers: state.providers } = await api("/api/providers"));
  } catch (err) {
    showError(`Không kết nối được server: ${err.message}`);
    return;
  }
  fillModelSelects();
  for (const form of $$(".tool")) {
    restoreForm(form);
    form.addEventListener("submit", submit);
    form.addEventListener("input", () => saveForm(form));
    form.addEventListener("change", () => {
      applyProviderUI();
      saveForm(form);
    });
  }
  const audioPrompt = $('[data-tool="audio"] textarea');
  const updateCount = () => ($("#charCount").textContent = `${audioPrompt.value.length}/4000`);
  audioPrompt.addEventListener("input", updateCount);
  updateCount();
  applyProviderUI();
  setupRefs();
  setupFrames();

  $$("#tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $("#keysBtn").onclick = openKeys;
  $$("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  $$("dialog").forEach((d) => d.addEventListener("close", () => $$("video, audio", d).forEach((m) => m.pause())));
  $("#search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderGallery();
  });
  $$("#sort button").forEach(
    (b) =>
      (b.onclick = () => {
        state.sort = b.dataset.sort;
        $$("#sort button").forEach((x) => x.classList.toggle("on", x === b));
        renderGallery();
      }),
  );
  const cols = $("#cols");
  cols.value = store.get("cols", 4);
  const applyCols = () => {
    $("#grid").style.setProperty("--cols", cols.value);
    store.set("cols", Number(cols.value));
  };
  cols.addEventListener("input", applyCols);
  applyCols();

  setTab(location.hash.slice(1) || "image");
  // Tự cập nhật khi còn việc đang chạy.
  setInterval(() => {
    if (state.items.some(isActive)) loadItems();
  }, 2000);
}

init();
