export type EpisodeProgress = "unwatched" | "watching" | "completed";
export type FirstReleaseAlertState =
  | "pending"
  | "active"
  | "acknowledged";

type EpisodeAlertWatchCountState = {
  alertActive: boolean;
  alertNotifiedCount: number;
  watchedCount: number;
};

type EpisodeDisplayState = {
  alertMap: Record<number, boolean>;
  statusMap: Record<number, string>;
  progressMap: Record<number, EpisodeProgress>;
};

type FirstReleaseAlertInput = {
  releaseDate?: string | null;
  addedAt?: string | null;
  today: string;
  watchedCount: number;
  currentState?: FirstReleaseAlertState | null;
  previousCheckedAt?: string | null;
};

const toDateKey = (value?: string | null) => {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
};

export function resolveFirstReleaseAlertState({
  releaseDate,
  addedAt,
  today,
  watchedCount,
  currentState,
  previousCheckedAt,
}: FirstReleaseAlertInput): FirstReleaseAlertState | null {
  if (watchedCount > 0) return "acknowledged";
  if (currentState === "active" || currentState === "acknowledged") {
    return currentState;
  }
  if (!releaseDate) return currentState ?? null;
  if (releaseDate > today) return "pending";
  if (currentState === "pending") return "active";

  const previousCheckedDate = toDateKey(previousCheckedAt);
  const addedDate = toDateKey(addedAt);
  return (previousCheckedDate && previousCheckedDate < releaseDate) ||
    (addedDate && addedDate <= releaseDate)
    ? "active"
    : "acknowledged";
}

export function reconcileEpisodeAlertWatchCount({
  alertActive,
  alertNotifiedCount,
  watchedCount,
}: EpisodeAlertWatchCountState) {
  if (watchedCount <= alertNotifiedCount) {
    return {
      alertActive,
      alertNotifiedCount,
      watchCountAdvanced: false,
    };
  }

  return {
    alertActive: false,
    alertNotifiedCount: watchedCount,
    watchCountAdvanced: true,
  };
}

export function normalizeAlertedEpisodeDisplayState({
  alertMap,
  statusMap,
  progressMap,
}: EpisodeDisplayState) {
  const nextAlertMap = { ...alertMap };
  const nextStatusMap = { ...statusMap };
  const nextProgressMap = { ...progressMap };

  Object.entries(alertMap).forEach(([rawTmdbId, alertActive]) => {
    if (!alertActive) return;
    const tmdbId = Number(rawTmdbId);
    const status = nextStatusMap[tmdbId] ?? "";
    if (
      nextProgressMap[tmdbId] === "completed" ||
      status.startsWith("已看完")
    ) {
      nextAlertMap[tmdbId] = false;
    }
  });

  return {
    alertMap: nextAlertMap,
    statusMap: nextStatusMap,
    progressMap: nextProgressMap,
  };
}
