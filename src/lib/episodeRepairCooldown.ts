// 每季六小時最多提出一次一致性補查；跨重開保留，失敗也不立即重試。
const TTL = 6 * 3600000;
const MAX_ENTRIES = 1000;
const KEY = "watch:episode-repair-cooldown:v1";
const deadlines = new Map<string, number>();
let hydrated = false;
export function claimEpisodeRepair(id: number, season: number) {
  const now = Date.now();
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    try {
      const raw = localStorage.getItem(KEY);
      const saved: unknown = raw && raw.length <= 100000 ? JSON.parse(raw) : [];
      if (Array.isArray(saved)) for (const row of saved.slice(-MAX_ENTRIES)) {
        if (Array.isArray(row) && typeof row[0] === "string" && /^\d+:\d+$/.test(row[0]) &&
            Number.isFinite(row[1]) && row[1] > now && row[1] <= now + TTL) deadlines.set(row[0], row[1]);
      }
    } catch { /* 無法使用儲存時仍保留程序內冷卻。 */ }
  }
  for (const [key, deadline] of deadlines) if (deadline <= now) deadlines.delete(key);
  const key = `${id}:${season}`;
  if (deadlines.has(key) || deadlines.size >= MAX_ENTRIES) return false;
  deadlines.set(key, now + TTL);
  try { if (typeof window !== "undefined") localStorage.setItem(KEY,JSON.stringify([...deadlines])); } catch { /* 不阻擋載入。 */ }
  return true;
}
