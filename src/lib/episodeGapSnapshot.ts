export type EpisodeGapSnapshot = {
  checkedAt?: number;
  checkedDate?: string;
  season: number;
  episode: number;
  watchedCount: number;
  hasMissingEpisodes: boolean;
};

// 僅重用同一觀看位置與計數的判斷，補看／刪除紀錄後交回既有掃描重算。
export function readEpisodeGapSnapshot(
  snapshot: EpisodeGapSnapshot | undefined,
  latest: { season: number; episode: number } | null | undefined,
  watchedCount: number,
): boolean | null {
  if (!snapshot || !latest || typeof snapshot.hasMissingEpisodes !== "boolean" ||
      snapshot.season !== latest.season || snapshot.episode !== latest.episode ||
      snapshot.watchedCount !== watchedCount) return null;
  return snapshot.hasMissingEpisodes;
}

export function buildNextEpisodeLabel(state: {
  next_episode_season?: number | null;
  next_episode_number?: number | null;
  next_episode_name?: string | null;
} | null | undefined, hasMissingEpisodes: boolean) {
  if (!state?.next_episode_season || !state.next_episode_number) return null;
  const suffix = state.next_episode_name ? ` - ${state.next_episode_name}` : "";
  return `下一集：S${state.next_episode_season}E${state.next_episode_number}${suffix}${hasMissingEpisodes ? "（中間有漏集）" : ""}`;
}

export function isEpisodeGapSnapshotFresh(snapshot: EpisodeGapSnapshot | undefined, now: number, today: string) {
  const ttl = 6 * 60 * 60 * 1000;
  return typeof snapshot?.checkedAt === "number" && snapshot.checkedAt <= now &&
    Math.floor(snapshot.checkedAt / ttl) === Math.floor(now / ttl) && snapshot.checkedDate === today;
}
