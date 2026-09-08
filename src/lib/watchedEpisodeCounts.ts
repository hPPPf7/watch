export function watchedEpisodeCounts(rows: { tmdbId: number; seasonNumber: number | null; episodeNumber: number | null }[]): Record<number, number> {
  const episodes = new Map<number, Set<string>>();
  for (const row of rows) {
    const seen = episodes.get(row.tmdbId) ?? new Set<string>();
    seen.add(`${row.seasonNumber ?? 0}:${row.episodeNumber ?? 0}`);
    episodes.set(row.tmdbId, seen);
  }
  return Object.fromEntries([...episodes].map(([id, seen]) => [id, seen.size]));
}
