// Frame Flow – AI viết kịch bản cảnh + code chuyển động (HTML/CSS/GSAP) cho từng cảnh.
import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { FONTS, STAGES } from "./player.js";

export const TEMPLATES = {
  typography: {
    name: "Typography chuyển động",
    hint: "Số liệu và tiêu đề đập nhịp",
    guide: "Chữ lớn đập theo nhịp, số liệu đếm tăng dần, tiêu đề xuất hiện mạnh, chuyển cảnh nhanh và dứt khoát.",
  },
  product: {
    name: "Hero sản phẩm",
    hint: "Card sản phẩm, slogan, logo",
    guide: "Giới thiệu sản phẩm như quảng cáo cao cấp: card sản phẩm nổi, ánh sáng, lợi ích chính, slogan, kết bằng logo/CTA.",
  },
  explainer: {
    name: "Video giải thích",
    hint: "Từng bước, icon, giọng đọc",
    guide: "Giải thích rõ ràng từng bước, mỗi cảnh một ý, có số thứ tự bước, icon vẽ bằng CSS/emoji, chữ ngắn gọn khớp giọng đọc.",
  },
  brand: {
    name: "Câu chuyện thương hiệu",
    hint: "Logo, slogan, nhạc hiệu",
    guide: "Kể câu chuyện thương hiệu giàu cảm xúc: mở đầu gợi tò mò, giá trị cốt lõi, khoảnh khắc logo xuất hiện, slogan kết thúc.",
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "title", "theme", "scenes"],
  properties: {
    reply: { type: "string", description: "Tin nhắn ngắn gửi người dùng (tiếng Việt): đã làm gì / đã sửa gì" },
    title: { type: "string" },
    theme: {
      type: "object",
      additionalProperties: false,
      required: ["font", "bg", "primary", "accent", "text"],
      properties: {
        font: { type: "string", enum: FONTS },
        bg: { type: "string" },
        primary: { type: "string" },
        accent: { type: "string" },
        text: { type: "string" },
      },
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["narration", "duration", "image_prompt", "html", "css", "js"],
        properties: {
          narration: { type: "string", description: "Lời đọc của cảnh; chuỗi rỗng nếu cảnh không có lời" },
          duration: { type: "number", description: "Thời lượng dự kiến (giây) nếu không có giọng đọc" },
          image_prompt: { type: "string", description: "Prompt tiếng Anh để AI tạo ảnh cho cảnh; chuỗi rỗng nếu không cần ảnh" },
          html: { type: "string" },
          css: { type: "string" },
          js: { type: "string" },
        },
      },
    },
  },
};

