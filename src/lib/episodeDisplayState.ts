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
  authoritativeAlertMap?: Record<number, boolean>;
};

type EpisodeAlertGenerationState = {
  alert_active?: boolean | null;
  alert_notified_watch_count?: number | null;
  last_watched_count?: number | null;
  alert_started_at?: string | null;
  alert_generation?: string | null;
  alert_acknowledged_generation?: string | null;
  next_episode_season?: number | null;
  next_episode_number?: number | null;
  first_release_alert_state?: FirstReleaseAlertState | null;
};

export function collectLatestEpisodeStateUpdates<
  T extends { tmdb_id: number },
>(
  currentStateMap: Record<number, T>,
  nextStateMap: Record<number, T>,
  didStateChange: (current: T | undefined, next: T) => boolean,
) {
  return Object.values(nextStateMap).filter((nextState) =>
    didStateChange(currentStateMap[nextState.tmdb_id], nextState),
  );
}

function hasUnacknowledgedAlert(state: EpisodeAlertGenerationState): boolean {
  if (!state.alert_active) return false;
  const generation = state.alert_generation ?? null;
  const hasUnacknowledgedGeneration =
    Boolean(generation) && state.alert_acknowledged_generation !== generation;
  const hasValidLegacyAlert =
    !generation &&
    Boolean(state.alert_started_at) &&
    Boolean(state.next_episode_season) &&
    Boolean(state.next_episode_number) &&
    (state.alert_notified_watch_count ?? 0) >=
      (state.last_watched_count ?? 0);
  return hasUnacknowledgedGeneration || hasValidLegacyAlert;
}

function mergeAlertIdentityFields(
  incoming: EpisodeAlertGenerationState,
  current: EpisodeAlertGenerationState,
  priority: "incoming" | "current",
) {
  const pick = <K extends keyof EpisodeAlertGenerationState>(key: K) =>
    (priority === "incoming"
      ? (incoming[key] ?? current[key])
      : (current[key] ?? incoming[key])) ?? null;
  return {
    alert_started_at: pick("alert_started_at"),
    alert_generation: pick("alert_generation"),
    alert_acknowledged_generation: pick("alert_acknowledged_generation"),
    next_episode_season: pick("next_episode_season"),
    next_episode_number: pick("next_episode_number"),
    first_release_alert_state: pick("first_release_alert_state"),
  };
}

export function preserveActiveEpisodeAlertIdentity<
  T extends EpisodeAlertGenerationState,
>(
  incoming: T,
  current?: EpisodeAlertGenerationState,
): T {
  const hasCompleteIncomingIdentity =
    Boolean(incoming.alert_generation) ||
    (Boolean(incoming.next_episode_season) &&
      Boolean(incoming.next_episode_number));
  if (!incoming.alert_active || !current?.alert_active) {
    return incoming;
  }

  if (hasCompleteIncomingIdentity) {
    if (
      incoming.first_release_alert_state != null ||
      current.first_release_alert_state == null
    ) {
      return incoming;
    }
    return {
      ...incoming,
      first_release_alert_state: current.first_release_alert_state,
    };
  }

  return {
    ...incoming,
    ...mergeAlertIdentityFields(incoming, current, "incoming"),
  };
}

export function preserveInitialUnacknowledgedEpisodeAlert<
  T extends EpisodeAlertGenerationState,
>(
  incoming: T,
  current?: EpisodeAlertGenerationState,
): T {
  if (incoming.alert_active || !current?.alert_active) {
    return preserveActiveEpisodeAlertIdentity(incoming, current);
  }

  const currentGeneration = current.alert_generation ?? null;
  const incomingAcknowledgedCurrentGeneration =
    Boolean(currentGeneration) &&
    incoming.alert_acknowledged_generation === currentGeneration;
  const watchedCountAdvanced =
    (incoming.last_watched_count ?? 0) >
    (current.alert_notified_watch_count ?? 0);
  const firstReleaseWasAcknowledged =
    current.first_release_alert_state === "active" &&
    incoming.first_release_alert_state === "acknowledged";

  if (
    !hasUnacknowledgedAlert(current) ||
    incomingAcknowledgedCurrentGeneration ||
    watchedCountAdvanced ||
    firstReleaseWasAcknowledged
  ) {
    return incoming;
  }

  return {
    ...incoming,
    alert_active: true,
    alert_notified_watch_count:
      current.alert_notified_watch_count ??
      incoming.alert_notified_watch_count ??
      0,
    ...mergeAlertIdentityFields(incoming, current, "current"),
  };
}

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
  authoritativeAlertMap = {},
}: EpisodeDisplayState) {
  const nextAlertMap = { ...alertMap };
  const nextStatusMap = { ...statusMap };
  const nextProgressMap = { ...progressMap };

  Object.entries(authoritativeAlertMap).forEach(
    ([rawTmdbId, alertActive]) => {
      if (alertActive) {
        nextAlertMap[Number(rawTmdbId)] = true;
      }
    },
  );

  Object.entries(nextAlertMap).forEach(([rawTmdbId, alertActive]) => {
    if (!alertActive) return;
    const tmdbId = Number(rawTmdbId);
    if (authoritativeAlertMap[tmdbId]) return;
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

export function buildUnacknowledgedAlertMap(
  stateMap: Record<number, EpisodeAlertGenerationState>,
) {
  const result: Record<number, boolean> = {};
  Object.entries(stateMap).forEach(([rawTmdbId, state]) => {
    if (hasUnacknowledgedAlert(state)) {
      result[Number(rawTmdbId)] = true;
    }
  });
  return result;
}
