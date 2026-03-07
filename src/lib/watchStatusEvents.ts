export const WATCH_STATUS_REFRESH_EVENT = "watch-status:refresh";

export const dispatchWatchStatusRefresh = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WATCH_STATUS_REFRESH_EVENT));
};
