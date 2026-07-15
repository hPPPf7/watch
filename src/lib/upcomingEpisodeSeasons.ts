export type SeasonSummary = {
  season_number: number;
  episode_count: number | null;
};

// TMDB 常在續訂確定後就先建一個新一季的空殼（episode_count 是
// null/0，還沒任何集數）。這是「這季是否已知有實際集數」唯一的
// 判斷式，供所有需要篩掉空殼季的呼叫端共用（例如 DetailModal 找
// 下一集目標、這裡找即將播出的候選季），避免各自重寫一份、之後
// 悄悄分岔。
export function isKnownTvSeason(season: SeasonSummary): boolean {
  return season.season_number > 0 && (season.episode_count ?? 0) > 0;
}

// 「即將播出」最多只查最新的兩個已知季：目前正在播、可能還有未播出
// 集數的那一季，加上下一季已經有集數資料但還沒開播的情況。更早的
// 季一定早就播畢，不可能出現未來的 air_date；不設上限的話，長壽劇
// （例如 15 季都已知有集數、TMDB status 還不是 ended/canceled）會
// 讓這裡退化回每部劇查全部季的舊問題。
const MAX_UPCOMING_CANDIDATE_SEASONS = 2;

export function getUpcomingCandidateSeasonNumbers(
  seasons: SeasonSummary[],
): number[] {
  const knownSeasonNumbers = seasons
    .filter(isKnownTvSeason)
    .map((season) => season.season_number)
    .sort((a, b) => a - b);
  return knownSeasonNumbers.slice(-MAX_UPCOMING_CANDIDATE_SEASONS);
}
