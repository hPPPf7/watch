import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserView, BrowserWindow, ipcMain, Menu, net, screen, shell, session } from "electron";
import { installDesktopApiCache } from "./api-cache.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_APP_URL = "https://watch.han-burger.com";
const appUrl = process.env.WATCH_DESKTOP_URL || DEFAULT_APP_URL;

const isTrustedAppUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

if (!isTrustedAppUrl(appUrl)) {
  throw new Error("WATCH_DESKTOP_URL must be an http or https URL");
}

const appOrigin = new URL(appUrl).origin;
const trustedOrigins = new Set([appOrigin, "https://accounts.google.com"]);
const skipUpdateGate = process.env.WATCH_DESKTOP_SKIP_UPDATE_CHECK === "1";
let autoUpdaterInstance = null;

const getAutoUpdater = async () => {
  if (!autoUpdaterInstance) {
    const electronUpdater = await import("electron-updater");
    autoUpdaterInstance = electronUpdater.default.autoUpdater;
  }
  return autoUpdaterInstance;
};

const isTrustedNavigationUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return trustedOrigins.has(url.origin);
  } catch {
    return false;
  }
};

// 只有一般網頁協定才交給作業系統開啟；擋掉 file://、UNC 路徑與自訂協定
// （ms-msdt:、search-ms: 等），避免遠端內容觸發 shell.openExternal 造成 RCE。
const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const openExternalIfSafe = (rawUrl) => {
  let protocol;
  try {
    protocol = new URL(rawUrl).protocol;
  } catch {
    return;
  }
  if (!SAFE_EXTERNAL_PROTOCOLS.has(protocol)) {
    console.warn("[desktop] blocked openExternal for unsafe url", rawUrl);
    return;
  }
  void shell.openExternal(rawUrl);
};

app.setName("Watch");
app.setAppUserModelId("tw.hanburger.watch");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

let startupWindow = null;
let mainWindow = null;
let startupGateRunning = false;
let mainWindowCreated = false;
let desktopApiCacheInstalled = false;

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 860;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 640;
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 500;
const windowStatePath = path.join(app.getPath("userData"), "window-state.json");

// 視窗座標可能落在使用者已拔掉、關閉或縮小工作區的螢幕上，
// 需確認至少與目前某個螢幕的可用區域有重疊才還原座標，否則視窗會開在畫面外看不到
const isBoundsOnScreen = (bounds) =>
  screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });

const loadWindowState = async () => {
  try {
    const raw = await fs.readFile(windowStatePath, "utf8");
    const parsed = JSON.parse(raw);
    const { x, y, width, height, isMaximized } = parsed ?? {};
    const hasValidSize =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width >= MIN_WINDOW_WIDTH &&
      height >= MIN_WINDOW_HEIGHT;
    if (!hasValidSize) return null;
    const hasValidPosition =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      isBoundsOnScreen({ x, y, width, height });
    // 座標失效時只還原大小、位置改回置中；此時無法確定原本螢幕的可用空間，
    // 連帶略過「最大化」還原，避免用不相關的螢幕把視窗最大化到錯誤位置
    if (!hasValidPosition) {
      return { width, height, isMaximized: false };
    }
    return { x, y, width, height, isMaximized: Boolean(isMaximized) };
  } catch {
    return null;
  }
};

const captureWindowState = (window) => {
  // 視窗最大化時 getBounds() 只會回傳佔滿螢幕後的尺寸；
  // 需改用 getNormalBounds() 才能拿到使用者手動調整過、還原後應恢復的大小與位置
  const bounds = window.getNormalBounds();
  return { ...bounds, isMaximized: window.isMaximized() };
};

let saveWindowStateTimer = null;
const saveWindowState = (window) => {
  if (window.isDestroyed()) return;
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => {
    saveWindowStateTimer = null;
    if (window.isDestroyed()) return;
    const state = captureWindowState(window);
    // windowStatePath 就在 userData 根目錄下，Electron 保證該目錄已存在，不需要先 mkdir
    void fs
      .writeFile(windowStatePath, JSON.stringify(state), "utf8")
      .catch(() => undefined);
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
};

// 應用程式關閉前的最後狀態需立即落盤；若沿用上面 debounce 的非同步寫入，
// process 可能在 timer 觸發或 promise resolve 前就已結束，導致這次的視窗位置沒存到
const flushWindowStateOnQuit = (window) => {
  if (window.isDestroyed()) return;
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer);
    saveWindowStateTimer = null;
  }
  try {
    const state = captureWindowState(window);
    writeFileSync(windowStatePath, JSON.stringify(state), "utf8");
  } catch {
    // 關閉流程中寫入失敗不應阻擋視窗關閉
  }
};

