// Real desktop main + shell, disposable local auth fixtures only.
// The provider lives under the local Watch origin because production navigation
// trusts only Watch and Google. Cross-site transport is checked separately by
// verify-desktop-redirect; this script tests the actual login/cache lifecycle.
import { app, BrowserWindow, session } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

async function verify() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "watch-relogin-check-"));
  app.setPath("userData", fixtureRoot);
  BrowserWindow.prototype.show = function () {};
  const requests = [];
  const usedCodes = new Set();
  const authorizedUsers = new Set(["fixture-a", "fixture-b"]);
  let nextUser = "fixture-a";
  let flow = 0;
  let holdProfile = false;
  const heldProfiles = [];
  let origin;
  let server;
  let blockedExternal = 0;
  let exitCode = 1;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (check, label) => {
    for (let i = 0; i < 120; i++) {
      if (await check()) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const watchdog = setTimeout(() => { console.error("Relogin verification timed out"); app.exit(1); }, 35_000);
  const parseCookies = header => Object.fromEntries((header ?? "").split(";").filter(Boolean).map(value => {
    const split = value.indexOf("="); return [value.slice(0, split).trim(), value.slice(split + 1)];
  }));
  const cookie = (name, value, expired = false) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${expired ? "; Max-Age=0" : ""}`;
  const json = (res, payload, status = 200, cookies = []) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...(cookies.length ? { "set-cookie": cookies } : {}) });
    res.end(JSON.stringify(payload));
  };
  const page = (res, body, status = 200) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html><html><head><title>Isolated Watch login fixture</title></head><body>${body}</body></html>`);
  };
  try {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, origin);
      let body = "";
      for await (const chunk of req) body += chunk.toString();
      const cookies = parseCookies(req.headers.cookie);
      const user = authorizedUsers.has(cookies["authjs.session-token"]) ? cookies["authjs.session-token"] : null;
      requests.push({ pathname: url.pathname, method: req.method, user });
      if (url.pathname === "/api/profile/me") {
        const reply = () => { if (!res.destroyed) json(res, user ? { id: user } : {}, user ? 200 : 401); };
        if (holdProfile) heldProfiles.push(reply);
        else reply();
        return;
      }
      if (url.pathname === "/api/auth/session") return json(res, user ? { user: { id: user } } : null);
      if (url.pathname === "/api/auth/providers") return json(res, { google: { id: "google", type: "oidc" } });
      if (url.pathname === "/api/auth/csrf") return json(res, { csrfToken: "fixture-csrf" }, 200, [cookie("fixture-csrf", "fixture-csrf")]);
      if (url.pathname === "/api/auth/signout" || url.pathname === "/api/auth/signin/google") {
        const params = new URLSearchParams(body);
        if (req.method !== "POST" || params.get("csrfToken") !== cookies["fixture-csrf"] || req.headers["x-auth-return-redirect"] !== "1" || !req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
          return json(res, { error: "fixture auth request mismatch" }, 400);
        }
        if (url.pathname === "/api/auth/signout") return json(res, { url: `${origin}/login` }, 200, [cookie("authjs.session-token", "", true)]);
        flow++;
        return json(res, { url: `${origin}/fixture-provider` }, 200, [cookie("fixture-state", `state-${flow}`), cookie("fixture-pkce", `pkce-${flow}`)]);
      }
      if (url.pathname === "/fixture-provider") {
        return page(res, '<h1>Fixture account chooser</h1><form method="post" action="/fixture-provider/choose"><input name="account" value="fixture"><button id="choose">Choose fixture account</button></form>');
      }
      if (url.pathname === "/fixture-provider/choose") {
        // Enforce browser navigation semantics which protocol re-fetching loses.
        if (req.headers["sec-fetch-mode"] !== "navigate" || req.headers["sec-fetch-dest"] !== "document" || req.headers.referer !== `${origin}/fixture-provider` || req.headers.origin !== origin) {
          return page(res, "Fixture provider requires native navigation headers", 400);
        }
        res.writeHead(302, { location: `/api/auth/callback/google?code=code-${flow}&state=state-${flow}`, "cache-control": "no-store" });
        return res.end();
      }
      if (url.pathname === "/api/auth/callback/google") {
        const code = url.searchParams.get("code");
        if (req.method !== "GET" || usedCodes.has(code) || url.searchParams.get("state") !== cookies["fixture-state"] || cookies["fixture-pkce"] !== `pkce-${flow}`) {
          return page(res, "Fixture callback state/PKCE mismatch or replay", 400);
        }
        usedCodes.add(code);
        res.writeHead(302, { location: "/", "cache-control": "no-store", "set-cookie": [cookie("authjs.session-token", nextUser), cookie("fixture-state", "", true), cookie("fixture-pkce", "", true)] });
        return res.end();
      }
      if (url.pathname.includes("revision")) return json(res, { revision: `revision-${user}` });
      if (url.pathname === "/api/watchlist/section-data") {
        if (!user) return json(res, { error: "unauthorized" }, 401);
        return json(res, { rows: [{ id: `${user}-item`, tmdb_id: 1, media_type: "movie", is_anime: false }], movieHistoryRows: [] });
      }
      if (url.pathname === "/login") {
        return page(res, `<h1>Fixture login</h1><button id="signin">Sign in</button><script>
          document.getElementById('signin').onclick=async()=>{
            await fetch('/api/auth/providers');
            const csrf=await fetch('/api/auth/csrf').then(r=>r.json());
            const result=await fetch('/api/auth/signin/google',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-auth-return-redirect':'1'},body:new URLSearchParams({csrfToken:csrf.csrfToken,callbackUrl:'/'})}).then(r=>r.json());
            location.href=result.url;
          };
        </script>`);
      }
      if (url.pathname === "/") {
        return page(res, `<h1 id="user">${user ?? "anonymous"}</h1><button id="signout">Sign out</button><script>
          document.getElementById('signout').onclick=async()=>{
            const csrf=await fetch('/api/auth/csrf').then(r=>r.json());
            const result=await fetch('/api/auth/signout',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-auth-return-redirect':'1'},body:new URLSearchParams({csrfToken:csrf.csrfToken,callbackUrl:'/login'})}).then(r=>r.json());
            location.href=result.url;
          };
        </script>`);
      }
      return page(res, "Fixture resource", 404);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    process.env.WATCH_DESKTOP_URL = origin;
    process.env.WATCH_DESKTOP_SKIP_UPDATE_CHECK = "1";
    await app.whenReady();
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(`${origin}/`) || details.url.startsWith("file:");
      if (!allowed) blockedExternal++;
      callback({ cancel: !allowed });
    });
    await session.defaultSession.cookies.set({ url: origin, name: "authjs.session-token", value: "fixture-a", httpOnly: true, sameSite: "lax" });
    await import("../desktop/main.mjs");
    let window;
    let view;
    await until(() => {
      window = BrowserWindow.getAllWindows().find(candidate => candidate.getBrowserView());
      view = window?.getBrowserView();
      return view?.webContents.getURL() === `${origin}/` && !view.webContents.isLoading();
    }, "signed-in initial home");
    const intercepted = () => session.defaultSession.protocol.isProtocolHandled("http");
    const waitPage = pathname => until(() => view.webContents.getURL() === `${origin}${pathname}` && !view.webContents.isLoading(), pathname);
    const call = pathname => view.webContents.executeJavaScript(`fetch(${JSON.stringify(pathname)}).then(r=>r.json())`);
    const click = id => view.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`);
    const assertVisible = async () => {
      assert.equal(await window.webContents.executeJavaScript("document.getElementById('content-recovery').hidden"), true);
      assert(view.getBounds().width > 0);
    };
    const assertCache = async user => {
      await until(intercepted, "authenticated cache installed");
      const pathname = "/api/watchlist/section-data?mediaType=movie";
      const before = requests.filter(request => request.pathname === "/api/watchlist/section-data").length;
      const first = await call(pathname);
      const second = await call(pathname);
      assert.equal(first.rows[0].id, `${user}-item`);
      assert.deepEqual(second, first);
      assert.equal(requests.filter(request => request.pathname === "/api/watchlist/section-data").length - before, 1, "authenticated API cache remains effective");
    };
    const login = async user => {
      nextUser = user;
      const callbacksBefore = requests.filter(request => request.pathname === "/api/auth/callback/google").length;
      await click("signin");
      await waitPage("/fixture-provider");
      assert.equal(await intercepted(), false, "provider navigation must remain native");
      await click("choose");
      await waitPage("/");
      await assertVisible();
      assert.equal(await view.webContents.executeJavaScript("document.getElementById('user').textContent"), user);
      assert.equal(requests.filter(request => request.pathname === "/api/auth/callback/google").length - callbacksBefore, 1, "one-use callback must not be replayed");
      await assertCache(user);
    };
    await assertCache("fixture-a");
    for (const user of ["fixture-a", "fixture-b"]) {
      await click("signout");
      await waitPage("/login");
      await until(async () => !await intercepted(), "confirmed signout retires interception");
      await delay(1600); // Delayed installer must not revive during anonymous login.
      assert.equal(await intercepted(), false);
      assert.equal(await call("/api/auth/session"), null);
      await login(user);
    }
    // A server-expired session can be discovered without pressing sign-out.
    authorizedUsers.delete("fixture-b");
    assert.equal(await call("/api/auth/session"), null);
    await until(async () => !await intercepted(), "confirmed session null retires interception");
    await view.webContents.loadURL(`${origin}/login`);
    await login("fixture-a");
    // A startup profile can finish after native signOut({redirect:false}) in the
    // same document, before the first cache installation exists to observe it.
    await click("signout");
    await waitPage("/login");
    await until(async () => !await intercepted(), "prepare pending-install race");
    await session.defaultSession.cookies.set({ url: origin, name: "authjs.session-token", value: "fixture-a", httpOnly: true, sameSite: "lax" });
    holdProfile = true;
    await view.webContents.loadURL(`${origin}/`);
    await until(() => heldProfiles.length > 0, "capture signed-in profile before response");
    await view.webContents.executeJavaScript(`(async()=>{
      const csrf=await fetch('/api/auth/csrf').then(r=>r.json());
      return fetch('/api/auth/signout',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-auth-return-redirect':'1'},body:new URLSearchParams({csrfToken:csrf.csrfToken,callbackUrl:'/'})}).then(r=>r.json());
    })()`);
    assert.equal(view.webContents.getURL(), `${origin}/`, "signout did not navigate");
    assert.equal(await call("/api/auth/session"), null);
    holdProfile = false;
    for (const reply of heldProfiles.splice(0)) reply();
    await delay(1600);
    assert.equal(await intercepted(), false, "late profile 200 must not revive interception after same-document logout");
    await view.webContents.loadURL(`${origin}/login`);
    await login("fixture-a");
    assert.equal(blockedExternal, 0);
    console.log("PASS: real main signed-in startup, two signout/relogin cycles and account switch, native provider POST headers, state/PKCE, one-use callbacks, expired session retirement, stale profile rejection after same-document logout, authenticated cache reuse and no external requests");
    exitCode = 0;
  } catch (error) {
    console.error(error);
  } finally {
    app.removeAllListeners("window-all-closed");
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    if (app.isReady()) {
      if (await session.defaultSession.protocol.isProtocolHandled("http")) session.defaultSession.protocol.unhandle("http");
      await session.defaultSession.closeAllConnections();
    }
    server?.closeAllConnections();
    server?.close();
    if (path.dirname(fixtureRoot) !== os.tmpdir() || !path.basename(fixtureRoot).startsWith("watch-relogin-check-")) throw new Error("Unexpected test directory");
    await fs.rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined);
    clearTimeout(watchdog);
    app.exit(exitCode);
  }
}
void verify();

