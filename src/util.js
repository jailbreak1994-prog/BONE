import fs from "node:fs/promises";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name} (khai báo trong file .env)`);
  return v;
}

/** fetch + parse JSON, ném lỗi rõ ràng khi HTTP status không OK. */
export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${url} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** fetch trả về nhị phân, ghi thẳng ra file. */
export async function fetchToFile(url, dest, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${url} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/**
 * Gọi `check()` lặp lại cho tới khi nó trả về giá trị khác undefined.
 * Dùng cho các API tạo video bất đồng bộ (tạo task → poll trạng thái).
 */
export async function poll(check, { intervalMs = 5000, timeoutMs = 15 * 60 * 1000, label = "task" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== undefined) return result;
    await sleep(intervalMs);
  }
  throw new Error(`Hết thời gian chờ ${label} (${Math.round(timeoutMs / 1000)}s)`);
}

/** Chạy tối đa `limit` promise cùng lúc, giữ nguyên thứ tự kết quả. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model không trả về JSON hợp lệ");
  return JSON.parse(cleaned.slice(start, end + 1));
}