const focusWindow = (window) => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
};

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusWindow(mainWindow ?? startupWindow);
  });
}

const setStartupStatus = (status) => {
  if (startupWindow?.isDestroyed() === false) {
    startupWindow.webContents.send("watch-startup-status", status);
  }
};

const createStartupWindow = () => {
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.show();
    return startupWindow;
  }
  startupWindow = new BrowserWindow({
    width: 560,
    height: 340,
    minWidth: 520,
    minHeight: 320,
    title: "Watch",
    backgroundColor: "#050505",
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "shell-preload.cjs"),
    },
  });
  startupWindow.once("ready-to-show", () => {
    startupWindow?.show();
  });
  startupWindow.on("closed", () => {
    startupWindow = null;
  });
  void startupWindow.loadFile(path.join(__dirname, "startup.html"));
  return startupWindow;
};

const closeStartupWindow = () => {
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.close();
  }
  startupWindow = null;
};

const failStartupGate = (message) => {
  setStartupStatus({
    title: "無法啟動 Watch",
    message,
    progress: false,
    retry: true,
  });
};

let windowCreationPromise = null;
// createWindow 內部在指定視窗座標前有一段 await（讀取上次視窗狀態），
// mainWindowCreated 卻在那之前就先設為 true；若這段空檔內第二次呼叫 createWindow
//（例如視窗關閉後很快再次觸發 activate），mainWindow 還是 null，會被誤判成需要
// 重新建立視窗，進而建立第二個並發的 BrowserWindow。用同一個 in-flight promise
// 讓重複呼叫等待同一次建立流程，避免重複建立。
const createWindow = () => {
  if (windowCreationPromise) return windowCreationPromise;
  windowCreationPromise = createWindowInternal().finally(() => {
    windowCreationPromise = null;
  });
  return windowCreationPromise;
};

