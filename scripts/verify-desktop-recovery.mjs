// Exercises the real desktop shell without production services or user sessions.
import { app, BrowserWindow, session } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

async function verify() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "watch-recovery-check-"));
  app.setPath("userData", fixtureRoot);
  BrowserWindow.prototype.show = function () {};
  const requests = [];
  let homeDelay = 0;
  let blockedExternal = 0;
  let server;
  let exitCode = 1;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (check, label) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await delay(50);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const watchdog = setTimeout(() => { console.error("Recovery verification timed out"); app.exit(1); }, 40_000);

  try {
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, "http://fixture.local").pathname;
      requests.push({ pathname, method: req.method });
      if (pathname === "/api/profile/me") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (pathname === "/api/auth/callback/google" || pathname === "/broken-frame") {
        req.socket.destroy();
        return;
      }
      if (pathname === "/server-error") {
        res.writeHead(503, { "content-type": "text/html" });
        res.end("<h1>Fixture server unavailable</h1>");
        return;
      }
      const reply = () => {
        if (res.destroyed) return;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end('<!doctype html><html lang="zh-Hant"><title>Local Watch fixture</title><body><h1>Local Watch home</h1></body></html>');
      };
      if (pathname === "/slow") setTimeout(reply, 500);
      else if (pathname === "/" && homeDelay) setTimeout(reply, homeDelay);
      else reply();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    process.env.WATCH_DESKTOP_URL = origin;
    process.env.WATCH_DESKTOP_SKIP_UPDATE_CHECK = "1";
    await app.whenReady();
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(`${origin}/`) || details.url.startsWith("file:");
      if (!allowed) blockedExternal++;
      callback({ cancel: !allowed });
    });
    await import("../desktop/main.mjs");
    let window;
    let view;
    await until(() => {
      window = BrowserWindow.getAllWindows().find((candidate) => candidate.getBrowserView());
      view = window?.getBrowserView();
      return view?.webContents.getURL() === `${origin}/` && !view.webContents.isLoading();
    }, "initial home");
    await until(() => window.webContents.executeJavaScript('Boolean(document.getElementById("content-recovery"))'), "local shell");
    const panelState = () => window.webContents.executeJavaScript(`(() => {
      const panel = document.getElementById('content-recovery');
      const button = document.getElementById('content-retry');
      return { visible: !panel.hidden, disabled: button.disabled, text: panel.innerText,
        titlebar: !!document.getElementById('watch-desktop-titlebar'), focused: document.activeElement === button };
    })()`);
    const waitFailure = () => until(async () => {
      const state = await panelState();
      return state.visible && !state.disabled && view.getBounds().width === 0;
    }, "visible recovery");
    const clickRetry = () => window.webContents.executeJavaScript('document.querySelector("[data-retry-label]").click()');
    const waitRecovered = () => until(async () => {
      const state = await panelState();
      return !state.visible && view.getBounds().width > 0 && view.webContents.getURL() === `${origin}/`;
    }, "successful home recovery");

    assert.equal((await panelState()).visible, false);
    await view.webContents.executeJavaScript(`(() => {
      const frame = document.createElement('iframe'); frame.src = '/broken-frame'; document.body.append(frame);
    })()`);
    await delay(200);
    assert.equal((await panelState()).visible, false, "subframe failure must not hide home");
    const cancelled = view.webContents.loadURL(`${origin}/slow`).catch(() => undefined);
    await delay(30);
    await view.webContents.loadURL(`${origin}/`);
    await cancelled;
    assert.equal((await panelState()).visible, false, "superseded navigation must not hide home");

    await view.webContents.loadURL(`${origin}/api/auth/callback/google?code=fixture-one-use&state=fixture-state`).catch(() => undefined);
    await waitFailure();
    const failedState = await panelState();
    assert.equal(failedState.titlebar, true);
    assert.equal(failedState.focused, true);
    assert.match(failedState.text, /無法顯示 Watch/);
    assert.doesNotMatch(failedState.text, /fixture-one-use|fixture-state/);
    window.setSize(960, 640);
    await delay(100);
    assert.equal(view.getBounds().width, 0, "resize must not cover retry controls with failed view");
    if (process.env.WATCH_VERIFY_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.WATCH_VERIFY_SCREENSHOT_DIR, { recursive: true });
      const image = await window.webContents.capturePage();
      await fs.writeFile(path.join(process.env.WATCH_VERIFY_SCREENSHOT_DIR, "desktop-load-recovery.png"), image.toPNG());
    }
    window.webContents.reload();
    await until(async () => !window.webContents.isLoading() && (await panelState()).visible, "shell reload restores failure state");
    const callbacksBeforeRetry = requests.filter((request) => request.pathname === "/api/auth/callback/google").length;
    const homeBeforeRetry = requests.filter((request) => request.pathname === "/").length;
    homeDelay = 180;
    await clickRetry();
    await until(async () => (await panelState()).disabled, "busy retry button");
    await clickRetry();
    await waitRecovered();
    homeDelay = 0;
    assert.equal(requests.filter((request) => request.pathname === "/api/auth/callback/google").length, callbacksBeforeRetry, "must not replay callback");
    assert.equal(requests.filter((request) => request.pathname === "/").length, homeBeforeRetry + 1, "retry only once per click sequence");

    await view.webContents.loadURL(`${origin}/server-error`);
    await waitFailure();
    await delay(100);
    assert.equal((await panelState()).visible, true, "HTTP failure finish must not clear error panel");
    await clickRetry();
    await waitRecovered();
    view.webContents.forcefullyCrashRenderer();
    await waitFailure();
    await clickRetry();
    await waitRecovered();
    assert.equal(blockedExternal, 0);
    console.log("PASS: main-frame/HTTP/renderer failure shows local recovery; manual home retry works without replaying OAuth; subframe/aborted navigation ignored; shell reload and resize safe; no external requests");
    exitCode = 0;
  } catch (error) {
    console.error(error);
  } finally {
    app.removeAllListeners("window-all-closed");
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    server?.closeAllConnections();
    server?.close();
    if (path.dirname(fixtureRoot) !== os.tmpdir() || !path.basename(fixtureRoot).startsWith("watch-recovery-check-")) {
      throw new Error("Unexpected test directory");
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined);
    clearTimeout(watchdog);
    app.exit(exitCode);
  }

}
void verify();
