// @vitest-environment jsdom
import { expect, it } from "vitest";
import { clearWatchUserCache } from "./clearWatchUserCache";
it("清除目前使用者各分區的快照與進度，保留他人與介面偏好", () => {
  localStorage.clear(); sessionStorage.clear();
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem("watchlist:section:v2:u:tv:false", "new");
    storage.setItem("watchlist:section:u:tv:false", "old"); storage.setItem("watchlist:had-data:u:movie:false", "true"); storage.setItem("watchlist:upcoming-episodes:u:tv:true", "old");
    storage.setItem("watchlist:section:other:tv:false", "keep"); storage.setItem("theme", "dark");
  }
  clearWatchUserCache("u");
  for (const storage of [localStorage, sessionStorage]) {
    expect(storage.getItem("watchlist:section:v2:u:tv:false")).toBeNull();
    expect(storage.getItem("watchlist:section:u:tv:false")).toBeNull(); expect(storage.getItem("watchlist:had-data:u:movie:false")).toBeNull(); expect(storage.getItem("watchlist:upcoming-episodes:u:tv:true")).toBeNull();
    expect(storage.getItem("watchlist:section:other:tv:false")).toBe("keep"); expect(storage.getItem("theme")).toBe("dark");
  }
});