const createWindowInternal = async () => {
  mainWindowCreated = true;
  const titleBarHeight = 36;
  const savedState = await loadWindowState();
  const activeWindow = new BrowserWindow({
    width: savedState?.width ?? DEFAULT_WINDOW_WIDTH,
    height: savedState?.height ?? DEFAULT_WINDOW_HEIGHT,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: "Watch",
    backgroundColor: "#050505",
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "shell-preload.cjs"),
    },
  });
  mainWindow = activeWindow;
  if (savedState?.isMaximized) {
    activeWindow.maximize();
  }

  const contentView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const updateContentBounds = () => {
    const bounds = activeWindow.getContentBounds();
    contentView.setBounds({
      x: 0,
      y: titleBarHeight,
      width: bounds.width,
      height: Math.max(0, bounds.height - titleBarHeight),
    });
  };

  activeWindow.setBrowserView(contentView);
  updateContentBounds();
  contentView.setAutoResize({ width: true, height: true });
  activeWindow.on("resize", updateContentBounds);
  activeWindow.on("resize", () => saveWindowState(activeWindow));
  activeWindow.on("move", () => saveWindowState(activeWindow));

  activeWindow.on("maximize", () => {
    activeWindow.webContents.send("watch-window-maximized", true);
    saveWindowState(activeWindow);
  });
  activeWindow.on("unmaximize", () => {
    activeWindow.webContents.send("watch-window-maximized", false);
    saveWindowState(activeWindow);
  });
  activeWindow.on("close", () => {
    flushWindowStateOnQuit(activeWindow);
  });
  activeWindow.on("closed", () => {
    mainWindow = null;
  });

  const tryInstallDesktopApiCache = async () => {
    if (desktopApiCacheInstalled || contentView.webContents.isDestroyed()) {
      return;
    }
    try {
      const profileUrl = new URL("/api/profile/me", appOrigin).toString();
      const response = await session.defaultSession.fetch(profileUrl, {
        cache: "no-store",
        bypassCustomProtocolHandlers: true,
      });
      if (!response.ok) {
        return;
      }
      desktopApiCacheInstalled = true;
      installDesktopApiCache({ app, appOrigin });
    } catch (error) {
      console.error("[desktop] failed to enable api cache", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const scheduleDesktopApiCacheInstall = () => {
    void tryInstallDesktopApiCache();
    setTimeout(() => {
      void tryInstallDesktopApiCache();
    }, 1500);
  };

  const sendDesktopFocusState = (focused) => {
    if (contentView.webContents.isDestroyed()) return;
    const script = `
      (() => {
        window.__WATCH_DESKTOP_FOCUSED__ = ${focused ? "true" : "false"};
        window.dispatchEvent(new CustomEvent("watch-desktop-focus-change", {
          detail: { focused: ${focused ? "true" : "false"} }
        }));
      })();
    `;
    void contentView.webContents.executeJavaScript(script, true).catch(() => undefined);
  };

  activeWindow.on("focus", () => {
    sendDesktopFocusState(true);
  });
  activeWindow.on("blur", () => {
    sendDesktopFocusState(false);
  });

  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedNavigationUrl(url)) {
      void contentView.webContents.loadURL(url);
      return { action: "deny" };
    }
    openExternalIfSafe(url);
    return { action: "deny" };
  });

  contentView.webContents.on("will-navigate", (event, url) => {
    if (isTrustedNavigationUrl(url)) {
      return;
    }
    event.preventDefault();
    openExternalIfSafe(url);
  });
  contentView.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[desktop] preload failed", {
      preloadPath,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  contentView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error("[desktop] page failed to load", {
      errorCode,
      errorDescription,
      url: validatedUrl,
    });
  });
  contentView.webContents.on("did-finish-load", scheduleDesktopApiCacheInstall);
  contentView.webContents.on("did-finish-load", () => {
    sendDesktopFocusState(activeWindow.isFocused());
  });
  contentView.webContents.on("did-navigate", scheduleDesktopApiCacheInstall);

  activeWindow.once("ready-to-show", () => {
    activeWindow.show();
  });
  activeWindow.webContents.once("did-finish-load", () => {
    if (!activeWindow.isVisible()) {
      activeWindow.show();
    }
  });
  setTimeout(() => {
    if (!activeWindow.isDestroyed() && !activeWindow.isVisible()) {
      activeWindow.show();
    }
  }, 3000);

  void activeWindow.loadFile(path.join(__dirname, "shell.html"));
  void contentView.webContents.loadURL(appUrl);
};

const ensureAppReachable = async () => {
  const response = await session.defaultSession.fetch(appUrl, {
    cache: "no-store",
    bypassCustomProtocolHandlers: true,
  });
  if (!response.ok) {
    throw new Error(`APP_UNREACHABLE_${response.status}`);
  }
};