function systemPrompt(project) {
  const { w, h } = STAGES[project.aspect];
  const vertical = project.aspect === "9:16";
  return `Bạn là motion designer kiêm lập trình viên front-end, tạo video motion graphics dạng code cho mạng xã hội.

## Đầu ra
Trả về JSON đúng schema: reply, title, theme, scenes[]. Mỗi cảnh gồm narration, duration, image_prompt, html, css, js.

## Sân khấu
- Kích thước cố định ${w}×${h}px (tỉ lệ ${project.aspect}). Mỗi cảnh là một <section class="scene"> phủ kín sân khấu, đã có position:absolute; inset:0; overflow:hidden.
- Biến CSS có sẵn: --bg, --primary, --accent, --text, --font, --W, --H. Font: var(--font).
${vertical ? "- Khung dọc cho Reels/TikTok: đặt chữ quan trọng tránh 14% phía trên và 30% phía dưới (vùng giao diện của ứng dụng)." : "- Chừa lề an toàn tối thiểu 6% mỗi cạnh."}
- Chữ phải rất lớn và dễ đọc trên điện thoại: tiêu đề ≥ ${Math.round(w * 0.08)}px, chữ phụ ≥ ${Math.round(w * 0.04)}px. Mỗi cảnh ít chữ.

## html
- Chỉ phần nội dung bên trong section (không có <section>, <script>, <style>, <link>).
- Không dùng tài nguyên bên ngoài (không URL ảnh/font/CDN). Icon dùng emoji, SVG nội tuyến hoặc CSS.
- Ảnh AI của cảnh (nếu image_prompt khác rỗng): dùng <img src="{{IMAGE}}"> hoặc CSS background-image: var(--scene-image). Nếu image_prompt rỗng thì không dùng hai thứ này.
- Ảnh người dùng tải lên (nếu có, xem danh sách ASSETS) dùng đúng URL được cung cấp.

## css
- Viết selector tương đối (.title, .card…) – hệ thống tự lồng vào #scene-N nên không ảnh hưởng cảnh khác.
- Trạng thái ban đầu của phần tử có thể để hiển thị bình thường; chuyển động do GSAP đảm nhiệm.

## js
- Là THÂN một hàm, được gọi với biến: tl (gsap.timeline của cảnh, bắt đầu ở 0), el (section của cảnh), dur (thời lượng thật của cảnh, giây), q (hàm chọn phần tử trong cảnh: q(".title")), gsap, W, H.
- Chỉ thêm tween vào tl, dùng mốc thời gian tuyệt đối trong cảnh, ví dụ: tl.from(q(".title"), { y: 120, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.1);
- Mọi chuyển động phải phụ thuộc thời gian của tl – KHÔNG dùng setTimeout, setInterval, requestAnimationFrame, Date, Math.random, CSS animation/transition, repeat: -1. Muốn lặp thì dùng repeat hữu hạn tính theo dur.
- Phần tử chính xuất hiện trong 0,8 giây đầu. Kết thúc chuyển động trước dur. Có thể thêm chuyển động chậm (zoom/trôi nhẹ) kéo dài hết dur cho sinh động.
- Đếm số: dùng object trung gian, ví dụ const o = { v: 0 }; tl.to(o, { v: 120, duration: 1.2, onUpdate: () => (q(".num")[0].textContent = Math.round(o.v)) }, 0.2);
- Không dùng plugin GSAP nào ngoài core. Code phải chạy được, không lỗi cú pháp.

## Nội dung
- Ngôn ngữ chữ trên màn hình và lời đọc: ${project.language}.
- narration: câu đọc tự nhiên, khớp chữ trên màn hình, ~2,5 từ/giây; duration ≈ độ dài lời đọc + 0,6 giây (cảnh không lời 2–3 giây).
- Theme màu tương phản cao, hợp chủ đề. font chọn trong danh sách cho phép, hỗ trợ đúng ngôn ngữ (tiếng Thái dùng Prompt, Kanit hoặc Noto Sans Thai).
- Tổng độ dài mục tiêu: khoảng ${project.durationSec} giây, 4–8 cảnh. Cảnh đầu phải có hook mạnh.
- Không đưa ra tuyên bố sai sự thật hoặc cam kết chữa bệnh.

## Khi sửa
Nếu nhận được DỰ ÁN HIỆN TẠI, hãy sửa theo yêu cầu và trả lại TOÀN BỘ dự án. Giữ nguyên những cảnh/thuộc tính không liên quan (giữ nguyên chuỗi narration, image_prompt nếu không cần đổi, để khỏi tạo lại giọng và ảnh). reply tóm tắt ngắn đã sửa gì.`;
}

function projectForPrompt(project) {
  return {
    title: project.title,
    theme: project.theme,
    scenes: project.scenes.map((s) => ({
      narration: s.narration, duration: s.duration, image_prompt: s.image_prompt, html: s.html, css: s.css, js: s.js,
    })),
  };
}

async function buildUserContent(project, request, { errors, assets }) {
  const content = [];
  for (const a of assets) {
    content.push({ type: "image", source: { type: "base64", media_type: a.mime, data: (await fs.readFile(a.path)).toString("base64") } });
  }
  const parts = [];
  if (assets.length) parts.push(`ASSETS (ảnh người dùng tải lên, theo thứ tự ảnh đính kèm ở trên):\n${assets.map((a, i) => `${i + 1}. ${a.url} (${a.name})`).join("\n")}`);
  if (project.template && TEMPLATES[project.template]) parts.push(`PHONG CÁCH: ${TEMPLATES[project.template].name} – ${TEMPLATES[project.template].guide}`);
  const history = project.messages.slice(-8, -1).map((m) => `${m.role === "user" ? "Người dùng" : "Bạn"}: ${m.text}`);
  if (history.length) parts.push(`LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY:\n${history.join("\n")}`);
  if (project.scenes.length) parts.push(`DỰ ÁN HIỆN TẠI:\n${JSON.stringify(projectForPrompt(project))}`);
  if (errors?.length) parts.push(`LỖI KHI CHẠY THỬ CODE (hãy sửa):\n${errors.join("\n")}`);
  parts.push(`YÊU CẦU: ${request}`);
  content.push({ type: "text", text: parts.join("\n\n") });
  return content;
}

