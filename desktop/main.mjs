import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserView, BrowserWindow, ipcMain, Menu, net, shell, session } from "electron";
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

const createWindow = () => {
  mainWindowCreated = true;
  const titleBarHeight = 36;
  const activeWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
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

  activeWindow.on("maximize", () => {
    activeWindow.webContents.send("watch-window-maximized", true);
  });
  activeWindow.on("unmaximize", () => {
    activeWindow.webContents.send("watch-window-maximized", false);
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
      createWindow();
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
      createWindow();
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
