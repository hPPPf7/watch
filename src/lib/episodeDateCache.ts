// 只保存公開的集數編號／播出日期與季摘要，不保存任何觀看紀錄。
// 與完整詳情的 300 筆 LRU 分開，避免多季作品互相擠掉分母資料。
export type DatedEpisode = { episode_number: number; air_date?: string | null };
export type SeasonSummary = { season_number: number; episode_count: number | null };
type Entry = { expiresAt: number; dates?: string[]; seasons?: SeasonSummary[] };
const DAY = 86400000;
export const STABLE_EPISODE_DATES_TTL = 30 * DAY;
export const ACTIVE_EPISODE_DATES_TTL = 6 * 3600000;
const STORAGE_KEY = "watch:public-episode-dates:v1";
const MAX_ENTRIES = 1000;
const MAX_STORAGE_LENGTH = 1000000;
const entries = new Map<string, Entry>();
let hydrated = false;

export const isEpisodeDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};

function prune() {
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    if (raw.length > MAX_STORAGE_LENGTH) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return;
    for (const row of saved.slice(-MAX_ENTRIES)) {
      if (!Array.isArray(row) || row.length !== 2) continue;
      const [key, entry] = row as [string, Entry];
      if (typeof key !== "string" || !/^tv:\d+(?::season:\d+)?$/.test(key) || !entry ||
          !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now() ||
          entry.expiresAt > Date.now() + STABLE_EPISODE_DATES_TTL) continue;
      if (Array.isArray(entry.dates) && entry.dates.length > 0 && entry.dates.every(isEpisodeDate)) {
        entries.set(key, { expiresAt: entry.expiresAt, dates: entry.dates });
      } else if (Array.isArray(entry.seasons) && validSeasons(entry.seasons) &&
          entry.expiresAt <= Date.now() + ACTIVE_EPISODE_DATES_TTL) {
        entries.set(key, { expiresAt: entry.expiresAt, seasons: entry.seasons });
      }
    }
    persist(); // 啟動時一併清除過期資料；不因讀取延長期限。
  } catch { /* 禁用／額滿的本機儲存不影響網站。 */ }
}

function persist() {
  if (typeof window === "undefined") return;
  prune();
  try {
    let raw = JSON.stringify([...entries]);
    while (raw.length > MAX_STORAGE_LENGTH && entries.size) {
      entries.delete(entries.keys().next().value!);
      raw = JSON.stringify([...entries]);
    }
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch { /* 仍可用記憶體快取。 */ }
}

function validSeasons(seasons: SeasonSummary[]) {
  const seen = new Set<number>();
  return seasons.every(s => {
    if (!s || !Number.isSafeInteger(s.season_number) || s.season_number < 0 ||
        seen.has(s.season_number) || (s.episode_count !== null &&
        (!Number.isSafeInteger(s.episode_count) || s.episode_count < 0))) return false;
    seen.add(s.season_number);
    return true;
  });
}

function read(key: string) {
  hydrate();
  const entry = entries.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) { entries.delete(key); persist(); }
    return null;
  }
  return entry;
}

export function readEpisodeSeasons(id: number) {
  return read(`tv:${id}`)?.seasons ?? null;
}

export function readEpisodeDates(id: number, season: number, expectedCount?: number | null): DatedEpisode[] | null {
  const dates = read(`tv:${id}:season:${season}`)?.dates;
  if (!dates || (expectedCount !== undefined && dates.length !== expectedCount)) return null;
  return dates.map((air_date, index) => ({ episode_number: index + 1, air_date }));
}

export function resolveEpisodeDatesTtlMs(data: unknown, ttlMs: number, now = Date.now()) {
  const episodes = Array.isArray(data) ? [...data] as DatedEpisode[] : [];
  episodes.sort((a, b) => a?.episode_number - b?.episode_number);
  const stable = episodes.length > 0 && episodes.every((e, i) =>
    e?.episode_number === i + 1 && isEpisodeDate(e.air_date) &&
    now - Date.parse(`${e.air_date}T00:00:00+08:00`) > 30 * DAY);
  return stable ? STABLE_EPISODE_DATES_TTL : Math.min(ttlMs, ACTIVE_EPISODE_DATES_TTL);
}

// 僅在共用 loader 真正寫入新回應時呼叫；一般同步、本機重算及讀取不延長期限。
export function rememberEpisodeMetadata(key: string, data: unknown, ttlMs: number) {
  if (!/^tv:\d+(?::season:\d+)?$/.test(key)) return;
  hydrate();
  const now = Date.now();
  if (!key.includes(":season:")) {
    const seasons = (data as { seasons_info?: SeasonSummary[] } | null)?.seasons_info;
    if (Array.isArray(seasons) && validSeasons(seasons)) {
      entries.set(key, { seasons: seasons.map(s => ({ season_number: s.season_number, episode_count: s.episode_count })),
        expiresAt: now + Math.min(ttlMs, ACTIVE_EPISODE_DATES_TTL) });
    } else entries.delete(key);
  } else {
    const episodes = Array.isArray(data) ? [...data] as DatedEpisode[] : [];
    episodes.sort((a, b) => a?.episode_number - b?.episode_number);
    if (episodes.length && episodes.every((e, i) => e?.episode_number === i + 1 && isEpisodeDate(e.air_date))) {
      const dates = episodes.map(e => e.air_date as string);
      entries.set(key, { dates, expiresAt: now + resolveEpisodeDatesTtlMs(episodes, ttlMs, now) });
    } else entries.delete(key);
  }
  persist();
}