async function claudeSpec(project, request, opts) {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: process.env.ANTHROPIC_FLOW_EFFORT || "high",
      format: { type: "json_schema", schema: SCHEMA },
    },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(project),
    messages: [{ role: "user", content: await buildUserContent(project, request, opts) }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude từ chối yêu cầu: ${response.stop_details?.explanation || "vi phạm chính sách"}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Kết quả quá dài, hãy giảm số cảnh hoặc độ dài video");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

// ---------- Mock: mẫu dựng sẵn, không gọi AI (để chạy thử miễn phí) ----------
function mockSpec(project, request) {
  if (project.scenes.length) {
    return { ...projectForPrompt(project), reply: "Chế độ Mock không sửa được theo yêu cầu. Hãy chọn Claude để chat chỉnh sửa." };
  }
  const sentences = request.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const title = sentences[0]?.slice(0, 60) || "Frame Flow";
  const fit = (s) => s.replace(/[<>&]/g, "");
  const scenes = [
    {
      narration: title,
      duration: 3,
      image_prompt: "",
      html: `<div class="bg"></div><h1 class="t">${fit(title)}</h1><div class="bar"></div>`,
      css: `.bg{position:absolute;inset:-10%;background:radial-gradient(circle at 30% 30%,var(--primary),transparent 55%),radial-gradient(circle at 70% 70%,var(--accent),transparent 55%);opacity:.35}
.t{position:absolute;left:8%;right:8%;top:38%;margin:0;font-size:calc(var(--W)*.1);font-weight:900;line-height:1.05;text-transform:uppercase}
.bar{position:absolute;left:8%;top:62%;height:18px;width:40%;background:var(--primary);border-radius:9px}`,
      js: `tl.from(q(".t"),{y:160,opacity:0,duration:.7,ease:"power4.out"},.1)
  .from(q(".bar"),{scaleX:0,transformOrigin:"left",duration:.6,ease:"power2.out"},.5)
  .to(q(".bg"),{scale:1.2,rotation:8,duration:dur,ease:"none"},0);`,
    },
    {
      narration: "Chỉ với ba bước đơn giản.",
      duration: 3.5,
      image_prompt: "",
      html: `<h2 class="h">3 bước</h2><div class="steps">${["Ý tưởng", "Chuyển động", "Render"].map((s, i) => `<div class="s"><b>${i + 1}</b><span>${s}</span></div>`).join("")}</div>`,
      css: `.h{position:absolute;left:8%;top:22%;margin:0;font-size:calc(var(--W)*.09);font-weight:900;color:var(--primary)}
.steps{position:absolute;left:8%;right:8%;top:38%;display:grid;gap:calc(var(--W)*.03)}
.s{display:flex;align-items:center;gap:calc(var(--W)*.04);font-size:calc(var(--W)*.06);font-weight:700;background:#ffffff14;border-radius:28px;padding:calc(var(--W)*.03)}
.s b{display:grid;place-items:center;width:calc(var(--W)*.11);aspect-ratio:1;border-radius:50%;background:var(--primary);color:var(--bg)}`,
      js: `tl.from(q(".h"),{x:-200,opacity:0,duration:.5,ease:"power3.out"},0)
  .from(q(".s"),{x:300,opacity:0,duration:.5,stagger:.35,ease:"back.out(1.6)"},.3);`,
    },
    {
      narration: "Bắt đầu ngay hôm nay.",
      duration: 3,
      image_prompt: "",
      html: `<div class="c"><div class="n">100%</div><p>tự động</p></div>`,
      css: `.c{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
.n{font-size:calc(var(--W)*.25);font-weight:900;color:var(--accent);line-height:1}
p{margin:0;font-size:calc(var(--W)*.07);font-weight:700}`,
      js: `const o={v:0};tl.from(q(".c"),{scale:.6,opacity:0,duration:.5,ease:"back.out(2)"},0)
  .to(o,{v:100,duration:1.2,ease:"power2.out",onUpdate:()=>{q(".n")[0].textContent=Math.round(o.v)+"%"}},.2);`,
    },
  ];
  return {
    reply: "Đã tạo bản thử bằng mẫu dựng sẵn (Mock). Chọn Claude để AI tự viết chuyển động theo ý tưởng của bạn.",
    title,
    theme: { font: "Be Vietnam Pro", bg: "#0d0f14", primary: "#c5f02c", accent: "#22d3ee", text: "#ffffff" },
    scenes,
  };
}

export const FLOW_LLMS = {
  anthropic: { name: "Claude (Anthropic)", env: "ANTHROPIC_API_KEY", run: claudeSpec },
  mock: { name: "Mock (mẫu có sẵn, miễn phí)", env: null, run: mockSpec },
};

/** Gọi AI và chuẩn hoá kết quả. opts = { errors, assets } */
export async function generateSpec(llm, project, request, opts = {}) {
  const provider = FLOW_LLMS[llm];
  if (!provider) throw new Error(`Model không hợp lệ: ${llm}`);
  const spec = await provider.run(project, request, { errors: [], assets: [], ...opts });
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error("AI không trả về cảnh nào");
  return {
    reply: String(spec.reply || ""),
    title: String(spec.title || project.title || "Motion"),
    theme: spec.theme,
    scenes: spec.scenes.slice(0, 12).map((s) => ({
      narration: String(s.narration || "").trim(),
      duration: Math.min(Math.max(Number(s.duration) || 3, 1.5), 20),
      image_prompt: String(s.image_prompt || "").trim(),
      html: String(s.html || ""),
      css: String(s.css || ""),
      js: String(s.js || ""),
    })),
  };
}
