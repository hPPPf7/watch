import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, session } from "electron";
import { installDesktopApiCache } from "../desktop/api-cache.mjs";
import { forwardRequest } from "../desktop/forward-request.mjs";

// Never use the installed desktop profile or any real OAuth provider/account.
const root = mkdtempSync(path.join(os.tmpdir(), "watch-redirect-fixture-"));
app.setPath("userData", root);
app.on("window-all-closed", () => {});
const requests = [];
const openStreams = new Set();
let watchOrigin;
let providerOrigin;
let window;
let installed = false;
const timeout = setTimeout(() => { console.error("FAIL: isolated redirect check timed out"); app.exit(1); }, 20000);
const page = (extra = "") => `<!doctype html><html><head><title>Watch fixture</title><link rel="stylesheet" href="./fixture.css"></head><body><main id="watch">Watch fixture</main><img src="./fixture.svg" alt="">${extra}<script src="./fixture.js"></script></body></html>`;
const compressed = (res, content, type) => {
  const body = gzipSync(content);
  res.writeHead(200, { "content-type": type, "content-encoding": "gzip", "content-length": body.length, "cache-control": "no-store" });
  res.end(body);
};
const json = (res, payload) => { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(payload)); };
const watch = http.createServer(async (req, res) => {
  const url = new URL(req.url, watchOrigin);
  const entry = { source: "watch", pathname: url.pathname, method: req.method, body: "", cookies: req.headers.cookie ?? "" };
  requests.push(entry);
  for await (const chunk of req) entry.body += chunk.toString();
  if (url.pathname.startsWith("/api/auth/callback/")) {
    res.writeHead(Number(url.searchParams.get("status") ?? 302), {
      location: "/welcome",
      "cache-control": "no-store",
      "set-cookie": [
        "fixture-session=fixture-user; Path=/; HttpOnly; SameSite=Lax",
        "fixture-second=second; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT; SameSite=Lax",
        "fixture-state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
      ],
    });
    res.end();
  } else if (url.pathname === "/fixture.js") {
    compressed(res, "window.fixtureScriptLoaded=true", "application/javascript");
  } else if (url.pathname === "/fixture.css") {
    compressed(res, "main{color:rgb(1,2,3)}", "text/css");
  } else if (url.pathname === "/fixture.svg") {
    compressed(res, '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>', "image/svg+xml");
  } else if (url.pathname === "/form") {
    compressed(res, page(`<form method="post" action="/api/auth/callback/form?status=${Number(url.searchParams.get("status"))}"><input name="fixture" value="body-preserved"><button id="submit">Submit</button></form>`), "text/html");
  } else if (url.pathname === "/api/auth/session") {
    // Intentionally cacheable upstream: auth forwarding must retain no-store.
    res.writeHead(200, { "content-type": "application/json", "cache-control": "max-age=3600" });
    res.end(JSON.stringify({ user: { id: "fixture-user" } }));
  } else if (url.pathname === "/api/profile/me") {
    json(res, { id: "fixture-user" });
  } else if (url.pathname.includes("revision")) {
    json(res, { revision: "r1" });
  } else if (url.pathname === "/api/watchlist/section-data") {
    json(res, { rows: [{ id: "fixture-item", tmdb_id: 1, media_type: "movie", is_anime: false }], movieHistoryRows: [] });
  } else if (url.pathname === "/api/media/titles") {
    json(res, { titles: { "movie:1": { title: "Fixture", is_anime: false } } });
  } else if (url.pathname === "/api/tmdb/season") {
    json(res, { episodes: [{ episode_number: 1, air_date: "2020-01-01" }] });
  } else if (url.pathname === "/fixture-stream" || url.pathname.endsWith("/fixture-slow")) {
    openStreams.add(res);
    res.once("close", () => openStreams.delete(res));
    if (url.pathname === "/fixture-stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      res.write("data: ready\n\n");
    }
  } else if (url.pathname === "/fixture-empty") {
    res.writeHead(204); res.end();
  } else {
    compressed(res, page(), "text/html");
  }
});
const provider = http.createServer((req, res) => {
  const url = new URL(req.url, providerOrigin);
  requests.push({ source: "provider", pathname: url.pathname, method: req.method });
  if (url.pathname === "/continue") {
    res.writeHead(302, { location: watchOrigin + "/api/auth/callback/google", "cache-control": "no-store" }); res.end();
  } else if (url.pathname === "/signin") {
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    const target = url.searchParams.has("direct") ? watchOrigin + "/api/auth/callback/google" : "/continue";
    res.end(`<!doctype html><title>Provider fixture</title><a id="submit" href="${target}">Sign in</a>`);
  } else { res.writeHead(404); res.end(); }
});
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(10); }
  throw new Error("Expected isolated request to settle");
};
const call = (url, options = {}) => window.webContents.executeJavaScript(`fetch(${JSON.stringify(url)},${JSON.stringify(options)}).then(r=>r.json())`);
const buckets = () => Promise.all(["api-cache", "local-watch-history", "media-titles"].map(name => fs.readdir(path.join(root, name)).catch(() => [])));
const seed = async () => {
  await window.loadURL(watchOrigin);
  await session.defaultSession.cookies.set({ url: watchOrigin, name: "fixture-session", value: "fixture-user", httpOnly: true });
  await session.defaultSession.cookies.set({ url: watchOrigin, name: "fixture-state", value: "fixture-state", httpOnly: true });
  await call("/api/watchlist/section-data?mediaType=movie");
  await call("/api/media/titles", { method: "POST", body: JSON.stringify({ items: [{ media_type: "movie", tmdb_id: 1 }] }) });
  await call("/api/tmdb/season?type=tv&id=1&season=1");
  if (installed) assert((await buckets()).every(files => files.length > 0));
};
const submit = async () => {
  const finished = new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await window.webContents.executeJavaScript("document.getElementById('submit').click()");
  await finished;
};
const verifyDestination = async (method = "GET", body = "") => {
  const rendered = await window.webContents.executeJavaScript("({url:location.href,origin:location.origin,script:window.fixtureScriptLoaded===true,image:document.querySelector('img').naturalWidth,color:getComputedStyle(document.getElementById('watch')).color})");
  assert.deepEqual(rendered, { url: watchOrigin + "/welcome", origin: watchOrigin, script: true, image: 20, color: "rgb(1, 2, 3)" });
  assert.equal(requests.filter(r => r.pathname.startsWith("/api/auth/callback/")).length, 1, "OAuth callback must never be replayed");
  const destination = requests.filter(r => r.pathname === "/welcome");
  assert.equal(destination.length, 1);
  assert.equal(destination[0].method, method);
  assert.equal(destination[0].body, body);
  assert(destination[0].cookies.includes("fixture-session=fixture-user"));
  assert(destination[0].cookies.includes("fixture-second=second"));
  const cookies = await session.defaultSession.cookies.get({ url: watchOrigin });
  assert(cookies.some(c => c.name === "fixture-session" && c.httpOnly));
  assert(cookies.some(c => c.name === "fixture-second"));
  assert(!cookies.some(c => c.name === "fixture-state"));
  if (installed) assert.deepEqual(await buckets(), [[], [], []]);
};
async function verify() {
  let exitCode = 1;
  try {
    await Promise.all([listen(watch), listen(provider)]);
    watchOrigin = `http://127.0.0.1:${watch.address().port}`;
    providerOrigin = `http://127.0.0.1:${provider.address().port}`;
    await app.whenReady();
    for (const intercepted of [false, true]) {
      await session.defaultSession.clearStorageData();
      await session.defaultSession.clearCache();
      if (intercepted) { installDesktopApiCache({ app, appOrigin: watchOrigin }); installed = true; }
      window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const failures = [];
      window.webContents.on("did-fail-load", (_event, code, _description, _url, mainFrame) => { if (mainFrame) failures.push(code); });
      for (const direct of [false, true]) {
        await seed();
        await window.loadURL(providerOrigin + "/signin" + (direct ? "?direct=1" : ""));
        requests.length = 0;
        await submit();
        await verifyDestination();
      }
      for (const status of [301, 302, 303, 307, 308]) {
        await seed();
        await window.loadURL(watchOrigin + "/form?status=" + status);
        requests.length = 0;
        await submit();
        await verifyDestination(status >= 307 ? "POST" : "GET", status >= 307 ? "fixture=body-preserved" : "");
      }
      assert.deepEqual(failures, []);
      const sessionsBefore = requests.filter(r => r.pathname === "/api/auth/session").length;
      await call("/api/auth/session"); await call("/api/auth/session");
      assert.equal(requests.filter(r => r.pathname === "/api/auth/session").length - sessionsBefore, intercepted ? 2 : 1);
      assert.equal(await window.webContents.executeJavaScript("fetch('/fixture-empty').then(r=>r.status)"), 204);
      if (intercepted) {
        await window.webContents.executeJavaScript(`(async()=>{ const control=new AbortController();const response=await fetch('/fixture-stream',{signal:control.signal});const reader=response.body.getReader();const first=await reader.read();if(new TextDecoder().decode(first.value)!=='data: ready\\n\\n')throw new Error('Stream did not deliver first chunk');control.abort();await reader.cancel().catch(()=>{});})()`);
        await waitFor(() => openStreams.size === 0);
        // Check transport cancellation before headers directly. Electron's rebuilt
        // protocol Request does not forward renderer aborts before headers; this
        // limitation also exists in the unchanged API/session.fetch transport.
        const controller = new AbortController();
        const pending = forwardRequest(watchOrigin + "/fixture-slow", { session: session.defaultSession, signal: controller.signal, method: "GET" }).catch(error => error.name);
        await waitFor(() => openStreams.size === 1);
        controller.abort();
        assert.equal(await pending, "AbortError");
        await waitFor(() => openStreams.size === 0);
      }
      console.log(`PASS: ${intercepted ? "protocol" : "native"} provider/direct callback, cookies, final origin/assets, POST redirects, no callback replay${intercepted ? ", cache invalidation and stream cancellation" : ""}.`);
      window.destroy(); window = null;
    }
    exitCode = 0;
  } catch (error) { console.error(error); }
  finally {
    clearTimeout(timeout);
    if (window) window.destroy();
    for (const response of openStreams) response.destroy();
    if (installed) session.defaultSession.protocol.unhandle("http");
    watch.close(); provider.close();
    if (app.isReady()) await session.defaultSession.closeAllConnections();
    // All paths are generated by this fixture, never the actual Watch profile.
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("watch-redirect-fixture-")) throw new Error("Unexpected test directory");
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    app.exit(exitCode);
  }
}
void verify();
