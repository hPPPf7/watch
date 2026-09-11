import { getDetailCache } from "./tmdbDetailCache";
import { isEpisodeDate, readEpisodeDates, readEpisodeSeasons } from "./episodeDateCache";
export type { DatedEpisode, SeasonSummary } from "./episodeDateCache";
import type { DatedEpisode, SeasonSummary } from "./episodeDateCache";

export type DisplayEpisodeProgress = { watched: number; total: number | null; totalKind?: "aired" };
export const unavailableAiredTotalHint = "已播出集數暫時無法確認";
export const airedTotalHint = "依 TMDB 已知播出日期計算（台北時間），不代表串流平台已上架";
export const taipeiDate = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const validDate = isEpisodeDate;

// 資料不足時不顯示分母；不能把未載入的一季當作零集，也不能以季數推定已播畢。
export function calculateEpisodeProgress(
  watched: number, knownTotal: number, seasons: SeasonSummary[] | undefined,
  readSeason: (season: number) => DatedEpisode[] | null, today: string,
): DisplayEpisodeProgress {
  const fallback: DisplayEpisodeProgress = {watched, total:null, totalKind:"aired"};
  if (!Number.isSafeInteger(watched) || watched < 0 || !seasons?.length || !validDate(today)) return fallback;
  let aired = 0;
  let total = 0;
  const seenSeasons = new Set<number>();
  for (const season of seasons) {
    if (season.season_number === 0) continue;
    if (!Number.isSafeInteger(season.season_number) || season.season_number < 1 || seenSeasons.has(season.season_number) ||
        !Number.isSafeInteger(season.episode_count) || season.episode_count === null || season.episode_count < 0) return fallback;
    seenSeasons.add(season.season_number);
    if (season.episode_count === 0) continue;
    const episodes = readSeason(season.season_number);
    if (!episodes || episodes.length !== season.episode_count) return fallback;
    const seen = new Set<number>();
    for (const episode of episodes) {
      if (!Number.isSafeInteger(episode.episode_number) || episode.episode_number < 1 ||
          episode.episode_number > season.episode_count || seen.has(episode.episode_number) || !validDate(episode.air_date)) return fallback;
      seen.add(episode.episode_number);
      if (episode.air_date <= today) aired++;
    }
    total += season.episode_count;
  }
  // 來源版本不一致或已看數超過已播出數時不偽造分母，不截斷使用者紀錄。
  if (total !== knownTotal || watched > aired) return fallback;
  return {watched,total:aired,totalKind:"aired"};
}

export function getSharedEpisodeProgress(id: number, watched: number, knownTotal: number, today: string) {
  const detail = getDetailCache<{seasons_info?: SeasonSummary[]}>(`tv:${id}`);
  const seasons = detail?.seasons_info ?? readEpisodeSeasons(id) ?? undefined;
  return calculateEpisodeProgress(watched,knownTotal,seasons,
    season => readEpisodeDates(id, season, seasons?.find(s => s.season_number === season)?.episode_count) ??
      getDetailCache<DatedEpisode[]>(`tv:${id}:season:${season}`), today);
}

export function getSharedSeasonAiredTotal(id: number, season: SeasonSummary, today: string): number | null {
  return calculateEpisodeProgress(0, season.episode_count ?? -1, [season],
    number => readEpisodeDates(id, number, season.episode_count) ??
      getDetailCache<DatedEpisode[]>(`tv:${id}:season:${number}`), today).total;
}
