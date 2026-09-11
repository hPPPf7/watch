import { getDetailCache } from "./tmdbDetailCache";

export type DisplayEpisodeProgress = { watched: number; total: number; totalKind?: "known" | "aired" };
export type SeasonSummary = { season_number: number; episode_count: number | null };
export type DatedEpisode = { episode_number: number; air_date?: string | null };
export const knownTotalHint = "總集數可能包含尚未播出的集數";
export const airedTotalHint = "依 TMDB 已知播出日期計算（台北時間），不代表串流平台已上架";
export const taipeiDate = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const validDate = (date: string | null | undefined): date is string => {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
};

// 資料不足就回退已知總數；不能把未載入的一季當作零集，也不能以季數推定已播畢。
export function calculateEpisodeProgress(
  watched: number, knownTotal: number, seasons: SeasonSummary[] | undefined,
  readSeason: (season: number) => DatedEpisode[] | null, today: string,
): DisplayEpisodeProgress {
  const fallback: DisplayEpisodeProgress = {watched, total:knownTotal, totalKind:"known"};
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
  // 來源版本不一致或已看數超過已播出數時保守回退，不截斷使用者紀錄。
  if (total !== knownTotal || aired <= 0 || watched > aired) return fallback;
  return {watched,total:aired,totalKind:"aired"};
}

export function getSharedEpisodeProgress(id: number, watched: number, knownTotal: number, today: string) {
  const detail = getDetailCache<{seasons_info?: SeasonSummary[]}>(`tv:${id}`);
  return calculateEpisodeProgress(watched,knownTotal,detail?.seasons_info,
    season => getDetailCache<DatedEpisode[]>(`tv:${id}:season:${season}`), today);
}
