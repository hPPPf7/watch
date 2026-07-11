import { TMDB_CACHE_TTL } from "@/server/tmdb/cache";
import type { DetailResponse } from "@/server/tmdb/detail";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// 播出日感知 TTL 的邊界：
// - 下限 1 小時，避免播出日凌晨附近的請求把快取打成幾分鐘一輪。
// - 上限 7 天，TMDB 的排程 / 集名仍可能修改，不要因為下一集很遠就長期不回查。
const SEASON_TTL_MIN_MS = HOUR_MS;
const SEASON_TTL_MAX_MS = 7 * DAY_MS;

// 最後一集播出後 30 天內視為「可能還在追加集數」的活躍季，維持每日回查。
const SEASON_RECENTLY_AIRED_WINDOW_MS = 30 * DAY_MS;

const ENDED_DETAIL_TTL_MS = 7 * DAY_MS;
const OLD_MOVIE_DETAIL_TTL_MS = 7 * DAY_MS;
const OLD_MOVIE_AGE_MS = 365 * DAY_MS;

const isValidDateOnlyString = (value: string | null | undefined): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

// 專案的播出日語意以台北時間為準（與推薦快取的每日刷新時間一致）。
const taipeiMidnightMs = (dateOnly: string) =>
  Date.parse(`${dateOnly}T00:00:00+08:00`);

type SeasonEpisodeForTtl = {
  air_date: string | null;
};

/**
 * 依集數播出日決定 season 快取壽命：
 * - 有未播出集數：快取活到「下一集播出日的台北凌晨」，播出日當天自然回查，
 *   下一集還很遠時就不用天天白打 TMDB（clamp 在 1 小時 ~ 7 天之間）。
 * - 全部已播出：最後一集在 30 天內視為活躍季，維持 24 小時；更久之前的
 *   完結季放寬到 7 天。
 * - 沒有任何可用播出日（含空集數清單）：資料不完整，維持既有 24 小時。
 */
export const resolveSeasonCacheTtlMs = (
  episodes: SeasonEpisodeForTtl[],
  now = Date.now(),
): number => {
  const airDateTimes = episodes
    .map((episode) => episode.air_date)
    .filter(isValidDateOnlyString)
    .map(taipeiMidnightMs)
    .filter((time) => !Number.isNaN(time));

  if (airDateTimes.length === 0 || airDateTimes.length !== episodes.length) {
    return TMDB_CACHE_TTL.season;
  }

  const futureAirTimes = airDateTimes.filter((time) => time > now);
  if (futureAirTimes.length > 0) {
    const nextAirTime = Math.min(...futureAirTimes);
    return Math.min(
      Math.max(nextAirTime - now, SEASON_TTL_MIN_MS),
      SEASON_TTL_MAX_MS,
    );
  }

  const lastAirTime = Math.max(...airDateTimes);
  if (now - lastAirTime <= SEASON_RECENTLY_AIRED_WINDOW_MS) {
    return TMDB_CACHE_TTL.season;
  }
  return SEASON_TTL_MAX_MS;
};

const isEndedTvStatus = (status: string | null | undefined) =>
  Boolean(status && ["ended", "canceled", "cancelled"].includes(status.toLowerCase()));

/**
 * detail 快取壽命：
 * - TV 已完結 / 已取消：資料幾乎不再變動，放寬到 7 天。
 * - 電影上映超過一年：同樣放寬到 7 天。
 * - 其餘（播出中、未播出、近期電影、缺日期）維持既有 24 小時。
 */
export const resolveDetailCacheTtlMs = (
  detail: DetailResponse,
  now = Date.now(),
): number => {
  if (detail.media_type === "tv") {
    return isEndedTvStatus(detail.status)
      ? ENDED_DETAIL_TTL_MS
      : TMDB_CACHE_TTL.detail;
  }

  if (isValidDateOnlyString(detail.release_date)) {
    const releaseTime = taipeiMidnightMs(detail.release_date);
    if (!Number.isNaN(releaseTime) && now - releaseTime > OLD_MOVIE_AGE_MS) {
      return OLD_MOVIE_DETAIL_TTL_MS;
    }
  }
  return TMDB_CACHE_TTL.detail;
};
