/* eslint-disable @typescript-eslint/no-require-imports */
(() => {
  const { ipcRenderer } = require("electron");

  let isWindowMaximized = false;

  const updateMaximizeButton = (maximized) => {
    isWindowMaximized = maximized;
    const button = document.querySelector('button[data-action="maximize"]');
    if (!button) return;
    button.classList.toggle("is-maximized", maximized);
    button.setAttribute("aria-label", maximized ? "還原視窗" : "最大化");
    button.setAttribute("title", maximized ? "還原視窗" : "最大化");
  };

  const installWindowControls = () => {
    const versionLabel = document.querySelector("[data-app-version]");
    if (versionLabel) {
      ipcRenderer.invoke("watch-app-version")
        .then((version) => {
          if (typeof version === "string" && version.length > 0) {
            versionLabel.textContent = `Watch v${version}`;
          }
        })
        .catch(() => undefined);
    }

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (action === "minimize") {
        ipcRenderer.send("watch-window-minimize");
      }
      if (action === "maximize") {
        ipcRenderer.send("watch-window-toggle-maximize");
      }
      if (action === "close") {
        ipcRenderer.send("watch-window-close");
      }
      if (action === "retry-update") {
        ipcRenderer.send("watch-startup-retry");
      }
    });
    updateMaximizeButton(isWindowMaximized);
  };

  ipcRenderer.on("watch-startup-status", (_event, status) => {
    const title = document.getElementById("startup-title");
    const message = document.getElementById("startup-message");
    const progress = document.getElementById("startup-progress");
    const actions = document.getElementById("startup-actions");
    if (title && typeof status?.title === "string") {
      title.textContent = status.title;
    }
    if (message && typeof status?.message === "string") {
      message.textContent = status.message;
    }
    if (progress) {
      progress.toggleAttribute("hidden", status?.progress === false);
    }
    if (actions) {
      actions.classList.toggle("is-visible", Boolean(status?.retry));
    }
  });

  ipcRenderer.on("watch-window-maximized", (_event, maximized) => {
    updateMaximizeButton(Boolean(maximized));
  });

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", installWindowControls);
  } else {
    installWindowControls();
  }
})();
