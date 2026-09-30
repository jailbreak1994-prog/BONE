// Thư viện: lưu mọi thứ đã tạo (ảnh, video, giọng đọc, Auto Video) vào output/library.json
// để khởi động lại server vẫn còn lịch sử.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR } from "./pipeline.js";

const FILE = path.join(OUTPUT_DIR, "library.json");
const items = new Map();
let saveTimer = null;

export function loadLibrary() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const item of list) {
      // Việc đang chạy dở khi server tắt sẽ không bao giờ xong nữa.
      if (item.status === "queued" || item.status === "running") {
        item.status = "error";
        item.error = "Server đã khởi động lại khi đang xử lý";
      }
      items.set(item.id, item);
    }
  } catch {}
}

export function saveLibrary() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = JSON.stringify([...items.values()], null, 1);
    fsp.writeFile(FILE + ".tmp", data).then(() => fsp.rename(FILE + ".tmp", FILE)).catch((e) => console.error(e));
  }, 300);
}

export function addItem(item) {
  items.set(item.id, item);
  saveLibrary();
  return item;
}

export const getItem = (id) => items.get(id);

export function listItems(kind) {
  return [...items.values()].filter((i) => !kind || i.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function removeItem(id) {
  const item = items.get(id);
  if (!item) return false;
  if (item.status === "queued" || item.status === "running") throw new Error("Không thể xoá khi đang xử lý");
  items.delete(id);
  saveLibrary();
  await fsp.rm(path.join(OUTPUT_DIR, id), { recursive: true, force: true });
  return true;
}
