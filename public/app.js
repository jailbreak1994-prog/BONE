const $ = (id) => document.getElementById(id);
const form = $("form");
let pollTimer = null;

const STATUS_TEXT = { queued: "Đang chờ", running: "Đang chạy", done: "Hoàn tất", error: "Lỗi" };

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- Nạp danh sách provider ----------
async function loadProviders() {
  const { providers, defaults } = await api("/api/providers");
  for (const select of form.querySelectorAll("select[data-kind]")) {
    const kind = select.dataset.kind;
    select.innerHTML = "";
    for (const p of providers[kind]) {
      const opt = new Option(`${p.ready ? "" : "⚠️ "}${p.name}`, p.id);
      if (!p.ready) opt.title = `Cần ${p.env} trong .env`;
      select.add(opt);
    }
    // Ưu tiên provider mặc định nếu đã có key, nếu không chọn provider đầu tiên sẵn sàng.
    const preferred = providers[kind].find((p) => p.id === defaults[kind] && p.ready)
      || providers[kind].find((p) => p.ready)
      || providers[kind][0];
    select.value = preferred.id;
  }
  toggleVideoField();
}

function toggleVideoField() {
  $("videoField").style.display = form.visualMode.value === "video" ? "" : "none";
}
form.visualMode.addEventListener("change", toggleVideoField);

// ---------- Gửi form ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("formError").hidden = true;
  const data = Object.fromEntries(new FormData(form));
  data.subtitles = form.subtitles.checked;
  data.durationSec = Number(data.durationSec);
  data.sceneCount = Number(data.sceneCount);
  $("submit").disabled = true;
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    watchJob(job.id);
    loadHistory();
  } catch (err) {
    $("formError").textContent = err.message;
    $("formError").hidden = false;
  } finally {
    $("submit").disabled = false;
  }
});

// ---------- Theo dõi job ----------
function renderJob(job) {
  $("jobView").hidden = false;
  $("jobTitle").textContent = job.script?.title || job.topic;
  $("jobStatus").textContent = STATUS_TEXT[job.status] || job.status;
  $("jobStatus").className = `badge ${job.status}`;
  $("bar").style.width = `${job.progress}%`;
  $("jobStep").textContent = job.error ? `❌ ${job.error}` : `${job.step} – ${job.progress}%`;
  $("logs").textContent = job.logs.join("\n");
  $("logs").scrollTop = $("logs").scrollHeight;

  if (job.script) {
    $("scriptBox").hidden = false;
    $("scenes").innerHTML = "";
    for (const s of job.script.scenes) {
      const li = document.createElement("li");
      li.textContent = s.narration;
      const p = document.createElement("div");
      p.className = "prompt";
      p.textContent = `🎨 ${s.visual_prompt}`;
      li.append(p);
      $("scenes").append(li);
    }
  } else {
    $("scriptBox").hidden = true;
  }

  if (job.status === "done" && job.result) {
    $("result").hidden = false;
    const src = `${job.result.video}?t=${job.id}`;
    if ($("player").getAttribute("src") !== src) $("player").src = src;
    $("dlVideo").href = job.result.video;
    $("dlVideo").download = `${job.script?.title || "video"}.mp4`;
    $("dlSrt").href = job.result.subtitles;
    $("dlScript").href = job.result.script;
  } else {
    $("result").hidden = true;
    $("player").removeAttribute("src");
  }
}

function watchJob(id) {
  clearTimeout(pollTimer);
  const tick = async () => {
    try {
      const job = await api(`/api/jobs/${id}`);
      renderJob(job);
      if (job.status === "queued" || job.status === "running") pollTimer = setTimeout(tick, 1500);
      else loadHistory();
    } catch (err) {
      $("jobStep").textContent = `❌ ${err.message}`;
    }
  };
  tick();
  $("jobView").scrollIntoView({ behavior: "smooth" });
}

async function loadHistory() {
  const { jobs } = await api("/api/jobs");
  const ul = $("history");
  ul.innerHTML = "";
  if (!jobs.length) {
    ul.innerHTML = '<li class="muted">Chưa có video nào.</li>';
    return;
  }
  for (const j of jobs) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const name = document.createElement("span");
    name.textContent = j.topic;
    const badge = document.createElement("span");
    badge.className = `badge ${j.status}`;
    badge.textContent = STATUS_TEXT[j.status] || j.status;
    btn.append(name, badge);
    btn.addEventListener("click", () => watchJob(j.id));
    li.append(btn);
    ul.append(li);
  }
}

loadProviders().catch((err) => {
  $("formError").textContent = `Không tải được danh sách provider: ${err.message}`;
  $("formError").hidden = false;
});
loadHistory();
