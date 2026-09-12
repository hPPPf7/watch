import { claimEpisodeRepair } from "@/lib/episodeRepairCooldown";
import { readEpisodeDates, type DatedEpisode, type SeasonSummary } from "@/lib/episodeDateCache";
import { fetchTmdbClient } from "@/lib/fetchTmdbClient";
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
  options?: { priority?: "foreground" | "background"; repair?: boolean },
): Promise<T[] | null> {
  return getOrLoadDetailCache<T[]>(
    seasonEpisodesCacheKey(tmdbId, season),
    async () => {
      const response = await fetchTmdbClient(
        `/api/tmdb/season?type=tv&id=${tmdbId}&season=${season}${options?.repair ? "&refresh=1&repair=1" : ""}`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      return (data.episodes ?? []) as T[];
    },
    resolveSeasonEpisodesClientTtlMs(status),
    { priority: options?.priority ?? "foreground", skipCache: options?.repair },
  );
}

// 沿用既有季端點、四個請求名額與 in-flight 合併；逐季補缺，互動請求優先。
export async function ensureEpisodeDatesCached(
  tmdbId: number,
  seasons: SeasonSummary[] | undefined,
  status?: string | null,
  shouldContinue: () => boolean = () => true,
) {
  for (const season of seasons ?? []) {
    if (!shouldContinue()) return;
    if (!Number.isSafeInteger(season.season_number) || season.season_number < 1 ||
        !Number.isSafeInteger(season.episode_count) || !season.episode_count || season.episode_count < 0) continue;
    if (readEpisodeDates(tmdbId, season.season_number, season.episode_count)) continue;
    try {
      const episodes = await fetchSeasonEpisodesCached<DatedEpisode>(tmdbId, season.season_number, status, { priority: "background" });
      if (!episodes) return; // 失敗等下一次既有檢查，不建立額外重試迴圈。
      if (episodes.length !== season.episode_count && shouldContinue() && claimEpisodeRepair(tmdbId, season.season_number)) {
        await fetchSeasonEpisodesCached<DatedEpisode>(tmdbId,season.season_number,status,{priority:"background",repair:true});
      }
    } catch { return; }
  }
}
