// 隔離本機 fixture：不載入正式站、不使用使用者的桌面 session。
import { app, BrowserWindow } from "electron";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installDesktopApiCache } from "../desktop/api-cache.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "watch-electron-stream-"));
app.setPath("userData", root);
const timeout = setTimeout(() => { console.error("Desktop SSE verification timed out"); app.exit(1); }, 15000);
let closed = false;
const server = http.createServer((req, res) => {
  console.log("fixture request", req.url);
  if (req.url?.startsWith("/api/events/")) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write("data: live-event\n\n"); req.on("close", () => { closed = true; }); return;
  }
  res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>Local verification</title>");
});
async function verify() {
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  console.log("fixture listening");
  await app.whenReady();
  console.log("electron ready");
  const origin = "http://127.0.0.1:" + server.address().port;
  installDesktopApiCache({ app, appOrigin: origin });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  console.log("loading fixture");
  await window.loadURL(origin);
  console.log("fixture loaded");
  const event = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const source = new EventSource('/api/events/watchlist/stream');
    source.onmessage = event => { source.close(); resolve(event.data); };
    source.onerror = () => { source.close(); reject(new Error('SSE failed')); };
  })`);
  if (event !== "live-event") throw new Error("Unexpected SSE payload");
  // Chromium 取消串流後，upstream 也必須終止。
  for (let i = 0; i < 40 && !closed; i++) await new Promise(resolve => setTimeout(resolve, 50));
  if (!closed) throw new Error("Upstream stream was not cancelled");
  console.log("PASS: sandboxed Electron receives SSE before close and cancels upstream");
  window.destroy(); clearTimeout(timeout); server.close(); app.exit(0);
} catch (error) { console.error(error); clearTimeout(timeout); server.close(); app.exit(1); }

}
void verify();
