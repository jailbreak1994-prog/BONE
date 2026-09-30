// Mở trình duyệt ẩn để kiểm tra và render hoạt hình.
// Thứ tự thử: CHROME_PATH → Chromium của Playwright (nếu đã cài) → Microsoft Edge → Google Chrome.
// Windows luôn có sẵn Edge nên thường không cần tải thêm gì.
import { chromium } from "playwright-core";

let lastError = null;

export async function launchBrowser() {
  const attempts = [];
  if (process.env.CHROME_PATH) attempts.push({ executablePath: process.env.CHROME_PATH });
  attempts.push({}, { channel: "msedge" }, { channel: "chrome" });
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    "Không mở được trình duyệt để render. Hãy cài Google Chrome hoặc Microsoft Edge, " +
      "hoặc đặt CHROME_PATH trong file .env tới file chrome.exe/msedge.exe. " +
      `(Chi tiết: ${String(lastError?.message || lastError).split("\n")[0]})`,
  );
}