const checkForRequiredUpdate = async () => {
  if (!app.isPackaged || skipUpdateGate) {
    setStartupStatus({
      title: "正在啟動 Watch",
      message: skipUpdateGate ? "已略過更新檢查。" : "開發模式不檢查更新。",
      progress: true,
      retry: false,
    });
    await ensureAppReachable();
    return "ready";
  }

  if (!net.isOnline()) {
    throw new Error("OFFLINE");
  }

  const autoUpdater = await getAutoUpdater();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  setStartupStatus({
    title: "正在檢查更新",
    message: "需要確認目前是最新版本，才會開啟桌面版。",
    progress: true,
    retry: false,
  });

  const updateResult = await new Promise((resolve, reject) => {
    let settled = false;
    // 90 秒 timeout 只用來守「檢查/停滯」階段；下載一有進度就重置，
    // 否則慢速網路下載大更新超過 90 秒會被誤判失敗、永遠進不了主畫面。
    let timeoutId = null;
    const armTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fail(new Error("UPDATE_CHECK_TIMEOUT"));
      }, 90_000);
    };
    armTimeout();

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      autoUpdater.removeListener("error", onError);
      autoUpdater.removeListener("update-available", onUpdateAvailable);
      autoUpdater.removeListener("update-not-available", onUpdateNotAvailable);
      autoUpdater.removeListener("download-progress", onDownloadProgress);
      autoUpdater.removeListener("update-downloaded", onUpdateDownloaded);
    };

    const settle = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onError = (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    };

    const onUpdateAvailable = (info) => {
      setStartupStatus({
        title: "正在下載更新",
        message: `找到新版本 ${info.version ?? ""}，下載完成後會自動安裝並重新開啟。`,
        progress: true,
        retry: false,
      });
    };

    const onUpdateNotAvailable = () => {
      settle("ready");
    };

    const onDownloadProgress = (progress) => {
      armTimeout();
      const percent = Number.isFinite(progress.percent)
        ? `${Math.round(progress.percent)}%`
        : "";
      setStartupStatus({
        title: "正在下載更新",
        message: percent
          ? `更新下載中：${percent}。下載完成後會自動安裝。`
          : "更新下載中，下載完成後會自動安裝。",
        progress: true,
        retry: false,
      });
    };

    const onUpdateDownloaded = () => {
      setStartupStatus({
        title: "正在安裝更新",
        message: "即將重啟並開啟最新版 Watch。",
        progress: true,
        retry: false,
      });
      settle("installing");
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true);
      }, 800);
    };

    autoUpdater.on("error", onError);
    autoUpdater.on("update-available", onUpdateAvailable);
    autoUpdater.on("update-not-available", onUpdateNotAvailable);
    autoUpdater.on("download-progress", onDownloadProgress);
    autoUpdater.on("update-downloaded", onUpdateDownloaded);

    void autoUpdater.checkForUpdates().catch(onError);
  });

  if (updateResult === "ready") {
    await ensureAppReachable();
  }
  return updateResult;
};

const runStartupGate = async () => {
  if (startupGateRunning) return;
  startupGateRunning = true;
  createStartupWindow();
  setStartupStatus({
    title: "正在檢查更新",
    message: "需要網路連線才能啟動 Watch 桌面版。",
    progress: true,
    retry: false,
  });

  try {
    const result = await checkForRequiredUpdate();
    if (result === "ready") {
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
      await createWindow();
      closeStartupWindow();
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message === "OFFLINE"
        ? "目前沒有網路連線。Watch 桌面版需要網路與最新版檢查，請連線後重新檢查。"
        : "更新或網路檢查失敗。為避免使用舊版，請確認網路可用後重新檢查。";
    failStartupGate(message);
  } finally {
    startupGateRunning = false;
  }
};

const template = [
  {
    label: "Watch",
    submenu: [
      { label: "重新載入", role: "reload" },
      { label: "強制重新載入", role: "forceReload" },
      { type: "separator" },
      { label: "開發者工具", role: "toggleDevTools" },
      { type: "separator" },
      { label: "結束", role: "quit" },
    ],
  },
  {
    label: "編輯",
    submenu: [
      { label: "復原", role: "undo" },
      { label: "重做", role: "redo" },
      { type: "separator" },
      { label: "剪下", role: "cut" },
      { label: "複製", role: "copy" },
      { label: "貼上", role: "paste" },
      { label: "全選", role: "selectAll" },
    ],
  },
  {
    label: "檢視",
    submenu: [
      { label: "放大", role: "zoomIn" },
      { label: "縮小", role: "zoomOut" },
      { label: "實際大小", role: "resetZoom" },
      { type: "separator" },
      { label: "全螢幕", role: "togglefullscreen" },
    ],
  },
];

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    void runStartupGate();

    app.on("activate", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        focusWindow(mainWindow);
        return;
      }
      if (startupWindow && !startupWindow.isDestroyed()) {
        focusWindow(startupWindow);
        return;
      }
      if (!mainWindowCreated) {
        void runStartupGate();
        return;
      }
      createWindow().catch((error) => {
        console.error("[desktop] failed to create window on activate", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  });
}

ipcMain.on("watch-window-minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("watch-app-version", () => app.getVersion());

ipcMain.on("watch-window-toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on("watch-window-close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.on("watch-startup-retry", () => {
  void runStartupGate();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
