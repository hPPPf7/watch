import { app, BrowserWindow, session } from "electron";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { installDesktopApiCache } from "../desktop/api-cache.mjs";
async function verify() {
const root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-auth-fixture-"));
app.setPath("userData", root);
const counts = new Map();
let loggedIn = true;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://fixture");
  counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
  if (!url.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>Isolated cache check</title>");
    return;
  }
  if ((url.pathname.includes("section-data") || url.pathname === "/api/profile/me") &&
      (!loggedIn || !req.headers.cookie?.includes("fixture-session=fixture"))) {
    res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
    res.end("{}"); return;
  }
  const payload = url.pathname === "/api/profile/me" ? { id: "fixture-user" }
    : url.pathname === "/api/auth/session" ? (loggedIn ? { user: { id: "fixture-user" } } : null)
    : url.pathname.includes("revision") ? { revision: "r1" }
    : url.pathname.includes("section-data") ? {
      rows: [{ id: "fixture-item", tmdb_id: 1, media_type: "movie", is_anime: false }],
      movieHistoryRows: [{ tmdb_id: 1, watched_at: "2026-09-01", watch_count: 1 }],
    }
    : url.pathname.includes("media/titles") ? { titles: { "movie:1": { title: "Fixture", is_anime: false } } }
    : url.pathname.includes("tmdb/season") ? { episodes: [{ episode_number: 1, air_date: "2020-01-01" }] }
    : { ok: true };
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
});
const timeout = setTimeout(() => { console.error("FAIL: timeout"); app.exit(1); }, 15000);
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  await app.whenReady();
  const origin = "http://127.0.0.1:" + server.address().port;
  installDesktopApiCache({ app, appOrigin: origin });
  await session.defaultSession.cookies.set({ url: origin, name: "fixture-session", value: "fixture", httpOnly: true });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(origin);
  const call = (url, options = {}) => window.webContents.executeJavaScript("fetch(" + JSON.stringify(url) + "," + JSON.stringify(options) + ").then(r=>r.json())");
  const seed = async () => {
    await call("/api/watchlist/section-data?mediaType=movie");
    await call("/api/media/titles", { method: "POST", body: JSON.stringify({ items: [{ media_type: "movie", tmdb_id: 1 }] }) });
    await call("/api/tmdb/season?type=tv&id=1&season=1");
  };
  const buckets = () => Promise.all(["api-cache", "local-watch-history", "media-titles"].map(name => fs.readdir(path.join(root, name)).catch(() => [])));
  const dataRequests = () => ["/api/watchlist/section-data", "/api/media/titles", "/api/tmdb/season"].map(key => counts.get(key) ?? 0);
  await seed();
  const initial = await buckets();
  assert(initial.every(files => files.length > 0));
  const before = dataRequests();
  for (const name of ["session", "csrf", "providers", "session"]) await call("/api/auth/" + name);
  assert.deepEqual(await buckets(), initial);
  await seed();
  assert.deepEqual(dataRequests(), before);
  loggedIn = false;
  await call("/api/auth/session");
  assert.deepEqual(await buckets(), [[], [], []]);
  console.log("PASS: real sandboxed Electron same-account revalidation retains API/history/title caches without new data requests; null session clears all three.");
  const loggedOutStatus = await window.webContents.executeJavaScript(
    "fetch('/api/watchlist/section-data?mediaType=movie').then(r=>r.status)"
  );
  assert.equal(loggedOutStatus, 401);
  console.log("PASS: after logout, the next private read revalidates and returns 401 rather than old cached data.");
  window.destroy(); clearTimeout(timeout); server.close(); app.exit(0);
} catch (error) {
  console.error(error); clearTimeout(timeout); server.close(); app.exit(1);
}

}
void verify();
