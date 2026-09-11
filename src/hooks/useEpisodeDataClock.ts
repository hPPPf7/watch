"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getDetailCacheVersion, subscribeDetailCache, SHORT_DETAIL_TTL_MS } from "@/lib/tmdbDetailCache";
import { taipeiDate } from "@/lib/episodeTotals";
const serverVersion = () => 0;

// 每分鐘只看本機時鐘；只有六小時換檔才讓既有資料流程重新檢查。
// 閒置期間停止，恢復真正操作時立即檢查；不建立新的網路輪詢端點。
export default function useEpisodeDataClock(active: boolean) {
  useSyncExternalStore(subscribeDetailCache, getDetailCacheVersion, serverVersion);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const update = () => setNow(Date.now());
    queueMicrotask(update);
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, [active]);
  return { today: taipeiDate(now), refreshEpoch: Math.floor(now / SHORT_DETAIL_TTL_MS) };
}
