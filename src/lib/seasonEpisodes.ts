import {
  getOrLoadDetailCache,
  resolveSeasonEpisodesClientTtlMs,
} from "@/lib/tmdbDetailCache";

export const seasonEpisodesCacheKey = (tmdbId: number, season: number) =>
  `tv:${tmdbId}:season:${season}`;

// 共用的集數清單載入：WatchlistSection 與 DetailModal 過去各自維護
// 一份幾乎相同的實作（同 key、同 TTL 規則），抽出來避免規則分岔。
// 載入失敗回 null（不快取失敗結果），由呼叫端決定錯誤呈現方式。
export async function fetchSeasonEpisodesCached<T>(
  tmdbId: number,
  season: number,
  status?: string | null,
): Promise<T[] | null> {
  return getOrLoadDetailCache<T[]>(
    seasonEpisodesCacheKey(tmdbId, season),
    async () => {
      const response = await fetch(
        `/api/tmdb/season?type=tv&id=${tmdbId}&season=${season}`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      return (data.episodes ?? []) as T[];
    },
    resolveSeasonEpisodesClientTtlMs(status),
  );
}
