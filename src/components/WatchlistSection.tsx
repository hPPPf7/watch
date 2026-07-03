"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WatchlistCard from "@/components/WatchlistCard";
import DetailModal from "@/components/DetailModal";
import useAuth from "@/hooks/useAuth";
import usePageActivityState from "@/hooks/usePageActivityState";
import useProfileNames from "@/hooks/useProfileNames";
import {
  buildUnacknowledgedAlertMap,
  normalizeAlertedEpisodeDisplayState,
  reconcileEpisodeAlertWatchCount,
  resolveFirstReleaseAlertState,
  type EpisodeProgress,
  type FirstReleaseAlertState,
} from "@/lib/episodeDisplayState";
import { compareParticipantDisplayName } from "@/lib/participantSort";
import {
  getOrLoadDetailCache,
  setDetailCache,
  SHORT_DETAIL_TTL_MS,
} from "@/lib/tmdbDetailCache";
import { dispatchWatchStatusRefresh } from "@/lib/watchStatusEvents";
import {
  clearWatchlistDirtyMarker,
  getWatchlistDirtyMarker,
  markWatchlistDirty,
  WATCHLIST_DIRTY_EVENT,
  type WatchlistDirtyEventDetail,
} from "@/lib/watchlistMutationEvents";

type WatchlistItem = {
  id: string;
  tmdb_id: number;
  title: string;
  year: string | null;
  release_date: string | null;
  status?: string | null;
  tmdb_cached_at: string | null;
  tv_release_repair_checked_at?: string | null;
  tmdb_stale?: boolean;
  poster_path: string | null;
  media_type: "movie" | "tv";
  is_anime: boolean;
  created_at: string;
};

type DetailData = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
  start_year: string | null;
  end_year: string | null;
  is_anime: boolean;
  poster_path: string | null;
  release_date?: string | null;
  status?: string;
  seasons_info?: Array<{ season_number: number; episode_count: number | null }>;
};

type EpisodeInfo = {
  episode_number: number;
  name: string | null;
  air_date?: string | null;
};

type TvState = {
  tmdb_id: number;
  last_progress: "unwatched" | "watching" | "completed";
  last_total_aired: number;
  last_watched_count: number;
  alert_active: boolean;
  alert_notified_watch_count: number;
  next_episode_season?: number | null;
  next_episode_number?: number | null;
  next_episode_name?: string | null;
  next_episode_air_date?: string | null;
  last_watched_season?: number | null;
  last_watched_episode?: number | null;
  last_known_status?: string | null;
  last_checked_at?: string | null;
  alert_started_at?: string | null;
  alert_generation?: string | null;
  alert_acknowledged_generation?: string | null;
  first_release_alert_state?: FirstReleaseAlertState | null;
};

type UpcomingEpisodeItem = {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  season: number;
  episode: number;
  name: string | null;
  air_date: string;
};

type UpcomingEpisodeSnapshot = {
  storedAt: number;
  today: string;
  itemsFingerprint: string;
  episodes: UpcomingEpisodeItem[];
};

type AllTabGroups =
  | {
      kind: "tv";
      watching: WatchlistItem[];
      unwatched: WatchlistItem[];
      completed: WatchlistItem[];
    }
  | {
      kind: "movie";
      unwatched: WatchlistItem[];
      upcoming: WatchlistItem[];
      watched: WatchlistItem[];
    }
  | null;

type WatchlistSectionProps = {
  title?: string;
  mediaType: "movie" | "tv";
  isAnime?: boolean;
  filter?: "all" | "upcoming" | "unwatched" | "watched" | "watching" | "completed";
  onCountChange?: (count: number | null) => void;
  headerCount?: number | null;
};

type SectionSnapshot = {
  storedAt?: number;
  tmdbExpiresAt?: number;
  revision: string | null;
  items: WatchlistItem[];
  watchedDateMap: Record<number, string>;
  watchedCountMap: Record<number, number>;
  watchedFriendIdsMap: Record<number, Array<{ id: string; isOwner: boolean }>>;
  sharedOwnerIdMap: Record<number, string>;
  friendFallbackMap: Record<string, string | null>;
  latestEpisodeMap: Record<number, { season: number; episode: number } | null>;
  watchedEpisodeCountMap: Record<number, number>;
  watchedCreatedAtMap: Record<number, string>;
  latestWatchedDateMap: Record<number, string>;
  latestWatchedCreatedAtMap: Record<number, string>;
  tvStateMap: Record<number, TvState>;
  newEpisodeAlertMap: Record<number, boolean>;
  episodeStatusMap: Record<number, string>;
  episodeProgressMap: Record<number, EpisodeProgress>;
};

type DesktopSyncStatus =
  | "idle"
  | "local"
  | "checking"
  | "updating"
  | "synced"
  | "paused"
  | "error"
  | "remote-changed";

const SECTION_SNAPSHOT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const UPCOMING_EPISODE_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const RESUME_REVISION_CHECK_COOLDOWN_MS = 5 * 60 * 1000;
const RESUME_REVISION_CHECK_DELAY_MS = 1800;
const LOCAL_HISTORY_HYDRATION_RETRY_DELAYS_MS = [
  1500,
  4000,
  9000,
  15000,
  30000,
  60000,
];

const getMetadataLoadingKey = (mediaType: "movie" | "tv", tmdbId: number) =>
  `${mediaType}:${tmdbId}`;

const isDesktopAppRuntime = () =>
  typeof window !== "undefined" &&
  window.navigator.userAgent.toLowerCase().includes("electron");

const buildNextEpisodeLabel = (state?: TvState | null) => {
  if (!state?.next_episode_season || !state.next_episode_number) return null;
  const suffix = state.next_episode_name ? ` - ${state.next_episode_name}` : "";
  return `下一集：S${state.next_episode_season}E${state.next_episode_number}${suffix}`;
};

const hasNextEpisodeSnapshot = (state?: TvState | null) =>
  Boolean(state?.next_episode_season && state.next_episode_number);

const episodeRank = (season?: number | null, episode?: number | null) =>
  (season ?? 0) * 100000 + (episode ?? 0);

const isNextEpisodeBehindLatestWatched = (
  state: TvState | undefined,
  latest: { season: number; episode: number } | null | undefined,
) => {
  if (!state || !latest || !hasNextEpisodeSnapshot(state)) return false;
  return (
    episodeRank(state.next_episode_season, state.next_episode_number) <=
    episodeRank(latest.season, latest.episode)
  );
};

const buildFirstReleaseAlertGeneration = (releaseDate?: string | null) =>
  releaseDate ? `first-release:${releaseDate}` : null;

const buildEpisodeAlertGeneration = (
  season: number,
  episode: number,
) => `episode:${season}:${episode}`;

export default function WatchlistSection({
  title,
  mediaType,
  isAnime,
  filter = "all",
  onCountChange,
  headerCount = null,
}: WatchlistSectionProps) {
  const METADATA_HYDRATE_MAX_ATTEMPTS = 3;
  const METADATA_HYDRATE_BACKOFF_MS = 10 * 60 * 1000;
  const METADATA_HYDRATE_BATCH_SIZE = 6;
  const { session, loading: sessionLoading } = useAuth();
  const pageInactive = usePageActivityState({
    enabled: Boolean(session),
  });
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailTarget, setDetailTarget] = useState<{
    id: number;
    type: "movie" | "tv";
  } | null>(null);
  const [watchedDateMap, setWatchedDateMap] = useState<Record<number, string>>(
    {},
  );
  const [watchHistoryLoading, setWatchHistoryLoading] = useState(false);
  const [watchedCountMap, setWatchedCountMap] = useState<
    Record<number, number>
  >({});
  const [latestEpisodeMap, setLatestEpisodeMap] = useState<
    Record<number, { season: number; episode: number } | null>
  >({});
  const [episodeHistoryLoading, setEpisodeHistoryLoading] = useState(false);
  const [episodeHistoryReady, setEpisodeHistoryReady] = useState(false);
  const [episodeStatusLoading, setEpisodeStatusLoading] = useState(false);
  const [tvStateMap, setTvStateMap] = useState<Record<number, TvState>>({});
  const tvStateRef = useRef<Record<number, TvState>>({});
  const [tvStateLoading, setTvStateLoading] = useState(false);
  const [newEpisodeAlertMap, setNewEpisodeAlertMap] = useState<
    Record<number, boolean>
  >({});
  const todayStringRef = useRef<string>("");
  const [episodeStatusMap, setEpisodeStatusMap] = useState<
    Record<number, string>
  >({});
  const [episodeProgressMap, setEpisodeProgressMap] = useState<
    Record<number, EpisodeProgress>
  >({});
  const [watchedEpisodeCountMap, setWatchedEpisodeCountMap] = useState<
    Record<number, number>
  >({});
  const [watchedCreatedAtMap, setWatchedCreatedAtMap] = useState<
    Record<number, string>
  >({});
  const [latestWatchedDateMap, setLatestWatchedDateMap] = useState<
    Record<number, string>
  >({});
  const [latestWatchedCreatedAtMap, setLatestWatchedCreatedAtMap] = useState<
    Record<number, string>
  >({});
  const [upcomingEpisodes, setUpcomingEpisodes] = useState<UpcomingEpisodeItem[]>(
    [],
  );
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [detailHydrating, setDetailHydrating] = useState(false);
  const [metadataLoadingMap, setMetadataLoadingMap] = useState<
    Record<string, boolean>
  >({});
  const [cardsReady, setCardsReady] = useState(false);
  const [desktopSyncState, setDesktopSyncState] = useState<{
    status: DesktopSyncStatus;
    message: string;
    updatedAt: number | null;
  }>({
    status: "idle",
    message: "",
    updatedAt: null,
  });
  const episodeStatusRequestIdRef = useRef(0);
  const upcomingRequestIdRef = useRef(0);
  const [watchedFriendIdsMap, setWatchedFriendIdsMap] = useState<
    Record<number, Array<{ id: string; isOwner: boolean }>>
  >({});
  const [sharedOwnerIdMap, setSharedOwnerIdMap] = useState<
    Record<number, string>
  >({});
  const [friendFallbackMap, setFriendFallbackMap] = useState<
    Record<string, string | null>
  >({});
  const [itemsVersion, setItemsVersion] = useState(0);
  const [watchHistoryVersion, setWatchHistoryVersion] = useState(0);
  const [emptySectionRetryToken, setEmptySectionRetryToken] = useState(0);
  const itemsLengthRef = useRef(0);
  const sectionHasDataTriggeredRef = useRef(false);
  const allowHasDataRetryAfterEmptyRef = useRef(false);
  const [serverHasSectionDataState, setServerHasSectionDataState] = useState<{
    loaded: boolean;
    hasSectionData: boolean;
  }>({ loaded: false, hasSectionData: false });
  const serverHasSectionDataRef = useRef<{
    loaded: boolean;
    hasSectionData: boolean;
  }>({ loaded: false, hasSectionData: false });
  const watchlistRevisionRef = useRef<string | null>(null);
  const revisionCheckRunningRef = useRef(false);
  const revisionCheckPendingSourceRef = useRef<
    "poll" | "event" | "broadcast" | null
  >(null);
  const revisionCheckRequestRef = useRef<
    ((source: "poll" | "event" | "broadcast") => void) | null
  >(null);
  const dirtyRefreshRunningRef = useRef<string | null>(null);
  const previousPageInactiveRef = useRef(pageInactive);
  const resumedFromInactiveRef = useRef(false);
  const realtimeWatchlistConnectedRef = useRef(false);
  const lastRevisionCheckAtRef = useRef(0);
  const lastWatchlistEventKeyRef = useRef<string | null>(null);
  const localMutationUntilRef = useRef(0);
  const localHistoryHydrationTimerRef = useRef<number | null>(null);
  const localHistoryHydrationAttemptsRef = useRef<Record<string, number>>({});
  const cacheHydratedRef = useRef(false);
  const sectionSnapshotTmdbExpiresAtRef = useRef<number | null>(null);
  const sectionSnapshotExpiryInitializedRef = useRef(false);
  const persistedSnapshotReadyRef = useRef(false);
  const initialEmptyRetryDoneRef = useRef(false);
  const hadSectionDataRef = useRef(false);
  const suspiciousEmptyRecoveredRef = useRef(false);
  const suspiciousEmptyNotifiedRef = useRef(false);
  const metadataHydrationAttemptsRef = useRef<Record<number, number>>({});
  const metadataHydrationBlockedUntilRef = useRef<Record<number, number>>({});
  const refreshingRef = useRef<Set<number>>(new Set());
  const metadataHydrationQueueRef = useRef<WatchlistItem[]>([]);
  const metadataHydrationRunningRef = useRef(false);
  const isMountedRef = useRef(true);
  const lastStableFilteredByTabRef = useRef<Record<string, WatchlistItem[]>>(
    {},
  );
  const lastStableGroupsByMediaRef = useRef<Record<string, AllTabGroups>>({});
  const profileNameIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(watchedFriendIdsMap).forEach((list) => {
      list.forEach((entry) => ids.add(entry.id));
    });
    Object.values(sharedOwnerIdMap).forEach((id) => ids.add(id));
    return Array.from(ids);
  }, [sharedOwnerIdMap, watchedFriendIdsMap]);
  const profileNames = useProfileNames(profileNameIds);
  const resolveName = (id: string) =>
    profileNames[id]?.nickname ||
    friendFallbackMap[id] ||
    `使用者-${id.slice(0, 6)}`;
  const resolveAvatarUrl = (id: string) => profileNames[id]?.avatarUrl || null;
  const toWatchedFriends = (tmdbId: number) =>
    (watchedFriendIdsMap[tmdbId] ?? [])
      .filter((friend) => friend.id !== session?.user.id)
      .map((friend) => ({
        id: friend.id,
        name: resolveName(friend.id),
        avatarUrl: resolveAvatarUrl(friend.id),
        isOwner: friend.isOwner,
      }))
      .sort((left, right) => compareParticipantDisplayName(left, right));
  const formatAlertLabel = (
    value?: string | null,
    firstRelease = false,
  ) => {
    const defaultLabel = firstRelease ? "已開始播出" : "有新集數播出";
    if (!value) return defaultLabel;
    const started = new Date(value);
    if (Number.isNaN(started.getTime())) return defaultLabel;
    const today = new Date(`${todayString}T00:00:00`);
    if (Number.isNaN(today.getTime())) return defaultLabel;
    const days = Math.max(
      0,
      Math.floor(
        (today.getTime() - started.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    if (days <= 0) {
      return firstRelease ? "今天開始播出" : "今天有新集數播出";
    }
    return `${defaultLabel} · ${days}天前`;
  };
  const mergeRevisionCheckSource = (
    current: "poll" | "event" | "broadcast" | null,
    next: "poll" | "event" | "broadcast",
  ) => {
    const priority = { poll: 0, broadcast: 1, event: 2 } as const;
    if (!current) return next;
    return priority[next] > priority[current] ? next : current;
  };
  const statusLoading =
    mediaType === "tv"
      ? episodeHistoryLoading || episodeStatusLoading || tvStateLoading
      : watchHistoryLoading;
  const desktopRuntime = isDesktopAppRuntime();
  const showDesktopSyncState =
    desktopRuntime && Boolean(session) && desktopSyncState.message.length > 0;
  const desktopSyncToneClass =
    desktopSyncState.status === "error"
      ? "border-red-400/20 bg-red-500/10 text-red-100"
      : desktopSyncState.status === "paused"
        ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
        : desktopSyncState.status === "remote-changed" ||
            desktopSyncState.status === "updating" ||
            desktopSyncState.status === "checking"
          ? "border-sky-300/20 bg-sky-400/10 text-sky-100"
          : "border-white/10 bg-white/[0.04] text-white/60";
  const todayString = new Date().toLocaleDateString("sv-SE");
  const isUpcomingTab = mediaType === "tv" && filter === "upcoming";
  const unacknowledgedAlertMap = useMemo(
    () => buildUnacknowledgedAlertMap(tvStateMap),
    [tvStateMap],
  );
  const normalizedEpisodeDisplayState = useMemo(
    () =>
      normalizeAlertedEpisodeDisplayState({
        alertMap: newEpisodeAlertMap,
        statusMap: episodeStatusMap,
        progressMap: episodeProgressMap,
        authoritativeAlertMap: unacknowledgedAlertMap,
      }),
    [
      episodeProgressMap,
      episodeStatusMap,
      newEpisodeAlertMap,
      unacknowledgedAlertMap,
    ],
  );
  const displayedNewEpisodeAlertMap = normalizedEpisodeDisplayState.alertMap;
  const displayedEpisodeStatusMap = normalizedEpisodeDisplayState.statusMap;
  const displayedEpisodeProgressMap = normalizedEpisodeDisplayState.progressMap;
  const sectionCacheKey = useMemo(
    () =>
      `watchlist:section:${session?.user?.id ?? "anon"}:${mediaType}:${Boolean(isAnime)}`,
    [session?.user?.id, mediaType, isAnime],
  );
  const sectionHadDataKey = useMemo(
    () =>
      `watchlist:had-data:${session?.user?.id ?? "anon"}:${mediaType}:${Boolean(isAnime)}`,
    [session?.user?.id, mediaType, isAnime],
  );
  const upcomingEpisodeCacheKey = useMemo(
    () =>
      `watchlist:upcoming-episodes:${session?.user?.id ?? "anon"}:${mediaType}:${Boolean(isAnime)}`,
    [session?.user?.id, mediaType, isAnime],
  );
  const watchlistScope = useMemo(
    () => ({
      userId: session?.user?.id ?? "",
      mediaType,
      isAnime: mediaType === "tv" && Boolean(isAnime),
    }),
    [session?.user?.id, mediaType, isAnime],
  );
  const upcomingItemsFingerprint = useMemo(
    () =>
      items
        .map((item) => `${item.tmdb_id}:${item.release_date ?? ""}:${item.status ?? ""}`)
        .sort()
        .join("|"),
    [items],
  );
  useEffect(() => {
    todayStringRef.current = todayString;
  }, [todayString]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const handleWatchlistDirty = (event: Event) => {
      const detail = (event as CustomEvent<WatchlistDirtyEventDetail>).detail;
      if (
        !detail ||
        detail.scope.userId !== watchlistScope.userId ||
        detail.scope.mediaType !== watchlistScope.mediaType ||
        detail.scope.isAnime !== watchlistScope.isAnime
      ) {
        return;
      }
      setItemsVersion((prev) => prev + 1);
      setWatchHistoryVersion((prev) => prev + 1);
    };

    window.addEventListener(WATCHLIST_DIRTY_EVENT, handleWatchlistDirty);
    return () => {
      window.removeEventListener(WATCHLIST_DIRTY_EVENT, handleWatchlistDirty);
    };
  }, [session?.user?.id, watchlistScope]);

  useEffect(() => {
    watchlistRevisionRef.current = null;
    cacheHydratedRef.current = false;
    sectionSnapshotTmdbExpiresAtRef.current = null;
    sectionSnapshotExpiryInitializedRef.current = false;
    persistedSnapshotReadyRef.current = false;
    initialEmptyRetryDoneRef.current = false;
    setServerHasSectionDataState({ loaded: false, hasSectionData: false });
    serverHasSectionDataRef.current = { loaded: false, hasSectionData: false };
    suspiciousEmptyRecoveredRef.current = false;
    suspiciousEmptyNotifiedRef.current = false;
    metadataHydrationAttemptsRef.current = {};
    metadataHydrationBlockedUntilRef.current = {};
    sectionHasDataTriggeredRef.current = false;
    allowHasDataRetryAfterEmptyRef.current = false;
    hadSectionDataRef.current = false;
    if (typeof window !== "undefined") {
      hadSectionDataRef.current =
        window.sessionStorage.getItem(sectionHadDataKey) === "1" ||
        window.localStorage.getItem(sectionHadDataKey) === "1";
    }
  }, [sectionHadDataKey, session?.user.id, mediaType, isAnime]);

  const applyServerHasSectionDataState = useCallback(
    (nextState: { loaded: boolean; hasSectionData: boolean }) => {
      const currentState = serverHasSectionDataRef.current;
      serverHasSectionDataRef.current = nextState;
      if (
        currentState.loaded === nextState.loaded &&
        currentState.hasSectionData === nextState.hasSectionData
      ) {
        return false;
      }
      setServerHasSectionDataState(nextState);
      return true;
    },
    [],
  );

  const refreshHasSectionData = useCallback(async () => {
    if (!session) return null;
    const response = await fetch(
      `/api/watchlist/has-data?mediaType=${mediaType}&isAnime=${Boolean(isAnime)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { hasSectionData?: boolean };
    return {
      loaded: true,
      hasSectionData: Boolean(payload.hasSectionData),
    };
  }, [session, mediaType, isAnime]);

  useEffect(() => {
    itemsLengthRef.current = items.length;
  }, [items.length]);

  useEffect(() => {
    if (!session) return;
    let isMounted = true;
    refreshHasSectionData()
      .then((nextState) => {
        if (!isMounted || !nextState) return;
        applyServerHasSectionDataState(nextState);
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [applyServerHasSectionDataState, refreshHasSectionData, session]);

  useEffect(() => {
    if (!session) return;
    if (!serverHasSectionDataState.loaded) return;
    if (!serverHasSectionDataState.hasSectionData) return;
    if (items.length > 0) return;
    if (sectionHasDataTriggeredRef.current) return;
    sectionHasDataTriggeredRef.current = true;
    setItemsVersion((prev) => prev + 1);
  }, [items.length, emptySectionRetryToken, serverHasSectionDataState, session]);

  useEffect(() => {
    tvStateRef.current = tvStateMap;
  }, [tvStateMap]);

  useEffect(() => {
    if (!session) return;
    if (cacheHydratedRef.current) return;
    cacheHydratedRef.current = true;
    try {
      const raw =
        window.localStorage.getItem(sectionCacheKey) ??
        window.sessionStorage.getItem(sectionCacheKey);
      if (!raw) return;
      const snapshot = JSON.parse(raw) as SectionSnapshot;
      if (!snapshot || !Array.isArray(snapshot.items)) return;
      const tmdbExpiresAt =
        typeof snapshot.tmdbExpiresAt === "number" &&
        Number.isFinite(snapshot.tmdbExpiresAt)
          ? snapshot.tmdbExpiresAt
          : typeof snapshot.storedAt === "number" &&
              Number.isFinite(snapshot.storedAt)
            ? snapshot.storedAt + SECTION_SNAPSHOT_TTL_MS
            : 0;
      if (tmdbExpiresAt <= Date.now()) {
        window.localStorage.removeItem(sectionCacheKey);
        window.sessionStorage.removeItem(sectionCacheKey);
        return;
      }
      sectionSnapshotTmdbExpiresAtRef.current = tmdbExpiresAt;
      sectionSnapshotExpiryInitializedRef.current = true;
      watchlistRevisionRef.current = snapshot.revision ?? null;
      setItems(snapshot.items ?? []);
      setWatchedDateMap(snapshot.watchedDateMap ?? {});
      setWatchedCountMap(snapshot.watchedCountMap ?? {});
      setWatchedFriendIdsMap(snapshot.watchedFriendIdsMap ?? {});
      setSharedOwnerIdMap(snapshot.sharedOwnerIdMap ?? {});
      setFriendFallbackMap(snapshot.friendFallbackMap ?? {});
      setLatestEpisodeMap(snapshot.latestEpisodeMap ?? {});
      setWatchedEpisodeCountMap(snapshot.watchedEpisodeCountMap ?? {});
      setWatchedCreatedAtMap(snapshot.watchedCreatedAtMap ?? {});
      setLatestWatchedDateMap(snapshot.latestWatchedDateMap ?? {});
      setLatestWatchedCreatedAtMap(snapshot.latestWatchedCreatedAtMap ?? {});
      setTvStateMap(snapshot.tvStateMap ?? {});
      setNewEpisodeAlertMap(snapshot.newEpisodeAlertMap ?? {});
      setEpisodeStatusMap(snapshot.episodeStatusMap ?? {});
      setEpisodeProgressMap(snapshot.episodeProgressMap ?? {});
      persistedSnapshotReadyRef.current = true;
      if (isDesktopAppRuntime()) {
        setDesktopSyncState({
          status: "local",
          message: "已先顯示本機觀看紀錄，正在背景確認同步狀態。",
          updatedAt: Date.now(),
        });
      }
      setLoading(false);
      setWatchHistoryLoading(false);
      setEpisodeHistoryLoading(false);
      setEpisodeHistoryReady(true);
      setTvStateLoading(false);
      setEpisodeStatusLoading(false);
    } catch {
      // 快取內容損毀時直接忽略。
    }
  }, [sectionCacheKey, session]);

  useEffect(() => {
    if (!session) return;
    const now = Date.now();
    if (!sectionSnapshotExpiryInitializedRef.current) {
      sectionSnapshotTmdbExpiresAtRef.current =
        now + SECTION_SNAPSHOT_TTL_MS;
      sectionSnapshotExpiryInitializedRef.current = true;
    }
    const tmdbExpiresAt = sectionSnapshotTmdbExpiresAtRef.current;
    if (!tmdbExpiresAt || tmdbExpiresAt <= now) {
      window.sessionStorage.removeItem(sectionCacheKey);
      window.localStorage.removeItem(sectionCacheKey);
      return;
    }
    const snapshot: SectionSnapshot = {
      storedAt: now,
      tmdbExpiresAt,
      revision: watchlistRevisionRef.current,
      items,
      watchedDateMap,
      watchedCountMap,
      watchedFriendIdsMap,
      sharedOwnerIdMap,
      friendFallbackMap,
      latestEpisodeMap,
      watchedEpisodeCountMap,
      watchedCreatedAtMap,
      latestWatchedDateMap,
      latestWatchedCreatedAtMap,
      tvStateMap,
      newEpisodeAlertMap: displayedNewEpisodeAlertMap,
      episodeStatusMap: displayedEpisodeStatusMap,
      episodeProgressMap: displayedEpisodeProgressMap,
    };
    try {
      const serialized = JSON.stringify(snapshot);
      window.sessionStorage.setItem(sectionCacheKey, serialized);
      window.localStorage.setItem(sectionCacheKey, serialized);
    } catch {
      // 儲存空間額度不足時直接忽略。
    }
  }, [
    displayedEpisodeProgressMap,
    displayedEpisodeStatusMap,
    displayedNewEpisodeAlertMap,
    friendFallbackMap,
    items,
    latestEpisodeMap,
    latestWatchedCreatedAtMap,
    latestWatchedDateMap,
    sectionCacheKey,
    session,
    sharedOwnerIdMap,
    tvStateMap,
    watchedCountMap,
    watchedCreatedAtMap,
    watchedDateMap,
    watchedEpisodeCountMap,
    watchedFriendIdsMap,
  ]);

  const getDaysUntil = (dateString: string) => {
    const target = new Date(`${dateString}T00:00:00`);
    const today = new Date(`${todayString}T00:00:00`);
    const diffMs = target.getTime() - today.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };

  const isPlaceholderTitle = useCallback((title: string | null | undefined) => {
    if (!title) return true;
    return /^TMDB\s+\d+$/i.test(title.trim());
  }, []);

  const hasRenderableCardData = useCallback(
    (item: WatchlistItem) =>
      Boolean(item.poster_path) && !isPlaceholderTitle(item.title),
    [isPlaceholderTitle],
  );

  const hasBlockingMetadataGap = useCallback(
    (item: WatchlistItem) =>
      isPlaceholderTitle(item.title) ||
      (
        item.media_type === "movie" &&
        (
          !item.release_date ||
          item.tmdb_stale === true
        )
      ),
    [isPlaceholderTitle],
  );

  const isPreReleaseTvStatus = useCallback((status?: string | null) => {
    const normalized = status?.toLowerCase() ?? "";
    return (
      normalized === "planned" ||
      normalized === "in production" ||
      normalized === "post production"
    );
  }, []);

  const isEndedTvStatus = useCallback((status?: string | null) => {
    const normalized = status?.toLowerCase() ?? "";
    return normalized === "ended" || normalized === "canceled";
  }, []);

  const getMetadataRetryState = useCallback((tmdbId: number) => {
    return {
      attempts: metadataHydrationAttemptsRef.current[tmdbId] ?? 0,
      blockedUntil: metadataHydrationBlockedUntilRef.current[tmdbId] ?? 0,
    };
  }, []);

  const bumpMetadataRetryState = useCallback(
    (tmdbId: number) => {
      const attempts =
        (metadataHydrationAttemptsRef.current[tmdbId] ?? 0) + 1;
      metadataHydrationAttemptsRef.current[tmdbId] = attempts;
      metadataHydrationBlockedUntilRef.current[tmdbId] =
        Date.now() + METADATA_HYDRATE_BACKOFF_MS * attempts;
    },
    [METADATA_HYDRATE_BACKOFF_MS],
  );

  const deferMetadataRetryState = useCallback(
    (tmdbId: number) => {
      const attempts = metadataHydrationAttemptsRef.current[tmdbId] ?? 0;
      const backoffStep = Math.max(1, attempts);
      metadataHydrationBlockedUntilRef.current[tmdbId] =
        Date.now() + METADATA_HYDRATE_BACKOFF_MS * backoffStep;
    },
    [METADATA_HYDRATE_BACKOFF_MS],
  );

  const needsTvReleaseRepair = useCallback(
    (item: WatchlistItem) =>
      item.media_type === "tv" &&
      !item.release_date,
    [],
  );

  const isPersistedTvReleaseBackoffActive = useCallback(
    (item: WatchlistItem, now: number) => {
      if (!needsTvReleaseRepair(item)) return false;
      if (!isPreReleaseTvStatus(item.status)) return false;
      const repairCheckedAtTime = item.tv_release_repair_checked_at
        ? new Date(item.tv_release_repair_checked_at).getTime()
        : 0;
      return (
        repairCheckedAtTime > 0 &&
        now - repairCheckedAtTime < METADATA_HYDRATE_BACKOFF_MS
      );
    },
    [METADATA_HYDRATE_BACKOFF_MS, isPreReleaseTvStatus, needsTvReleaseRepair],
  );

  const shouldForceRefreshMissingTvRelease = useCallback(
    (item: WatchlistItem, now: number) => {
      if (!needsTvReleaseRepair(item)) return false;
      const { attempts, blockedUntil } = getMetadataRetryState(item.tmdb_id);
      const isPreRelease = isPreReleaseTvStatus(item.status);
      return (
        !isPersistedTvReleaseBackoffActive(item, now) &&
        (isPreRelease || attempts < METADATA_HYDRATE_MAX_ATTEMPTS) &&
        blockedUntil <= now
      );
    },
    [
      getMetadataRetryState,
      isPersistedTvReleaseBackoffActive,
      isPreReleaseTvStatus,
      needsTvReleaseRepair,
    ],
  );

  const fetchDetailCached = useCallback(async (tmdbId: number) => {
    const cacheKey = `tv:${tmdbId}`;
    return getOrLoadDetailCache<DetailData>(
      cacheKey,
      async () => {
        const response = await fetch(`/api/tmdb/detail?type=tv&id=${tmdbId}`);
        if (!response.ok) return null;
        return (await response.json()) as DetailData;
      },
      SHORT_DETAIL_TTL_MS,
    );
  }, []);

  const fetchSeasonEpisodesCached = useCallback(
    async (tmdbId: number, season: number) => {
      const cacheKey = `tv:${tmdbId}:season:${season}`;
      return getOrLoadDetailCache<EpisodeInfo[]>(
        cacheKey,
        async () => {
          const response = await fetch(
            `/api/tmdb/season?type=tv&id=${tmdbId}&season=${season}`,
          );
          if (!response.ok) return null;
          const data = await response.json();
          return (data.episodes ?? []) as EpisodeInfo[];
        },
      );
    },
    [],
  );
  const filteredItems = useMemo(() => {
    const tabKey = `${mediaType}:${filter}`;
    const getStableFallback = (allowItems: boolean) => {
      const snapshot = lastStableFilteredByTabRef.current[tabKey];
      if (snapshot) return snapshot;
      return allowItems ? items : [];
    };

    if (mediaType !== "movie") {
      const sortByCreatedAtDesc = (a: WatchlistItem, b: WatchlistItem) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      const sortByLatestWatchedDateDesc = (
        a: WatchlistItem,
        b: WatchlistItem,
      ) => {
        const aDate = latestWatchedDateMap[a.tmdb_id];
        const bDate = latestWatchedDateMap[b.tmdb_id];
        const aTime = aDate ? new Date(aDate).getTime() : 0;
        const bTime = bDate ? new Date(bDate).getTime() : 0;
        if (bTime !== aTime) return bTime - aTime;
        const aCreatedAt = latestWatchedCreatedAtMap[a.tmdb_id];
        const bCreatedAt = latestWatchedCreatedAtMap[b.tmdb_id];
        const aCreatedAtTime = aCreatedAt ? new Date(aCreatedAt).getTime() : 0;
        const bCreatedAtTime = bCreatedAt ? new Date(bCreatedAt).getTime() : 0;
        return bCreatedAtTime - aCreatedAtTime;
      };
      const sortWatchingByAlertThenLatestDesc = (
        a: WatchlistItem,
        b: WatchlistItem,
      ) => {
        const aAlert = displayedNewEpisodeAlertMap[a.tmdb_id] ? 1 : 0;
        const bAlert = displayedNewEpisodeAlertMap[b.tmdb_id] ? 1 : 0;
        if (aAlert !== bAlert) {
          return bAlert - aAlert;
        }
        return sortByLatestWatchedDateDesc(a, b);
      };
      if (filter === "unwatched") {
        if (statusLoading) return getStableFallback(false);
        const next = items
          .filter(
            (item) =>
              (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
              "unwatched",
          )
          .sort((a, b) => {
            const alertOrder =
              Number(Boolean(displayedNewEpisodeAlertMap[b.tmdb_id])) -
              Number(Boolean(displayedNewEpisodeAlertMap[a.tmdb_id]));
            return alertOrder || sortByCreatedAtDesc(a, b);
          });
        lastStableFilteredByTabRef.current[tabKey] = next;
        return next;
      }
      if (filter === "watching") {
        if (statusLoading) return getStableFallback(false);
        const next = items
          .filter(
            (item) =>
              (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
              "watching",
          )
          .sort(sortWatchingByAlertThenLatestDesc);
        lastStableFilteredByTabRef.current[tabKey] = next;
        return next;
      }
      if (filter === "completed") {
        if (statusLoading) return getStableFallback(false);
        const next = items
          .filter(
            (item) =>
              (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
              "completed",
          )
          .sort(sortWatchingByAlertThenLatestDesc);
        lastStableFilteredByTabRef.current[tabKey] = next;
        return next;
      }
      if (filter === "all") {
        if (statusLoading) return getStableFallback(true);
        const alerted = items
          .filter((item) => Boolean(displayedNewEpisodeAlertMap[item.tmdb_id]))
          .sort(sortByLatestWatchedDateDesc);
        const watching = items
          .filter(
            (item) =>
              !displayedNewEpisodeAlertMap[item.tmdb_id] &&
              (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
              "watching",
          )
          .sort(sortByLatestWatchedDateDesc);
        const unwatched = items
          .filter(
            (item) =>
              !displayedNewEpisodeAlertMap[item.tmdb_id] &&
              (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
              "unwatched",
          )
          .sort(sortByCreatedAtDesc);
        const completed = items
          .filter(
            (item) =>
              !displayedNewEpisodeAlertMap[item.tmdb_id] &&
              (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
              "completed",
          )
          .sort(sortByLatestWatchedDateDesc);
        const next = [...alerted, ...watching, ...unwatched, ...completed];
        lastStableFilteredByTabRef.current[tabKey] = next;
        return next;
      }
      const next = items;
      if (!statusLoading) {
        lastStableFilteredByTabRef.current[tabKey] = next;
      }
      return next;
    }

    const isWatched = (item: WatchlistItem) =>
      Boolean(watchedDateMap[item.tmdb_id]);
    const isUpcoming = (item: WatchlistItem) =>
      Boolean(item.release_date && item.release_date > todayString);
    const isToday = (item: WatchlistItem) =>
      Boolean(item.release_date && item.release_date === todayString);

    const sortByCreatedAtDesc = (a: WatchlistItem, b: WatchlistItem) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const sortByReleaseDateAsc = (a: WatchlistItem, b: WatchlistItem) => {
      const aTime = a.release_date ? new Date(a.release_date).getTime() : 0;
      const bTime = b.release_date ? new Date(b.release_date).getTime() : 0;
      return aTime - bTime;
    };
    const sortByWatchedDateDesc = (a: WatchlistItem, b: WatchlistItem) => {
      const aDate = watchedDateMap[a.tmdb_id];
      const bDate = watchedDateMap[b.tmdb_id];
      const aTime = aDate ? new Date(aDate).getTime() : 0;
      const bTime = bDate ? new Date(bDate).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      const aCreatedAt = watchedCreatedAtMap[a.tmdb_id];
      const bCreatedAt = watchedCreatedAtMap[b.tmdb_id];
      const aCreatedAtTime = aCreatedAt ? new Date(aCreatedAt).getTime() : 0;
      const bCreatedAtTime = bCreatedAt ? new Date(bCreatedAt).getTime() : 0;
      return bCreatedAtTime - aCreatedAtTime;
    };

    if (filter === "upcoming") {
      const next = items
        .filter((item) => isUpcoming(item))
        .sort(sortByReleaseDateAsc);
      if (!statusLoading) {
        lastStableFilteredByTabRef.current[tabKey] = next;
      }
      return next;
    }
    if (filter === "watched") {
      if (statusLoading) return getStableFallback(false);
      const next = items.filter(isWatched).sort(sortByWatchedDateDesc);
      lastStableFilteredByTabRef.current[tabKey] = next;
      return next;
    }
    if (filter === "unwatched") {
      if (statusLoading) return getStableFallback(false);
      const unwatched = items.filter((item) => !isWatched(item));
      const today = unwatched.filter(isToday).sort(sortByCreatedAtDesc);
      const rest = unwatched
        .filter((item) => !isToday(item) && !isUpcoming(item))
        .sort(sortByCreatedAtDesc);
      const next = [...today, ...rest];
      lastStableFilteredByTabRef.current[tabKey] = next;
      return next;
    }
    if (filter === "all") {
      if (statusLoading) return getStableFallback(true);
      const unwatched = items.filter((item) => !isWatched(item));
      const watched = items.filter(isWatched);
      const today = unwatched.filter(isToday).sort(sortByCreatedAtDesc);
      const upcoming = unwatched
        .filter((item) => !isToday(item) && isUpcoming(item))
        .sort(sortByReleaseDateAsc);
      const unwatchedRest = unwatched
        .filter((item) => !isToday(item) && !isUpcoming(item))
        .sort(sortByCreatedAtDesc);
      const watchedSorted = watched.sort(sortByWatchedDateDesc);
      const next = [...today, ...unwatchedRest, ...upcoming, ...watchedSorted];
      lastStableFilteredByTabRef.current[tabKey] = next;
      return next;
    }

    const next = items;
    if (!statusLoading) {
      lastStableFilteredByTabRef.current[tabKey] = next;
    }
    return next;
  }, [
    filter,
    items,
      mediaType,
      todayString,
      watchedCreatedAtMap,
      watchedDateMap,
      displayedEpisodeProgressMap,
      displayedNewEpisodeAlertMap,
      latestWatchedCreatedAtMap,
      latestWatchedDateMap,
      statusLoading,
    ]);

  const allTabGroups = useMemo<AllTabGroups>(() => {
    if (filter !== "all") return null;
    const groupsKey = `${mediaType}:all`;
    if (statusLoading) {
      return lastStableGroupsByMediaRef.current[groupsKey] ?? null;
    }
    const sortByCreatedAtDesc = (a: WatchlistItem, b: WatchlistItem) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const sortByLatestWatchedDateDesc = (a: WatchlistItem, b: WatchlistItem) => {
      const aDate = latestWatchedDateMap[a.tmdb_id];
      const bDate = latestWatchedDateMap[b.tmdb_id];
      const aTime = aDate ? new Date(aDate).getTime() : 0;
      const bTime = bDate ? new Date(bDate).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      const aCreatedAt = latestWatchedCreatedAtMap[a.tmdb_id];
      const bCreatedAt = latestWatchedCreatedAtMap[b.tmdb_id];
      const aCreatedAtTime = aCreatedAt ? new Date(aCreatedAt).getTime() : 0;
      const bCreatedAtTime = bCreatedAt ? new Date(bCreatedAt).getTime() : 0;
      return bCreatedAtTime - aCreatedAtTime;
    };
    if (mediaType === "tv") {
      const alerted = items
        .filter((item) => Boolean(displayedNewEpisodeAlertMap[item.tmdb_id]))
        .sort(sortByLatestWatchedDateDesc);
      const watching = items
        .filter(
          (item) =>
            !displayedNewEpisodeAlertMap[item.tmdb_id] &&
            (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
            "watching",
        )
        .sort(sortByLatestWatchedDateDesc);
      const unwatched = items
        .filter(
          (item) =>
            !displayedNewEpisodeAlertMap[item.tmdb_id] &&
            (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
            "unwatched",
        )
        .sort(sortByCreatedAtDesc);
      const completed = items
        .filter(
          (item) =>
            !displayedNewEpisodeAlertMap[item.tmdb_id] &&
            (displayedEpisodeProgressMap[item.tmdb_id] ?? "unwatched") ===
            "completed",
        )
        .sort(sortByLatestWatchedDateDesc);
      const next: NonNullable<AllTabGroups> = {
        kind: "tv",
        watching: [...alerted, ...watching],
        unwatched,
        completed,
      };
      lastStableGroupsByMediaRef.current[groupsKey] = next;
      return next;
    }

    const isWatched = (item: WatchlistItem) =>
      Boolean(watchedDateMap[item.tmdb_id]);
    const isUpcoming = (item: WatchlistItem) =>
      Boolean(item.release_date && item.release_date > todayString);
    const isToday = (item: WatchlistItem) =>
      Boolean(item.release_date && item.release_date === todayString);
    const sortByWatchedDateDesc = (a: WatchlistItem, b: WatchlistItem) => {
      const aDate = watchedDateMap[a.tmdb_id];
      const bDate = watchedDateMap[b.tmdb_id];
      const aTime = aDate ? new Date(aDate).getTime() : 0;
      const bTime = bDate ? new Date(bDate).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      const aCreatedAt = watchedCreatedAtMap[a.tmdb_id];
      const bCreatedAt = watchedCreatedAtMap[b.tmdb_id];
      const aCreatedAtTime = aCreatedAt ? new Date(aCreatedAt).getTime() : 0;
      const bCreatedAtTime = bCreatedAt ? new Date(bCreatedAt).getTime() : 0;
      return bCreatedAtTime - aCreatedAtTime;
    };

    const today = items.filter(isToday).sort(sortByCreatedAtDesc);
    const unwatched = items
      .filter((item) => !isWatched(item) && !isToday(item) && !isUpcoming(item))
      .sort(sortByCreatedAtDesc);
    const upcoming = items
      .filter((item) => isUpcoming(item) && !isToday(item))
      .sort((a, b) => {
        const aTime = a.release_date ? new Date(a.release_date).getTime() : 0;
        const bTime = b.release_date ? new Date(b.release_date).getTime() : 0;
        return aTime - bTime;
      });
    const watched = items.filter(isWatched).sort(sortByWatchedDateDesc);
    const unwatchedGroup = [...today, ...unwatched];
    const next = {
      kind: "movie",
      unwatched: unwatchedGroup,
      upcoming,
      watched,
    } as const;
    lastStableGroupsByMediaRef.current[groupsKey] = next;
    return next;
  }, [
    displayedEpisodeProgressMap,
    filter,
      items,
      latestWatchedCreatedAtMap,
      latestWatchedDateMap,
      mediaType,
      displayedNewEpisodeAlertMap,
      todayString,
      watchedCreatedAtMap,
      watchedDateMap,
      statusLoading,
  ]);

  const displayedCount =
    mediaType === "tv" && filter === "upcoming"
      ? upcomingEpisodes.length
      : filteredItems.length;
  const hasBlockingMetadataHydration =
    detailHydrating && items.some(hasBlockingMetadataGap);

  useEffect(() => {
    const blocking =
      sessionLoading ||
      !session ||
      loading ||
      error.length > 0 ||
      statusLoading ||
      hasBlockingMetadataHydration ||
      (isUpcomingTab && upcomingLoading);

    if (blocking) {
      setCardsReady(false);
      return;
    }

    const handle = setTimeout(() => {
      setCardsReady(true);
    }, 60);

    return () => clearTimeout(handle);
  }, [
    error.length,
    isUpcomingTab,
    loading,
    session,
    sessionLoading,
    statusLoading,
    hasBlockingMetadataHydration,
    upcomingLoading,
  ]);

  useEffect(() => {
    if (!onCountChange) return;
    if (sessionLoading || !session || loading) {
      onCountChange(null);
      return;
    }
    if (mediaType === "tv" && filter === "upcoming" && upcomingLoading) {
      onCountChange(null);
      return;
    }
    onCountChange(displayedCount);
  }, [
    displayedCount,
    loading,
    onCountChange,
    session,
    sessionLoading,
    mediaType,
    filter,
    upcomingLoading,
  ]);

  useEffect(() => {
    if (!session) return;

    const bump = () => {
      setWatchHistoryVersion((prev) => prev + 1);
    };

    const scheduleMidnight = () => {
      const now = new Date();
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        0,
        0,
      );
      return window.setTimeout(() => {
        bump();
        midnightTimerId = scheduleMidnight();
      }, next.getTime() - now.getTime());
    };

    let midnightTimerId = scheduleMidnight();

    return () => {
      window.clearTimeout(midnightTimerId);
    };
  }, [session]);

  useEffect(() => {
    if (!desktopRuntime || !session) return;
    const wasInactive = previousPageInactiveRef.current;
    previousPageInactiveRef.current = pageInactive;
    if (pageInactive) {
      resumedFromInactiveRef.current = true;
    } else if (wasInactive && desktopSyncState.status === "paused") {
      setDesktopSyncState({
        status: "idle",
        message: "",
        updatedAt: null,
      });
    }
  }, [desktopRuntime, desktopSyncState.status, pageInactive, session]);

  useEffect(() => {
    if (!session || pageInactive) return;

    let cancelled = false;
    revisionCheckRunningRef.current = false;
    revisionCheckPendingSourceRef.current = null;
    let revisionChannel: BroadcastChannel | null = null;
    let eventSource: EventSource | null = null;
    let fallbackIntervalId: number | null = null;
    let deferredRefreshTimerId: number | null = null;
    let resumeCheckTimerId: number | null = null;
    let revisionAbortController: AbortController | null = null;
    let shouldRefreshOnResumeSseFailure = false;
    let didRefreshOnResumeSseFailure = false;
    const channelName = `watchlist-revision:${session.user?.id ?? "unknown"}:${mediaType}:${Boolean(isAnime)}`;
    const FALLBACK_POLL_MS = 5 * 60 * 1000;

    const startFallbackPolling = () => {
      if (fallbackIntervalId !== null) return;
      realtimeWatchlistConnectedRef.current = false;
      fallbackIntervalId = window.setInterval(() => {
        void checkRevision("poll");
      }, FALLBACK_POLL_MS);
    };
    const stopFallbackPolling = () => {
      if (fallbackIntervalId === null) return;
      window.clearInterval(fallbackIntervalId);
      fallbackIntervalId = null;
    };

    const closeEventSource = () => {
      if (!eventSource) return;
      eventSource.close();
      eventSource = null;
    };

    const checkRevision = async (source: "poll" | "event" | "broadcast" = "poll") => {
      if (dirtyRefreshRunningRef.current !== null) {
        revisionCheckPendingSourceRef.current = mergeRevisionCheckSource(
          revisionCheckPendingSourceRef.current,
          source,
        );
        return;
      }
      if (revisionCheckRunningRef.current) {
        revisionCheckPendingSourceRef.current = mergeRevisionCheckSource(
          revisionCheckPendingSourceRef.current,
          source,
        );
        return;
      }
      revisionCheckRunningRef.current = true;
      const abortController = new AbortController();
      revisionAbortController = abortController;
      try {
        if (desktopRuntime && source !== "poll") {
          setDesktopSyncState({
            status: "checking",
            message: "偵測到同步事件，正在確認觀看紀錄是否有變更。",
            updatedAt: Date.now(),
          });
        }
        const response = await fetch(
          `/api/watchlist/revision?mediaType=${mediaType}&isAnime=${Boolean(isAnime)}`,
          { cache: "no-store", signal: abortController.signal },
        );
        lastRevisionCheckAtRef.current = Date.now();
        if (!response.ok) return;
        const payload = (await response.json()) as { revision?: string };
        if (cancelled) return;
        const nextRevision = payload.revision ?? "0";
        if (watchlistRevisionRef.current === null) {
          if (source !== "poll") {
            let nextSectionState: Awaited<
              ReturnType<typeof refreshHasSectionData>
            > = null;
            try {
              nextSectionState = await refreshHasSectionData();
            } catch {
              nextSectionState = null;
            }
            if (cancelled) return;
            if (nextSectionState) {
              if (nextSectionState.hasSectionData && itemsLengthRef.current === 0) {
                allowHasDataRetryAfterEmptyRef.current = true;
                sectionHasDataTriggeredRef.current = true;
              }
              applyServerHasSectionDataState(nextSectionState);
            }
            watchlistRevisionRef.current = nextRevision;
            setItemsVersion((prev) => prev + 1);
            setWatchHistoryVersion((prev) => prev + 1);
            return;
          }
          watchlistRevisionRef.current = nextRevision;
          return;
        }
        if (watchlistRevisionRef.current !== nextRevision) {
          if (desktopRuntime) {
            setDesktopSyncState({
              status: "remote-changed",
              message: "偵測到雲端觀看紀錄較新，正在更新本機資料。",
              updatedAt: Date.now(),
            });
          }
          if (
            source !== "poll" &&
            Date.now() < localMutationUntilRef.current
          ) {
            if (deferredRefreshTimerId === null) {
              const waitMs = Math.max(
                0,
                localMutationUntilRef.current - Date.now()
              );
              deferredRefreshTimerId = window.setTimeout(() => {
                deferredRefreshTimerId = null;
                void checkRevision("poll");
              }, waitMs + 50);
            }
            return;
          }
          let nextSectionState: Awaited<
            ReturnType<typeof refreshHasSectionData>
          > = null;
          try {
            nextSectionState = await refreshHasSectionData();
          } catch {
            nextSectionState = null;
          }
          if (cancelled) return;
          if (nextSectionState) {
            if (nextSectionState.hasSectionData && itemsLengthRef.current === 0) {
              allowHasDataRetryAfterEmptyRef.current = true;
              sectionHasDataTriggeredRef.current = true;
            }
            applyServerHasSectionDataState(nextSectionState);
          }
          watchlistRevisionRef.current = nextRevision;
          setItemsVersion((prev) => prev + 1);
          setWatchHistoryVersion((prev) => prev + 1);
          if (source !== "broadcast") {
            revisionChannel?.postMessage({ revision: nextRevision });
          }
        }
      } catch {
        if (!cancelled && desktopRuntime) {
          setDesktopSyncState({
            status: "error",
            message: "同步狀態確認失敗，稍後會自動重試。",
            updatedAt: Date.now(),
          });
        }
        // 輪詢失敗時直接忽略，避免影響目前畫面狀態。
      } finally {
        if (revisionAbortController === abortController) {
          revisionAbortController = null;
        }
        revisionCheckRunningRef.current = false;
        const pendingSource = revisionCheckPendingSourceRef.current;
        revisionCheckPendingSourceRef.current = null;
        if (!cancelled && pendingSource) {
          queueMicrotask(() => {
            void checkRevision(pendingSource);
          });
        }
      }
    };
    revisionCheckRequestRef.current = (source) => {
      void checkRevision(source);
    };

    if (typeof BroadcastChannel !== "undefined") {
      revisionChannel = new BroadcastChannel(channelName);
      revisionChannel.onmessage = () => {
        void checkRevision("broadcast");
      };
    }

    if (typeof EventSource !== "undefined") {
      eventSource = new EventSource("/api/events/watchlist/stream");
      eventSource.onopen = () => {
        realtimeWatchlistConnectedRef.current = true;
        stopFallbackPolling();
      };
      eventSource.onmessage = (event) => {
        let payload: { type?: string; reason?: string; at?: number } | null = null;
        try {
          payload = JSON.parse(event.data) as {
            type?: string;
            reason?: string;
            at?: number;
          };
          if (payload.type !== "watchlist_update") return;
        } catch {
          return;
        }
        const eventKey =
          typeof payload.at === "number"
            ? `${payload.reason ?? "unknown"}:${payload.at}`
            : null;
        if (eventKey && eventKey === lastWatchlistEventKeyRef.current) {
          return;
        }
        lastWatchlistEventKeyRef.current = eventKey;
        void checkRevision("event");
      };
      eventSource.onerror = () => {
        realtimeWatchlistConnectedRef.current = false;
        if (
          shouldRefreshOnResumeSseFailure &&
          !didRefreshOnResumeSseFailure
        ) {
          didRefreshOnResumeSseFailure = true;
          void checkRevision("poll");
        }
        // 瀏覽器會自動重連；斷線期間先用後備輪詢維持更新。
        startFallbackPolling();
      };
    } else {
      realtimeWatchlistConnectedRef.current = false;
      startFallbackPolling();
    }

    const isResumeCheck = resumedFromInactiveRef.current;
    resumedFromInactiveRef.current = false;
    const canSkipResumeCheck =
      isResumeCheck &&
      (realtimeWatchlistConnectedRef.current ||
        (watchlistRevisionRef.current !== null &&
          Date.now() - lastRevisionCheckAtRef.current <
            RESUME_REVISION_CHECK_COOLDOWN_MS));
    shouldRefreshOnResumeSseFailure =
      Boolean(isResumeCheck && realtimeWatchlistConnectedRef.current);
    const hasPendingDirtyRefresh = Boolean(
      getWatchlistDirtyMarker(watchlistScope),
    );
    if (!canSkipResumeCheck && isResumeCheck && !hasPendingDirtyRefresh) {
      resumeCheckTimerId = window.setTimeout(() => {
        resumeCheckTimerId = null;
        void checkRevision("poll");
      }, RESUME_REVISION_CHECK_DELAY_MS);
    } else if (!canSkipResumeCheck && !hasPendingDirtyRefresh) {
      void checkRevision("poll");
    }

    return () => {
      cancelled = true;
      revisionCheckRunningRef.current = false;
      revisionCheckPendingSourceRef.current = null;
      stopFallbackPolling();
      if (resumeCheckTimerId !== null) {
        window.clearTimeout(resumeCheckTimerId);
      }
      if (deferredRefreshTimerId !== null) {
        window.clearTimeout(deferredRefreshTimerId);
      }
      revisionAbortController?.abort();
      closeEventSource();
      revisionChannel?.close();
      revisionCheckRequestRef.current = null;
    };
  }, [
    applyServerHasSectionDataState,
    desktopRuntime,
    pageInactive,
    refreshHasSectionData,
    session,
    watchlistScope,
    mediaType,
    isAnime,
  ]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      if (!persistedSnapshotReadyRef.current) {
        setLoading(true);
      }
      if (desktopRuntime) {
        setDesktopSyncState({
          status: persistedSnapshotReadyRef.current ? "checking" : "updating",
          message: persistedSnapshotReadyRef.current
            ? "正在背景確認本機觀看紀錄是否仍為最新。"
            : "正在讀取觀看紀錄。",
          updatedAt: Date.now(),
        });
      }
      setError("");
    });

    const loadSectionData = async () => {
      let dirtyMarker: string | null = null;
      try {
        if (!persistedSnapshotReadyRef.current) {
          if (mediaType === "movie") {
            setWatchHistoryLoading(true);
          } else {
            setEpisodeHistoryReady(false);
            setEpisodeHistoryLoading(true);
            setTvStateLoading(true);
          }
        }
        dirtyMarker = getWatchlistDirtyMarker(watchlistScope);
        if (dirtyMarker) {
          dirtyRefreshRunningRef.current = dirtyMarker;
        }
        const refreshParam = dirtyMarker ? "&refresh=1" : "";
        const response = await fetch(
          `/api/watchlist/section-data?mediaType=${mediaType}&isAnime=${Boolean(isAnime)}${refreshParam}`,
          { cache: "no-store" },
        );
        if (!isMounted) return;
        const desktopCacheState = response.headers.get("x-watch-desktop-cache");
        if (!response.ok) {
          if (desktopRuntime) {
            setDesktopSyncState({
              status: "error",
              message: "觀看紀錄同步失敗，請稍後再試。",
              updatedAt: Date.now(),
            });
          }
          setError("讀取清單失敗，請稍後再試。");
          setItems([]);
          if (mediaType === "movie") {
            setWatchedDateMap({});
            setWatchedCreatedAtMap({});
            setWatchedCountMap({});
            setWatchedFriendIdsMap({});
            setSharedOwnerIdMap({});
            setFriendFallbackMap({});
          } else {
            setLatestEpisodeMap({});
            setWatchedEpisodeCountMap({});
            setLatestWatchedDateMap({});
            setLatestWatchedCreatedAtMap({});
            setWatchedDateMap({});
            setWatchedCreatedAtMap({});
            setTvStateMap({});
            setNewEpisodeAlertMap({});
          }
          return;
        }
        const payload = (await response.json()) as {
          rows?: WatchlistItem[];
          movieHistoryRows?: Array<{
            tmdb_id: number;
            watched_at: string | null;
            created_at?: string | null;
            owner_id: string | null;
            watch_count?: number | null;
            friend_id: string | null;
            friend_nickname: string | null;
            is_owner: boolean | null;
          }>;
          latestEpisodes?: Record<string, { season: number; episode: number }>;
          watchedCounts?: Record<string, number>;
          latestWatchedDates?: Record<string, string>;
          latestWatchedCreatedAts?: Record<string, string>;
          tvStateRows?: TvState[];
          revision?: string;
        };
        if (dirtyMarker) {
          if (payload.revision) {
            watchlistRevisionRef.current = payload.revision;
          }
          clearWatchlistDirtyMarker(watchlistScope, dirtyMarker);
        }
        if (desktopRuntime) {
          const message =
            desktopCacheState === "hit"
              ? "已使用本機觀看紀錄，雲端版本未變更。"
              : desktopCacheState === "local-history"
                ? "已先顯示本機觀看紀錄，正在背景確認雲端版本。"
              : desktopCacheState === "stale-friends"
                ? "好友資料已更新，已重新同步觀看紀錄。"
                : desktopCacheState === "miss" ||
                    desktopCacheState === "invalidated"
                  ? "已從雲端更新觀看紀錄並保存到本機。"
                  : "觀看紀錄已同步。";
          setDesktopSyncState({
            status:
              desktopCacheState === "hit"
                ? "local"
                : desktopCacheState === "local-history"
                  ? "checking"
                  : "synced",
            message,
            updatedAt: Date.now(),
          });
        }
        if (desktopCacheState === "local-history") {
          const attempts = localHistoryHydrationAttemptsRef.current[sectionCacheKey] ?? 0;
          const retryDelay = LOCAL_HISTORY_HYDRATION_RETRY_DELAYS_MS[attempts];
          if (retryDelay !== undefined && localHistoryHydrationTimerRef.current === null) {
            localHistoryHydrationAttemptsRef.current[sectionCacheKey] = attempts + 1;
            localHistoryHydrationTimerRef.current = window.setTimeout(() => {
              localHistoryHydrationTimerRef.current = null;
              setItemsVersion((prev) => prev + 1);
              setWatchHistoryVersion((prev) => prev + 1);
            }, retryDelay);
          }
        } else {
          localHistoryHydrationAttemptsRef.current[sectionCacheKey] = 0;
        }
        const rows = payload.rows ?? [];
        if (rows.length > 0) {
          allowHasDataRetryAfterEmptyRef.current = false;
        } else if (
          serverHasSectionDataState.loaded &&
          serverHasSectionDataState.hasSectionData &&
          (allowHasDataRetryAfterEmptyRef.current || itemsLengthRef.current > 0)
        ) {
          sectionHasDataTriggeredRef.current = false;
          allowHasDataRetryAfterEmptyRef.current = false;
          setEmptySectionRetryToken((prev) => prev + 1);
        }
        setItems((prev) => {
          const previousById = new Map(prev.map((item) => [item.id, item]));
          return rows.map((row) => {
            const current = previousById.get(row.id);
            if (!current) return row;
            const mergedTvRepairCheckedAt =
              row.media_type === "tv"
                ? current.tv_release_repair_checked_at ?? null
                : null;
            const currentHasRenderableData = hasRenderableCardData(current);
            const rowHasRenderableData = hasRenderableCardData(row);
            if (!currentHasRenderableData || rowHasRenderableData) {
              return {
                ...row,
                status:
                  row.media_type === "tv"
                    ? row.status ?? current.status ?? null
                    : row.status,
                tv_release_repair_checked_at: mergedTvRepairCheckedAt,
              };
            }
            return {
              ...row,
              title: current.title,
              year: current.year,
              release_date: current.release_date,
              status: current.status ?? null,
              tmdb_cached_at: current.tmdb_cached_at,
              tv_release_repair_checked_at: mergedTvRepairCheckedAt,
              tmdb_stale: current.tmdb_stale,
              poster_path: current.poster_path,
              is_anime: current.is_anime,
            };
          });
        });
        if (rows.length > 0) {
          hadSectionDataRef.current = true;
          suspiciousEmptyRecoveredRef.current = false;
          suspiciousEmptyNotifiedRef.current = false;
          setError("");
          try {
            window.sessionStorage.setItem(sectionHadDataKey, "1");
            window.localStorage.setItem(sectionHadDataKey, "1");
          } catch {
            // 儲存失敗時直接忽略。
          }
        }
        if (
          rows.length === 0 &&
          itemsVersion === 0 &&
          !initialEmptyRetryDoneRef.current
        ) {
          initialEmptyRetryDoneRef.current = true;
          window.setTimeout(() => {
            setItemsVersion((prev) => prev + 1);
          }, 1200);
        }
        if (
          rows.length === 0 &&
          serverHasSectionDataState.loaded &&
          !serverHasSectionDataState.hasSectionData
        ) {
          hadSectionDataRef.current = false;
          suspiciousEmptyRecoveredRef.current = false;
          suspiciousEmptyNotifiedRef.current = false;
          try {
            window.sessionStorage.removeItem(sectionHadDataKey);
            window.localStorage.removeItem(sectionHadDataKey);
          } catch {
            // 儲存失敗時直接忽略。
          }
        }
        const shouldTreatAsSuspiciousEmpty =
          rows.length === 0 &&
          serverHasSectionDataState.loaded &&
          serverHasSectionDataState.hasSectionData &&
          Date.now() >= localMutationUntilRef.current &&
          hadSectionDataRef.current;

        if (shouldTreatAsSuspiciousEmpty) {
          if (!suspiciousEmptyRecoveredRef.current) {
            suspiciousEmptyRecoveredRef.current = true;
            try {
              window.sessionStorage.removeItem(sectionCacheKey);
              window.localStorage.removeItem(sectionCacheKey);
            } catch {
              // 儲存失敗時直接忽略。
            }
            window.setTimeout(() => {
              if (!isMounted) return;
              setItemsVersion((prev) => prev + 1);
              setWatchHistoryVersion((prev) => prev + 1);
            }, 180);
            return;
          }
          if (!suspiciousEmptyNotifiedRef.current) {
            suspiciousEmptyNotifiedRef.current = true;
            setError(
              "偵測到登入狀態可能不同步，已重抓仍為空；請重新登入後再試。"
            );
          }
        }
        if (mediaType === "movie") {
          const latestDateByTmdb: Record<number, string> = {};
          const latestCreatedAtByTmdb: Record<number, string> = {};
          const nextDates: Record<number, string> = {};
          const nextCreatedAts: Record<number, string> = {};
          const nextCounts: Record<number, number> = {};
          const nextFriends: Record<number, Array<{ id: string; isOwner: boolean }>> = {};
          const nextSharedOwner: Record<number, string> = {};
          const nextFallbacks: Record<string, string | null> = {};
          const historyRows = payload.movieHistoryRows ?? [];

          historyRows.forEach((row) => {
            if (row.watched_at) {
              const current = latestDateByTmdb[row.tmdb_id];
              const createdAt = row.created_at ?? row.watched_at;
              if (
                !current ||
                row.watched_at > current ||
                (row.watched_at === current &&
                  createdAt > (latestCreatedAtByTmdb[row.tmdb_id] ?? ""))
              ) {
                latestDateByTmdb[row.tmdb_id] = row.watched_at;
                latestCreatedAtByTmdb[row.tmdb_id] = createdAt;
              }
            }
            if (
              typeof row.watch_count === "number" &&
              (nextCounts[row.tmdb_id] === undefined ||
                row.watch_count > (nextCounts[row.tmdb_id] ?? 0))
            ) {
              nextCounts[row.tmdb_id] = row.watch_count;
            }
            if (row.friend_id) {
              nextFallbacks[row.friend_id] = row.friend_nickname ?? null;
            }
          });

          historyRows.forEach((row) => {
            const latestDate = latestDateByTmdb[row.tmdb_id];
            if (!latestDate || row.watched_at !== latestDate) return;
            nextDates[row.tmdb_id] = latestDate;
            nextCreatedAts[row.tmdb_id] = latestCreatedAtByTmdb[row.tmdb_id] ?? latestDate;
            if (row.owner_id && row.owner_id !== session.user.id) {
              nextSharedOwner[row.tmdb_id] = row.owner_id;
            }
            if (!row.friend_id || row.friend_id === session.user.id) return;
            nextFallbacks[row.friend_id] = row.friend_nickname ?? null;
            const current = nextFriends[row.tmdb_id] ?? [];
            if (!current.some((entry) => entry.id === row.friend_id)) {
              nextFriends[row.tmdb_id] = [
                ...current,
                { id: row.friend_id, isOwner: Boolean(row.is_owner) },
              ];
            }
          });

          Object.entries(nextSharedOwner).forEach(([key, ownerId]) => {
            const tmdbId = Number(key);
            const current = nextFriends[tmdbId];
            if (!current || current.length === 0) return;
            const withoutOwner = current.filter((entry) => entry.id !== ownerId);
            nextFriends[tmdbId] = [{ id: ownerId, isOwner: true }, ...withoutOwner];
          });

          setWatchedDateMap(nextDates);
          setWatchedCreatedAtMap(nextCreatedAts);
          setWatchedCountMap(nextCounts);
          setWatchedFriendIdsMap(nextFriends);
          setSharedOwnerIdMap(nextSharedOwner);
          setFriendFallbackMap(nextFallbacks);
        } else {
          const nextEpisodes: Record<number, { season: number; episode: number } | null> =
            {};
          Object.entries(payload.latestEpisodes ?? {}).forEach(([key, value]) => {
            const tmdbId = Number(key);
            if (!Number.isNaN(tmdbId) && value) {
              nextEpisodes[tmdbId] = value;
            }
          });

          const nextCounts: Record<number, number> = {};
          Object.entries(payload.watchedCounts ?? {}).forEach(([key, value]) => {
            const tmdbId = Number(key);
            if (!Number.isNaN(tmdbId) && typeof value === "number") {
              nextCounts[tmdbId] = value;
            }
          });

          const nextDates: Record<number, string> = {};
          Object.entries(payload.latestWatchedDates ?? {}).forEach(([key, value]) => {
            const tmdbId = Number(key);
            if (!Number.isNaN(tmdbId) && typeof value === "string") {
              nextDates[tmdbId] = value;
            }
          });

          const nextCreatedAts: Record<number, string> = {};
          Object.entries(payload.latestWatchedCreatedAts ?? {}).forEach(([key, value]) => {
            const tmdbId = Number(key);
            if (!Number.isNaN(tmdbId) && typeof value === "string") {
              nextCreatedAts[tmdbId] = value;
            }
          });

          const nextStateMap: Record<number, TvState> = {};
          const nextAlertMap: Record<number, boolean> = {};
          (payload.tvStateRows ?? []).forEach((row) => {
            nextStateMap[row.tmdb_id] = row;
            nextAlertMap[row.tmdb_id] = Boolean(row.alert_active);
          });
          const preservePersistedTvState =
            desktopCacheState === "local-history" &&
            persistedSnapshotReadyRef.current;

          setLatestEpisodeMap(nextEpisodes);
          setWatchedEpisodeCountMap(nextCounts);
          setLatestWatchedDateMap(nextDates);
          setLatestWatchedCreatedAtMap(nextCreatedAts);
          setWatchedDateMap(nextDates);
          setWatchedCreatedAtMap(nextCreatedAts);
          setTvStateMap((current) =>
            preservePersistedTvState
              ? { ...nextStateMap, ...current }
              : nextStateMap,
          );
          setNewEpisodeAlertMap((current) =>
            preservePersistedTvState
              ? { ...nextAlertMap, ...current }
              : nextAlertMap,
          );
        }
      } finally {
        if (
          dirtyMarker &&
          dirtyRefreshRunningRef.current === dirtyMarker
        ) {
          dirtyRefreshRunningRef.current = null;
          const pendingSource = revisionCheckPendingSourceRef.current;
          revisionCheckPendingSourceRef.current = null;
          if (pendingSource) {
            queueMicrotask(() => {
              revisionCheckRequestRef.current?.(pendingSource);
            });
          }
        }
        if (!isMounted) return;
        setLoading(false);
        if (mediaType === "movie") {
          setWatchHistoryLoading(false);
        } else {
          setEpisodeHistoryLoading(false);
          setEpisodeHistoryReady(true);
          setTvStateLoading(false);
        }
      }
    };

    loadSectionData();

    return () => {
      isMounted = false;
    };
  }, [
    desktopRuntime,
    hasRenderableCardData,
    sectionCacheKey,
    sectionHadDataKey,
    serverHasSectionDataState,
    session,
    watchlistScope,
    mediaType,
    isAnime,
    itemsVersion,
    watchHistoryVersion,
  ]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (localHistoryHydrationTimerRef.current !== null) {
        window.clearTimeout(localHistoryHydrationTimerRef.current);
        localHistoryHydrationTimerRef.current = null;
      }
    };
  }, []);

  const hydrateMetadataBatch = useCallback(() => {
    if (metadataHydrationRunningRef.current) return;
    const nextBatch = metadataHydrationQueueRef.current.splice(
      0,
      METADATA_HYDRATE_BATCH_SIZE,
    );
    if (nextBatch.length === 0) {
      if (isMountedRef.current) {
        setDetailHydrating(false);
      }
      return;
    }

    metadataHydrationRunningRef.current = true;
    if (isMountedRef.current) {
      setDetailHydrating(true);
    }

    void Promise.all(
      nextBatch.map((item) => {
        const metadataLoadingKey = getMetadataLoadingKey(
          item.media_type,
          item.tmdb_id,
        );
        const requestStartedAt = Date.now();
        refreshingRef.current.add(item.tmdb_id);
        if (!hasRenderableCardData(item) && isMountedRef.current) {
          setMetadataLoadingMap((prev) => ({ ...prev, [metadataLoadingKey]: true }));
        }
        const forceTvReleaseRefresh = shouldForceRefreshMissingTvRelease(
          item,
          requestStartedAt,
        );
        const detailUrl = forceTvReleaseRefresh
          ? `/api/tmdb/detail?type=${item.media_type}&id=${item.tmdb_id}&refresh=1`
          : `/api/tmdb/detail?type=${item.media_type}&id=${item.tmdb_id}`;

        return fetch(detailUrl)
          .then(async (response) => {
            if (!response.ok) throw new Error("detail failed");
            return response.json();
          })
          .then((detail: DetailData) => {
            const hasRenderableDetail =
              Boolean(detail.poster_path) && !isPlaceholderTitle(detail.title);
            const releaseDate = detail.release_date ?? null;
            const shouldBackoffTvReleaseRepair =
              needsTvReleaseRepair(item) &&
              !releaseDate;
            const isPreReleaseRepair =
              shouldBackoffTvReleaseRepair &&
              isPreReleaseTvStatus(detail.status ?? item.status);
            const nextRepairCheckedAt =
              shouldBackoffTvReleaseRepair &&
              isPreReleaseRepair &&
              forceTvReleaseRefresh
                ? new Date().toISOString()
                : item.tv_release_repair_checked_at ?? null;
            const nextCachedAt =
              isPreReleaseRepair && !forceTvReleaseRefresh
                ? item.tmdb_cached_at
                : new Date().toISOString();
            if (hasRenderableDetail) {
              setDetailCache(
                `${item.media_type}:${item.tmdb_id}`,
                detail,
                SHORT_DETAIL_TTL_MS,
              );
              if (shouldBackoffTvReleaseRepair) {
                if (isPreReleaseRepair) {
                  deferMetadataRetryState(item.tmdb_id);
                } else {
                  bumpMetadataRetryState(item.tmdb_id);
                }
              } else {
                delete metadataHydrationAttemptsRef.current[item.tmdb_id];
                delete metadataHydrationBlockedUntilRef.current[item.tmdb_id];
              }
            } else {
              bumpMetadataRetryState(item.tmdb_id);
            }

            if (isMountedRef.current) {
              setItems((prev) =>
                prev.map((current) =>
                  current.tmdb_id === item.tmdb_id
                    ? {
                        ...current,
                        title: detail.title || current.title,
                        year: detail.year ?? current.year,
                        release_date: releaseDate ?? current.release_date,
                        status: detail.status ?? current.status ?? null,
                        poster_path: detail.poster_path ?? current.poster_path,
                        is_anime: detail.is_anime,
                        tmdb_cached_at: nextCachedAt,
                        tv_release_repair_checked_at: nextRepairCheckedAt,
                        tmdb_stale: false,
                      }
                    : current,
                ),
              );
            }

            return fetch("/api/home/watchlist-sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                item: {
                  type: item.media_type,
                  id: item.tmdb_id,
                  title: detail.title ?? item.title ?? "",
                  year: detail.year ?? item.year ?? null,
                  releaseDate,
                  posterPath: detail.poster_path ?? item.poster_path ?? null,
                  isAnime: detail.is_anime,
                },
              }),
            });
          })
          .catch(() => {
            bumpMetadataRetryState(item.tmdb_id);
            return undefined;
          })
          .finally(() => {
            refreshingRef.current.delete(item.tmdb_id);
            if (isMountedRef.current) {
              setMetadataLoadingMap((prev) => {
                if (!prev[metadataLoadingKey]) return prev;
                const next = { ...prev };
                delete next[metadataLoadingKey];
                return next;
              });
            }
          });
      }),
    ).finally(() => {
      metadataHydrationRunningRef.current = false;
      if (metadataHydrationQueueRef.current.length > 0) {
        queueMicrotask(hydrateMetadataBatch);
        return;
      }
      if (isMountedRef.current) {
        setDetailHydrating(false);
      }
    });
  }, [
    METADATA_HYDRATE_BATCH_SIZE,
    deferMetadataRetryState,
    hasRenderableCardData,
    isPlaceholderTitle,
    isPreReleaseTvStatus,
    bumpMetadataRetryState,
    needsTvReleaseRepair,
    shouldForceRefreshMissingTvRelease,
  ]);

  useEffect(() => {
    if (!session) {
      metadataHydrationQueueRef.current = [];
      setDetailHydrating(false);
      setMetadataLoadingMap({});
      return;
    }
    if (items.length === 0) {
      metadataHydrationQueueRef.current = [];
      setDetailHydrating(false);
      setMetadataLoadingMap({});
      return;
    }

    const staleThreshold = Date.now() - 1000 * 60 * 60 * 24 * 14;
    const now = Date.now();
    const staleItems = items.filter((item) => {
      if (!hasRenderableCardData(item)) {
        const { attempts, blockedUntil } = getMetadataRetryState(item.tmdb_id);
        if (attempts >= METADATA_HYDRATE_MAX_ATTEMPTS) return false;
        if (blockedUntil > now) return false;
        return true;
      }
      if (isPersistedTvReleaseBackoffActive(item, now)) return false;
      if (needsTvReleaseRepair(item)) {
        const { attempts, blockedUntil } = getMetadataRetryState(item.tmdb_id);
        if (
          !isPreReleaseTvStatus(item.status) &&
          attempts >= METADATA_HYDRATE_MAX_ATTEMPTS
        ) {
          return false;
        }
        if (blockedUntil > now) return false;
        return true;
      }
      if (item.tmdb_stale) return true;
      if (!item.tmdb_cached_at) return true;
      return new Date(item.tmdb_cached_at).getTime() < staleThreshold;
    });
    const queuedIds = new Set(metadataHydrationQueueRef.current.map((item) => item.tmdb_id));
    staleItems.forEach((item) => {
      if (refreshingRef.current.has(item.tmdb_id)) return;
      if (queuedIds.has(item.tmdb_id)) return;
      metadataHydrationQueueRef.current.push(item);
      queuedIds.add(item.tmdb_id);
    });

    if (metadataHydrationQueueRef.current.length === 0) {
      setDetailHydrating(false);
      return;
    }

    hydrateMetadataBatch();
  }, [
    METADATA_HYDRATE_BACKOFF_MS,
    METADATA_HYDRATE_BATCH_SIZE,
    METADATA_HYDRATE_MAX_ATTEMPTS,
    getMetadataRetryState,
    hasRenderableCardData,
    hydrateMetadataBatch,
    isPlaceholderTitle,
    isPersistedTvReleaseBackoffActive,
    isPreReleaseTvStatus,
    items,
    needsTvReleaseRepair,
    session,
  ]);


  useEffect(() => {
    if (mediaType !== "tv") return;
    if (!session || items.length === 0) return;
    if (episodeHistoryLoading || tvStateLoading) {
      if (!persistedSnapshotReadyRef.current) {
        setEpisodeStatusLoading(false);
      }
      return;
    }
    if (!episodeHistoryReady) {
      if (!persistedSnapshotReadyRef.current) {
        setEpisodeStatusLoading(true);
      }
      return;
    }
    const requestId = ++episodeStatusRequestIdRef.current;
    const nowIso = new Date().toISOString();

    const buildStatus = async () => {
      const nextMap: Record<number, string> = {};
      const nextProgress: Record<number, EpisodeProgress> = {};
      const nextAlertMap: Record<number, boolean> = {};
      const nextStateMap: Record<number, TvState> = { ...tvStateRef.current };
      const stateUpdates: TvState[] = [];
      const today = todayStringRef.current || todayString;
      const didStateChange = (prev: TvState | undefined, next: TvState) =>
        !prev ||
        prev.last_progress !== next.last_progress ||
        prev.last_total_aired !== next.last_total_aired ||
        prev.last_watched_count !== next.last_watched_count ||
        prev.alert_active !== next.alert_active ||
        prev.alert_notified_watch_count !== next.alert_notified_watch_count ||
        (prev.next_episode_season ?? null) !== (next.next_episode_season ?? null) ||
        (prev.next_episode_number ?? null) !== (next.next_episode_number ?? null) ||
        (prev.next_episode_name ?? null) !== (next.next_episode_name ?? null) ||
        (prev.next_episode_air_date ?? null) !==
          (next.next_episode_air_date ?? null) ||
        (prev.last_watched_season ?? null) !== (next.last_watched_season ?? null) ||
        (prev.last_watched_episode ?? null) !== (next.last_watched_episode ?? null) ||
        prev.last_known_status !== next.last_known_status ||
        (prev.alert_started_at ?? null) !== (next.alert_started_at ?? null) ||
        (prev.alert_generation ?? null) !== (next.alert_generation ?? null) ||
        (prev.first_release_alert_state ?? null) !==
          (next.first_release_alert_state ?? null);

      if (!persistedSnapshotReadyRef.current) {
        setEpisodeStatusLoading(true);
      }
      for (const item of items) {
        const prevState = tvStateRef.current[item.tmdb_id];
        const unwatchedLabel =
          (item.release_date
            ? item.release_date > today
            : isPreReleaseTvStatus(item.status))
            ? "尚未播出"
            : "尚未觀看任何集數";
        let alertActive = prevState?.alert_active ?? false;
        let alertNotifiedCount =
          prevState?.alert_notified_watch_count ??
          prevState?.last_watched_count ??
          0;
        let alertStartedAt = prevState?.alert_started_at ?? null;
        let alertGeneration = prevState?.alert_generation ?? null;
        if (
          alertActive &&
          !alertGeneration &&
          prevState?.next_episode_season &&
          prevState.next_episode_number
        ) {
          alertGeneration = buildEpisodeAlertGeneration(
            prevState.next_episode_season,
            prevState.next_episode_number,
          );
        }
        if (alertActive && !alertStartedAt) {
          alertStartedAt = nowIso;
        }
        let totalAired = prevState?.last_total_aired ?? 0;
        const latest = latestEpisodeMap[item.tmdb_id];
        const watchedCount = watchedEpisodeCountMap[item.tmdb_id] ?? 0;
        let firstReleaseAlertState = resolveFirstReleaseAlertState({
          releaseDate: item.release_date,
          addedAt: new Date(item.created_at).toLocaleDateString("sv-SE"),
          today,
          watchedCount,
          currentState: prevState?.first_release_alert_state,
          previousCheckedAt: prevState?.last_checked_at
            ? new Date(prevState.last_checked_at).toLocaleDateString("sv-SE")
            : null,
        });
        const reconciledAlert = reconcileEpisodeAlertWatchCount({
          alertActive,
          alertNotifiedCount,
          watchedCount,
        });
        alertActive = reconciledAlert.alertActive;
        alertNotifiedCount = reconciledAlert.alertNotifiedCount;
        const watchCountAdvanced = reconciledAlert.watchCountAdvanced;
        if (watchCountAdvanced) {
          alertStartedAt = null;
        }
        const snapshotLabel = buildNextEpisodeLabel(prevState);
        const canUseNextEpisodeSnapshot =
          isDesktopAppRuntime() &&
          !isUpcomingTab &&
          prevState?.last_progress === "watching" &&
          prevState.last_watched_count === watchedCount &&
          (prevState.last_watched_season ?? null) === latest?.season &&
          (prevState.last_watched_episode ?? null) === latest?.episode &&
          !isNextEpisodeBehindLatestWatched(prevState, latest) &&
          hasNextEpisodeSnapshot(prevState) &&
          Boolean(snapshotLabel);
        if (!latest || watchedCount === 0) {
          if (firstReleaseAlertState === "active") {
            alertActive = true;
            alertNotifiedCount = 0;
            alertGeneration = buildFirstReleaseAlertGeneration(
              item.release_date,
            );
            if (!alertStartedAt) {
              alertStartedAt = item.release_date
                ? new Date(`${item.release_date}T00:00:00`).toISOString()
                : nowIso;
            }
          }
          if (
            alertActive &&
            alertGeneration &&
            prevState?.alert_acknowledged_generation === alertGeneration
          ) {
            alertActive = false;
            alertStartedAt = null;
            if (firstReleaseAlertState === "active") {
              firstReleaseAlertState = "acknowledged";
            }
          }
          nextMap[item.tmdb_id] = unwatchedLabel;
          nextProgress[item.tmdb_id] = "unwatched";
          if (alertActive && watchedCount > alertNotifiedCount) {
            alertActive = false;
            alertStartedAt = null;
          }
          nextAlertMap[item.tmdb_id] = alertActive;
          const nextState: TvState = {
            tmdb_id: item.tmdb_id,
            last_progress: "unwatched",
            last_total_aired: totalAired,
            last_watched_count: watchedCount,
            alert_active: alertActive,
            alert_notified_watch_count: alertNotifiedCount,
            next_episode_season: null,
            next_episode_number: null,
            next_episode_name: null,
            next_episode_air_date: null,
            last_watched_season: latest?.season ?? null,
            last_watched_episode: latest?.episode ?? null,
            last_known_status: prevState?.last_known_status ?? null,
            last_checked_at: nowIso,
            alert_started_at: alertStartedAt,
            alert_generation: alertGeneration,
            alert_acknowledged_generation:
              prevState?.alert_acknowledged_generation ?? null,
            first_release_alert_state: firstReleaseAlertState,
          };
          nextStateMap[item.tmdb_id] = nextState;
          if (didStateChange(prevState, nextState)) {
            stateUpdates.push(nextState);
          }
          continue;
        }
        if (canUseNextEpisodeSnapshot && snapshotLabel) {
          if (
            alertActive &&
            alertGeneration &&
            prevState?.alert_acknowledged_generation === alertGeneration
          ) {
            alertActive = false;
            alertStartedAt = null;
          }
          nextMap[item.tmdb_id] = snapshotLabel;
          nextProgress[item.tmdb_id] = "watching";
          nextAlertMap[item.tmdb_id] = alertActive;
          const nextState: TvState = {
            ...prevState,
            alert_active: alertActive,
            alert_started_at: alertStartedAt,
            alert_generation: alertGeneration,
            last_checked_at: nowIso,
          };
          nextStateMap[item.tmdb_id] = nextState;
          if (didStateChange(prevState, nextState)) {
            stateUpdates.push(nextState);
          }
          continue;
        }
        const detail = await fetchDetailCached(item.tmdb_id);
        const status = detail?.status?.toLowerCase() ?? "";
        const nextKnownStatus =
          status || prevState?.last_known_status || null;
        const isEnded = isEndedTvStatus(status);
        const seasonsInfo = detail?.seasons_info ?? [];
        const totalAiredFromSeasons = seasonsInfo.reduce(
          (
            sum: number,
            season: { season_number: number; episode_count: number | null },
          ) => {
          if (season.season_number === 0) return sum;
          return sum + (season.episode_count ?? 0);
        },
          0,
        );
        if (totalAiredFromSeasons > 0) {
          totalAired = totalAiredFromSeasons;
        }
        let expectedUpToLatest = 0;
        const seasonsUpToLatest =
          latest !== undefined && latest !== null
            ? seasonsInfo.filter(
                (season: { season_number: number; episode_count: number | null }) =>
                  season.season_number > 0 && season.season_number <= latest.season,
              )
            : [];
        const hasReliableExpectedUpToLatest =
          seasonsUpToLatest.length > 0 &&
          seasonsUpToLatest.every(
            (season: { season_number: number; episode_count: number | null }) =>
              (season.episode_count ?? 0) > 0,
          );
        if (latest && seasonsInfo.length > 0) {
          expectedUpToLatest = seasonsInfo.reduce(
            (
              sum: number,
              season: { season_number: number; episode_count: number | null },
            ) => {
              if (season.season_number === 0) return sum;
              if ((season.episode_count ?? 0) <= 0) return sum;
              if (season.season_number < latest.season) {
                return sum + (season.episode_count ?? 0);
              }
              if (season.season_number === latest.season) {
                return sum + Math.min(latest.episode, season.episode_count ?? 0);
              }
              return sum;
            },
            0,
          );
        }
        const hasMissingReleasedEpisodes =
          expectedUpToLatest > 0 && watchedCount < expectedUpToLatest;
        const hasCompletedReleasedEpisodes =
          expectedUpToLatest > 0 &&
          watchedCount >= expectedUpToLatest &&
          !hasMissingReleasedEpisodes;
        const hasCompletedByCount =
          totalAired > 0 &&
          watchedCount >= totalAired &&
          !hasMissingReleasedEpisodes;
        const hasCompletedForUnreleasedNext =
          hasReliableExpectedUpToLatest
            ? hasCompletedReleasedEpisodes
            : hasCompletedByCount;
        nextProgress[item.tmdb_id] = "watching";

        if (isEnded && hasCompletedByCount) {
          nextMap[item.tmdb_id] = "已看完";
          nextProgress[item.tmdb_id] = "completed";
          if (alertActive && watchedCount > alertNotifiedCount) {
            alertActive = false;
            alertStartedAt = null;
          }
          nextAlertMap[item.tmdb_id] = alertActive;
          const nextState: TvState = {
            tmdb_id: item.tmdb_id,
            last_progress: "completed",
            last_total_aired: totalAired,
            last_watched_count: watchedCount,
            alert_active: alertActive,
            alert_notified_watch_count: alertNotifiedCount,
            next_episode_season: null,
            next_episode_number: null,
            next_episode_name: null,
            next_episode_air_date: null,
            last_watched_season: latest?.season ?? null,
            last_watched_episode: latest?.episode ?? null,
            last_known_status: nextKnownStatus,
            last_checked_at: nowIso,
            alert_started_at: alertStartedAt,
            alert_generation: alertGeneration,
            alert_acknowledged_generation:
              prevState?.alert_acknowledged_generation ?? null,
            first_release_alert_state: firstReleaseAlertState,
          };
          nextStateMap[item.tmdb_id] = nextState;
          if (didStateChange(prevState, nextState)) {
            stateUpdates.push(nextState);
          }
          continue;
        }

        let targetSeason = latest.season;
        let targetEpisode = latest.episode + 1;
        const seasonInfo = seasonsInfo.find(
          (season: { season_number: number; episode_count: number | null }) =>
            season.season_number === latest.season,
        );
        const seasonCount = seasonInfo?.episode_count ?? null;
          if (seasonCount && latest.episode >= seasonCount) {
            const nextSeasonInfo = seasonsInfo.find(
              (season: { season_number: number; episode_count: number | null }) =>
                season.season_number > latest.season,
            );
            if (!nextSeasonInfo) {
              if (hasCompletedForUnreleasedNext) {
                nextMap[item.tmdb_id] = isEnded
                  ? "已看完"
                  : "已看完目前已播出集數";
                nextProgress[item.tmdb_id] = "completed";
              } else {
                nextMap[item.tmdb_id] = "有未觀看的集數";
                nextProgress[item.tmdb_id] = "watching";
              }
              const nextState: TvState = {
                tmdb_id: item.tmdb_id,
                last_progress: nextProgress[item.tmdb_id],
                last_total_aired: totalAired,
                last_watched_count: watchedCount,
                alert_active: alertActive,
                alert_notified_watch_count: alertNotifiedCount,
                next_episode_season: null,
                next_episode_number: null,
                next_episode_name: null,
                next_episode_air_date: null,
                last_watched_season: latest?.season ?? null,
                last_watched_episode: latest?.episode ?? null,
                last_known_status: nextKnownStatus,
                last_checked_at: nowIso,
                alert_started_at: alertStartedAt,
                alert_generation: alertGeneration,
                alert_acknowledged_generation:
                  prevState?.alert_acknowledged_generation ?? null,
                first_release_alert_state: firstReleaseAlertState,
              };
              nextStateMap[item.tmdb_id] = nextState;
              if (didStateChange(prevState, nextState)) {
                stateUpdates.push(nextState);
              }
              continue;
            }
            targetSeason = nextSeasonInfo.season_number;
            targetEpisode = 1;
          }

        let episodes = await fetchSeasonEpisodesCached(item.tmdb_id, targetSeason);
        if (!episodes) {
          episodes = await fetchSeasonEpisodesCached(item.tmdb_id, targetSeason);
        }
        if (!episodes) {
          const unavailableNote = "（暫時無法確認最新集數）";
          // 下一季/下一集資料偶爾會因 TMDB 暫時失敗而查不到。
          // 這裡先重試一次；若仍失敗，沿用上一輪分類，避免在外部資料不完整時把使用者的狀態來回跳動。
          if (
            prevState?.last_progress === "completed" &&
            (isEnded ? hasCompletedByCount : hasCompletedForUnreleasedNext)
          ) {
            nextMap[item.tmdb_id] = isEnded
              ? `已看完${unavailableNote}`
              : `已看完目前已播出集數${unavailableNote}`;
            nextProgress[item.tmdb_id] = "completed";
          } else if (
            prevState?.last_progress === "unwatched" &&
            watchedCount === 0
          ) {
            nextMap[item.tmdb_id] = `${unwatchedLabel}${unavailableNote}`;
            nextProgress[item.tmdb_id] = "unwatched";
          } else if (isEnded && hasCompletedByCount) {
            nextMap[item.tmdb_id] = `已看完${unavailableNote}`;
            nextProgress[item.tmdb_id] = "completed";
          } else {
            nextMap[item.tmdb_id] = `有未觀看的集數${unavailableNote}`;
            nextProgress[item.tmdb_id] = "watching";
          }
          nextAlertMap[item.tmdb_id] = alertActive;
          const nextState: TvState = {
            tmdb_id: item.tmdb_id,
            last_progress: nextProgress[item.tmdb_id],
            last_total_aired: totalAired,
            last_watched_count: watchedCount,
            alert_active: alertActive,
            alert_notified_watch_count: alertNotifiedCount,
            next_episode_season: null,
            next_episode_number: null,
            next_episode_name: null,
            next_episode_air_date: null,
            last_watched_season: latest?.season ?? null,
            last_watched_episode: latest?.episode ?? null,
            last_known_status: nextKnownStatus,
            last_checked_at: nowIso,
            alert_started_at: alertStartedAt,
            alert_generation: alertGeneration,
            alert_acknowledged_generation:
              prevState?.alert_acknowledged_generation ?? null,
            first_release_alert_state: firstReleaseAlertState,
          };
          nextStateMap[item.tmdb_id] = nextState;
          if (didStateChange(prevState, nextState)) {
            stateUpdates.push(nextState);
          }
          continue;
        }
        let nextEpisode = episodes.find(
          (episode: EpisodeInfo) => episode.episode_number === targetEpisode,
        );
        if (!nextEpisode && targetEpisode === 1 && targetSeason !== latest.season) {
          nextEpisode = episodes.find(
            (episode: EpisodeInfo) => episode.episode_number === 1,
          );
        }
        const airDate = nextEpisode?.air_date ?? null;
        if (!airDate || airDate > today) {
          if (hasCompletedForUnreleasedNext) {
            nextMap[item.tmdb_id] = isEnded
              ? "已看完"
              : "已看完目前已播出集數";
            nextProgress[item.tmdb_id] = "completed";
          } else {
            nextMap[item.tmdb_id] = "有未觀看的集數";
            nextProgress[item.tmdb_id] = "watching";
          }
          if (alertActive && watchedCount > alertNotifiedCount) {
            alertActive = false;
            alertStartedAt = null;
          }
          nextAlertMap[item.tmdb_id] = alertActive;
          const nextState: TvState = {
            tmdb_id: item.tmdb_id,
            last_progress: nextProgress[item.tmdb_id],
            last_total_aired: totalAired,
            last_watched_count: watchedCount,
            alert_active: alertActive,
            alert_notified_watch_count: alertNotifiedCount,
            next_episode_season: null,
            next_episode_number: null,
            next_episode_name: null,
            next_episode_air_date: null,
            last_watched_season: latest?.season ?? null,
            last_watched_episode: latest?.episode ?? null,
            last_known_status: nextKnownStatus,
            last_checked_at: nowIso,
            alert_started_at: alertStartedAt,
            alert_generation: alertGeneration,
            alert_acknowledged_generation:
              prevState?.alert_acknowledged_generation ?? null,
            first_release_alert_state: firstReleaseAlertState,
          };
          nextStateMap[item.tmdb_id] = nextState;
          if (didStateChange(prevState, nextState)) {
            stateUpdates.push(nextState);
          }
          continue;
        }
        const name = nextEpisode?.name;
        const hasMissingBetween = hasMissingReleasedEpisodes;
        const missingNote = hasMissingBetween ? "（中間有漏集）" : "";
        nextMap[item.tmdb_id] = name
          ? `下一集：S${targetSeason}E${targetEpisode} - ${name}${missingNote}`
          : `下一集：S${targetSeason}E${targetEpisode}${missingNote}`;

        if (alertActive && !alertGeneration) {
          alertGeneration = buildEpisodeAlertGeneration(
            targetSeason,
            targetEpisode,
          );
        }
        if (alertActive && watchedCount > alertNotifiedCount) {
          alertActive = false;
          alertStartedAt = null;
        }
        if (
          prevState &&
          prevState.last_progress === "completed" &&
          !watchCountAdvanced &&
          watchedCount <= alertNotifiedCount
        ) {
          alertActive = true;
          alertNotifiedCount = watchedCount;
          alertStartedAt = nowIso;
          alertGeneration = buildEpisodeAlertGeneration(
            targetSeason,
            targetEpisode,
          );
        }
        if (
          alertActive &&
          alertGeneration &&
          prevState?.alert_acknowledged_generation === alertGeneration
        ) {
          alertActive = false;
          alertStartedAt = null;
        }
        nextAlertMap[item.tmdb_id] = alertActive;
        const nextState: TvState = {
          tmdb_id: item.tmdb_id,
          last_progress: "watching",
          last_total_aired: totalAired,
          last_watched_count: watchedCount,
          alert_active: alertActive,
          alert_notified_watch_count: alertNotifiedCount,
          next_episode_season: targetSeason,
          next_episode_number: targetEpisode,
          next_episode_name: name ?? null,
          next_episode_air_date: airDate,
          last_watched_season: latest?.season ?? null,
          last_watched_episode: latest?.episode ?? null,
          last_known_status: nextKnownStatus,
          last_checked_at: nowIso,
          alert_started_at: alertStartedAt,
          alert_generation: alertGeneration,
          alert_acknowledged_generation:
            prevState?.alert_acknowledged_generation ?? null,
          first_release_alert_state: firstReleaseAlertState,
        };
        nextStateMap[item.tmdb_id] = nextState;
        if (didStateChange(prevState, nextState)) {
          stateUpdates.push(nextState);
        }
      }

      if (episodeStatusRequestIdRef.current === requestId) {
          setEpisodeStatusMap(nextMap);
          setEpisodeProgressMap(nextProgress);
          setNewEpisodeAlertMap(nextAlertMap);
          setTvStateMap(nextStateMap);
          setEpisodeStatusLoading(false);

          if (stateUpdates.length > 0) {
            void (async () => {
              try {
                const response = await fetch("/api/watchlist/tv-states/upsert", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        isAnime: Boolean(isAnime),
                        ...(watchlistRevisionRef.current
                          ? { baseRevision: watchlistRevisionRef.current }
                          : {}),
                        states: stateUpdates.map((state) => ({
                          tmdb_id: state.tmdb_id,
                          last_progress: state.last_progress,
                          last_total_aired: state.last_total_aired,
                          last_watched_count: state.last_watched_count,
                          alert_active: state.alert_active,
                          alert_notified_watch_count:
                            state.alert_notified_watch_count,
                          alert_started_at: state.alert_started_at ?? null,
                          alert_generation: state.alert_generation ?? null,
                          first_release_alert_state:
                            state.first_release_alert_state ?? null,
                          next_episode_season: state.next_episode_season ?? null,
                          next_episode_number: state.next_episode_number ?? null,
                          next_episode_name: state.next_episode_name ?? null,
                          next_episode_air_date: state.next_episode_air_date ?? null,
                          last_watched_season: state.last_watched_season ?? null,
                          last_watched_episode: state.last_watched_episode ?? null,
                          last_checked_at: state.last_checked_at ?? null,
                        })),
                      }),
                });
                if (response.status === 409) {
                  watchlistRevisionRef.current = null;
                  setItemsVersion((prev) => prev + 1);
                  setWatchHistoryVersion((prev) => prev + 1);
                  return;
                }
                if (!response.ok) return;
                dispatchWatchStatusRefresh();
              } catch {
                // 同步失敗時直接忽略，避免阻塞 UI 更新。
              }
            })();
          }
        }
    };

    buildStatus();
    }, [
      items,
      isUpcomingTab,
      latestEpisodeMap,
      mediaType,
      episodeHistoryLoading,
      episodeHistoryReady,
      tvStateLoading,
      session,
      todayString,
      watchHistoryVersion,
      watchedEpisodeCountMap,
      fetchDetailCached,
      fetchSeasonEpisodesCached,
      isAnime,
      isEndedTvStatus,
      isPreReleaseTvStatus,
  ]);

  useEffect(() => {
    if (mediaType !== "tv" || filter !== "upcoming") {
      setUpcomingEpisodes([]);
      setUpcomingLoading(false);
      return;
    }
    if (!session || items.length === 0) {
      setUpcomingEpisodes([]);
      setUpcomingLoading(false);
      return;
    }

    const requestId = ++upcomingRequestIdRef.current;
    const today = todayString;

    if (isDesktopAppRuntime()) {
      try {
        const raw =
          window.localStorage.getItem(upcomingEpisodeCacheKey) ??
          window.sessionStorage.getItem(upcomingEpisodeCacheKey);
        const snapshot = raw ? (JSON.parse(raw) as UpcomingEpisodeSnapshot) : null;
        if (
          snapshot &&
          snapshot.today === today &&
          snapshot.itemsFingerprint === upcomingItemsFingerprint &&
          Array.isArray(snapshot.episodes) &&
          Date.now() - snapshot.storedAt <= UPCOMING_EPISODE_SNAPSHOT_TTL_MS
        ) {
          setUpcomingEpisodes(snapshot.episodes);
          setUpcomingLoading(false);
          return;
        }
      } catch {
        window.localStorage.removeItem(upcomingEpisodeCacheKey);
        window.sessionStorage.removeItem(upcomingEpisodeCacheKey);
      }
    }

    setUpcomingLoading(true);

    const buildUpcoming = async () => {
      const nextList: UpcomingEpisodeItem[] = [];

      for (const item of items) {
        if (isEndedTvStatus(item.status)) continue;
        const detail = await fetchDetailCached(item.tmdb_id);
        if (isEndedTvStatus(detail?.status)) continue;
        const seasonsInfo = detail?.seasons_info ?? [];
        for (const seasonInfo of seasonsInfo) {
          if (!seasonInfo.season_number || seasonInfo.season_number <= 0) {
            continue;
          }
          const episodes = await fetchSeasonEpisodesCached(
            item.tmdb_id,
            seasonInfo.season_number,
          );
          if (!episodes) continue;
          episodes.forEach((episode: EpisodeInfo) => {
            if (!episode.air_date) return;
            if (episode.air_date <= today) return;
            nextList.push({
              tmdb_id: item.tmdb_id,
              title: item.title,
              poster_path: item.poster_path,
              season: seasonInfo.season_number,
              episode: episode.episode_number,
              name: episode.name ?? null,
              air_date: episode.air_date,
            });
          });
        }
      }

      nextList.sort((a, b) => {
        if (a.air_date === b.air_date) {
          if (a.title === b.title) {
            if (a.season === b.season) return a.episode - b.episode;
            return a.season - b.season;
          }
          return a.title.localeCompare(b.title);
        }
        return a.air_date.localeCompare(b.air_date);
      });

      if (upcomingRequestIdRef.current === requestId) {
        setUpcomingEpisodes(nextList);
        setUpcomingLoading(false);
        if (isDesktopAppRuntime()) {
          const snapshot: UpcomingEpisodeSnapshot = {
            storedAt: Date.now(),
            today,
            itemsFingerprint: upcomingItemsFingerprint,
            episodes: nextList,
          };
          try {
            const serialized = JSON.stringify(snapshot);
            window.localStorage.setItem(upcomingEpisodeCacheKey, serialized);
            window.sessionStorage.setItem(upcomingEpisodeCacheKey, serialized);
          } catch {
            // 儲存空間額度不足時直接忽略。
          }
        }
      }
    };

    buildUpcoming();
  }, [
    filter,
    items,
    mediaType,
    session,
    todayString,
    upcomingEpisodeCacheKey,
    upcomingItemsFingerprint,
    fetchDetailCached,
    fetchSeasonEpisodesCached,
    isEndedTvStatus,
  ]);

  const getWatchlistYear = (data: DetailData) => {
    if (
      data.media_type === "tv" &&
      data.start_year &&
      data.end_year &&
      data.start_year !== data.end_year
    ) {
      return `${data.start_year} - ${data.end_year}`;
    }
    return data.year ?? null;
  };

  const handleWatchlistChange = (
    inWatchlist: boolean,
    detail: DetailData,
    affectedIsAnime?: boolean[],
  ) => {
    localMutationUntilRef.current = Date.now() + 3000;
    if (session?.user?.id) {
      markWatchlistDirty({
        userId: session.user.id,
        mediaType: detail.media_type,
        isAnime: detail.media_type === "tv" && detail.is_anime,
      }, affectedIsAnime);
    }
    if (!inWatchlist) {
      setItems((prev) => prev.filter((entry) => entry.tmdb_id !== detail.id));
      return;
    }

    if (detail.media_type !== mediaType) return;
    if (
      detail.media_type === "tv" &&
      Boolean(detail.is_anime) !== Boolean(isAnime)
    ) {
      return;
    }

    setItems((prev) => {
      if (prev.some((entry) => entry.tmdb_id === detail.id)) {
        return prev;
      }
      return [
        {
          id: `local-${detail.id}`,
          tmdb_id: detail.id,
          title: detail.title,
          year: getWatchlistYear(detail),
          release_date: detail.release_date ?? null,
          status: detail.status ?? null,
          poster_path: detail.poster_path,
          media_type: detail.media_type,
          is_anime: detail.is_anime,
          created_at: new Date().toISOString(),
          tmdb_cached_at: new Date().toISOString(),
          tv_release_repair_checked_at: null,
          tmdb_stale: false,
        },
        ...prev,
      ];
    });
  };

  const handleWatchDateChange = () => {
    localMutationUntilRef.current = Date.now() + 3000;
    setWatchHistoryVersion((prev) => prev + 1);
    dispatchWatchStatusRefresh();
  };
  const handleEpisodeListViewed = useCallback((tmdbId: number) => {
    const state = tvStateRef.current[tmdbId];
    if (!state?.alert_active || !state.alert_generation) return;
    const requestedGeneration = state.alert_generation;

    void (async () => {
      try {
        const response = await fetch("/api/watchlist/tv-states/acknowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdbId,
            alertGeneration: requestedGeneration,
            firstRelease: state.first_release_alert_state === "active",
          }),
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as {
          changed?: boolean;
        } | null;
        if (!payload?.changed) return;
        if (
          tvStateRef.current[tmdbId]?.alert_generation !== requestedGeneration
        ) {
          return;
        }

        setNewEpisodeAlertMap((prev) => ({
          ...prev,
          [tmdbId]: false,
        }));
        setTvStateMap((prev) => {
          const current = prev[tmdbId];
          if (
            !current ||
            current.alert_generation !== requestedGeneration
          ) {
            return prev;
          }
          const nextState: TvState = {
            ...current,
            alert_active: false,
            alert_started_at: null,
            alert_acknowledged_generation: requestedGeneration,
            first_release_alert_state:
              current.first_release_alert_state === "active"
                ? "acknowledged"
                : current.first_release_alert_state,
          };
          tvStateRef.current = {
            ...tvStateRef.current,
            [tmdbId]: nextState,
          };
          return {
            ...prev,
            [tmdbId]: nextState,
          };
        });
        dispatchWatchStatusRefresh();
      } catch {
        // 保留提醒，等下次成功開啟集數清單後再確認已讀。
      }
    })();
  }, []);

  const desktopSyncStatusPill = showDesktopSyncState ? (
    <div
      className={`inline-flex min-w-0 max-w-[min(26rem,50vw)] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none ${desktopSyncToneClass}`}
    >
      {(desktopSyncState.status === "checking" ||
        desktopSyncState.status === "updating" ||
        desktopSyncState.status === "remote-changed") && (
        <span
          className="h-2 w-2 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {desktopSyncState.status === "paused" && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
      )}
      <span className="min-w-0 truncate">{desktopSyncState.message}</span>
    </div>
  ) : null;

  return (
    <>
      <section>
        {title && (
          <div className="mb-4 flex min-w-0 items-center gap-3 overflow-hidden">
            <h2 className="min-w-0 shrink-0 text-lg font-semibold">{title}</h2>
            {headerCount !== null && (
              <span className="shrink-0 text-xs text-white/50">
                {headerCount} 筆
              </span>
            )}
            {desktopSyncStatusPill}
          </div>
        )}
        {!title && desktopSyncStatusPill && (
          <div className="mb-4 flex min-w-0">{desktopSyncStatusPill}</div>
        )}
        {sessionLoading && (
          <p className="flex items-center gap-2 text-sm text-white/60">
            <span
              className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
              aria-hidden="true"
            />
            載入中...
          </p>
        )}
        {!sessionLoading && !session && (
          <p className="text-sm text-red-300">請先登入以查看清單。</p>
        )}
        {!sessionLoading && session && loading && (
          <p className="flex items-center gap-2 text-sm text-white/60">
            <span
              className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
              aria-hidden="true"
            />
            載入中...
          </p>
        )}
        {!sessionLoading && session && error && (
          <p className="text-sm text-red-300">{error}</p>
        )}
        {!sessionLoading && session && !loading && !error && statusLoading && (
          <p className="flex items-center gap-2 text-sm text-white/60">
            <span
              className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
              aria-hidden="true"
            />
            {mediaType === "tv" ? "集數狀態載入中..." : "觀看紀錄載入中..."}
          </p>
        )}
        {!sessionLoading &&
          session &&
          !loading &&
          !error &&
          (statusLoading || !cardsReady) &&
          items.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-white/60">
              <span
                className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
                aria-hidden="true"
              />
              排序中...
            </p>
          )}
        {!sessionLoading &&
          session &&
          !loading &&
          !error &&
          cardsReady &&
          items.length === 0 && (
            <p className="text-sm text-white/60">目前尚未加入任何內容。</p>
          )}
        {!sessionLoading &&
          session &&
          !loading &&
          !error &&
          cardsReady &&
          items.length > 0 &&
          (!isUpcomingTab && filteredItems.length === 0) && (
            <p className="text-sm text-white/60">目前沒有符合的內容。</p>
          )}
        {isUpcomingTab &&
          !sessionLoading &&
          session &&
          !loading &&
          !error &&
          cardsReady && (
            <>
              {upcomingLoading && (
                <p className="flex items-center gap-2 text-sm text-white/60">
                  <span
                    className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
                    aria-hidden="true"
                  />
                  載入中...
                </p>
              )}
              {!upcomingLoading && upcomingEpisodes.length === 0 && (
                <p className="text-sm text-white/60">目前沒有符合的內容。</p>
              )}
              {!upcomingLoading && upcomingEpisodes.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {upcomingEpisodes.map((episode) => (
                    <WatchlistCard
                      key={`${episode.tmdb_id}-${episode.season}-${episode.episode}`}
                      title={episode.title}
                      posterPath={episode.poster_path}
                      metadataLoading={Boolean(
                        metadataLoadingMap[getMetadataLoadingKey("tv", episode.tmdb_id)],
                      )}
                      upcomingEpisode={{
                        season: episode.season,
                        episode: episode.episode,
                        name: episode.name,
                        airDate: episode.air_date,
                        daysUntil: getDaysUntil(episode.air_date),
                      }}
                      onClick={() =>
                        setDetailTarget({ id: episode.tmdb_id, type: "tv" })
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        {!isUpcomingTab &&
          !sessionLoading &&
          session &&
          !loading &&
          !error &&
          cardsReady &&
          filteredItems.length > 0 && (
            <div className="space-y-3">
              {filter === "all" && allTabGroups ? (
                <>
                  {allTabGroups.kind === "tv" ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.watching.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
                            metadataLoading={Boolean(
                              metadataLoadingMap[
                                getMetadataLoadingKey(item.media_type, item.tmdb_id)
                              ],
                            )}
                            releaseDate={
                              item.media_type === "movie"
                                ? item.release_date
                                : null
                            }
                            releaseCountdown={
                              item.media_type === "movie" && item.release_date
                                ? (() => {
                                    const days = getDaysUntil(item.release_date);
                                    if (days === 0) return "今天上映";
                                    return days > 0 ? `${days}天後` : null;
                                  })()
                                : null
                            }
                            watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                            watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                            watchedFriends={toWatchedFriends(item.tmdb_id)}
                            episodeStatus={
                              displayedEpisodeStatusMap[item.tmdb_id] ?? null
                            }
                            statusLoading={statusLoading}
                            newEpisodeAlert={Boolean(
                              displayedNewEpisodeAlertMap[item.tmdb_id],
                            )}
                            newEpisodeAlertLabel={formatAlertLabel(
                              tvStateMap[item.tmdb_id]?.alert_started_at,
                              tvStateMap[item.tmdb_id]
                                ?.first_release_alert_state === "active",
                            )}
                            onClick={() =>
                              setDetailTarget({
                                id: item.tmdb_id,
                                type: item.media_type,
                              })
                            }
                          />
                        ))}
                      </div>
                      {allTabGroups.watching.length > 0 &&
                        (allTabGroups.unwatched.length > 0 ||
                          allTabGroups.completed.length > 0) && (
                          <div className="h-px bg-white/10" />
                        )}
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.unwatched.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
                            metadataLoading={Boolean(
                              metadataLoadingMap[
                                getMetadataLoadingKey(item.media_type, item.tmdb_id)
                              ],
                            )}
                            releaseDate={
                              item.media_type === "movie"
                                ? item.release_date
                                : null
                            }
                            releaseCountdown={
                              item.media_type === "movie" && item.release_date
                                ? (() => {
                                    const days = getDaysUntil(item.release_date);
                                    if (days === 0) return "今天上映";
                                    return days > 0 ? `${days}天後` : null;
                                  })()
                                : null
                            }
                            watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                            watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                            watchedFriends={toWatchedFriends(item.tmdb_id)}
                            episodeStatus={
                              displayedEpisodeStatusMap[item.tmdb_id] ?? null
                            }
                            statusLoading={statusLoading}
                            newEpisodeAlert={Boolean(
                              displayedNewEpisodeAlertMap[item.tmdb_id],
                            )}
                            newEpisodeAlertLabel={formatAlertLabel(
                              tvStateMap[item.tmdb_id]?.alert_started_at,
                              tvStateMap[item.tmdb_id]
                                ?.first_release_alert_state === "active",
                            )}
                            onClick={() =>
                              setDetailTarget({
                                id: item.tmdb_id,
                                type: item.media_type,
                              })
                            }
                          />
                        ))}
                      </div>
                      {allTabGroups.unwatched.length > 0 &&
                        allTabGroups.completed.length > 0 && (
                          <div className="h-px bg-white/10" />
                        )}
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.completed.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
                            metadataLoading={Boolean(
                              metadataLoadingMap[
                                getMetadataLoadingKey(item.media_type, item.tmdb_id)
                              ],
                            )}
                            releaseDate={
                              item.media_type === "movie"
                                ? item.release_date
                                : null
                            }
                            releaseCountdown={
                              item.media_type === "movie" && item.release_date
                                ? (() => {
                                    const days = getDaysUntil(item.release_date);
                                    if (days === 0) return "今天上映";
                                    return days > 0 ? `${days}天後` : null;
                                  })()
                                : null
                            }
                            watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                            watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                            watchedFriends={toWatchedFriends(item.tmdb_id)}
                            episodeStatus={
                              displayedEpisodeStatusMap[item.tmdb_id] ?? null
                            }
                            statusLoading={statusLoading}
                            newEpisodeAlert={Boolean(
                              displayedNewEpisodeAlertMap[item.tmdb_id],
                            )}
                            newEpisodeAlertLabel={formatAlertLabel(
                              tvStateMap[item.tmdb_id]?.alert_started_at,
                              tvStateMap[item.tmdb_id]
                                ?.first_release_alert_state === "active",
                            )}
                            onClick={() =>
                              setDetailTarget({
                                id: item.tmdb_id,
                                type: item.media_type,
                              })
                            }
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.unwatched.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
                            metadataLoading={Boolean(
                              metadataLoadingMap[
                                getMetadataLoadingKey(item.media_type, item.tmdb_id)
                              ],
                            )}
                            releaseDate={
                              item.media_type === "movie"
                                ? item.release_date
                                : null
                            }
                            releaseCountdown={
                              item.media_type === "movie" && item.release_date
                                ? (() => {
                                    const days = getDaysUntil(item.release_date);
                                    if (days === 0) return "今天上映";
                                    return days > 0 ? `${days}天後` : null;
                                  })()
                                : null
                            }
                            watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                            watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                            watchedFriends={toWatchedFriends(item.tmdb_id)}
                            episodeStatus={null}
                            statusLoading={statusLoading}
                            onClick={() =>
                              setDetailTarget({
                                id: item.tmdb_id,
                                type: item.media_type,
                              })
                            }
                          />
                        ))}
                      </div>
                      {allTabGroups.unwatched.length > 0 &&
                        (allTabGroups.upcoming.length > 0 ||
                          allTabGroups.watched.length > 0) && (
                          <div className="h-px bg-white/10" />
                        )}
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.upcoming.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
                            metadataLoading={Boolean(
                              metadataLoadingMap[
                                getMetadataLoadingKey(item.media_type, item.tmdb_id)
                              ],
                            )}
                            releaseDate={
                              item.media_type === "movie"
                                ? item.release_date
                                : null
                            }
                            releaseCountdown={
                              item.media_type === "movie" && item.release_date
                                ? (() => {
                                    const days = getDaysUntil(item.release_date);
                                    if (days === 0) return "今天上映";
                                    return days > 0 ? `${days}天後` : null;
                                  })()
                                : null
                            }
                            watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                            watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                            watchedFriends={toWatchedFriends(item.tmdb_id)}
                            episodeStatus={null}
                            statusLoading={statusLoading}
                            onClick={() =>
                              setDetailTarget({
                                id: item.tmdb_id,
                                type: item.media_type,
                              })
                            }
                          />
                        ))}
                      </div>
                      {allTabGroups.upcoming.length > 0 &&
                        allTabGroups.watched.length > 0 && (
                          <div className="h-px bg-white/10" />
                        )}
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.watched.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
                            metadataLoading={Boolean(
                              metadataLoadingMap[
                                getMetadataLoadingKey(item.media_type, item.tmdb_id)
                              ],
                            )}
                            releaseDate={
                              item.media_type === "movie"
                                ? item.release_date
                                : null
                            }
                            releaseCountdown={
                              item.media_type === "movie" && item.release_date
                                ? (() => {
                                    const days = getDaysUntil(item.release_date);
                                    if (days === 0) return "今天上映";
                                    return days > 0 ? `${days}天後` : null;
                                  })()
                                : null
                            }
                            watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                            watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                            watchedFriends={toWatchedFriends(item.tmdb_id)}
                            episodeStatus={null}
                            statusLoading={statusLoading}
                            onClick={() =>
                              setDetailTarget({
                                id: item.tmdb_id,
                                type: item.media_type,
                              })
                            }
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredItems.map((item) => (
                    <WatchlistCard
                      key={item.id}
                      title={item.title}
                      posterPath={item.poster_path}
                      metadataLoading={Boolean(
                        metadataLoadingMap[
                          getMetadataLoadingKey(item.media_type, item.tmdb_id)
                        ],
                      )}
                      releaseDate={
                        item.media_type === "movie" ? item.release_date : null
                      }
                      releaseCountdown={
                        item.media_type === "movie" && item.release_date
                          ? (() => {
                              const days = getDaysUntil(item.release_date);
                              if (days === 0) return "今天上映";
                              return days > 0 ? `${days}天後` : null;
                            })()
                          : null
                      }
                      watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                      watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                      watchedFriends={toWatchedFriends(item.tmdb_id)}
                      episodeStatus={
                        mediaType === "tv"
                          ? displayedEpisodeStatusMap[item.tmdb_id] ?? null
                          : null
                      }
                      statusLoading={statusLoading}
                      newEpisodeAlert={Boolean(
                        mediaType === "tv" &&
                          displayedNewEpisodeAlertMap[item.tmdb_id],
                      )}
                      newEpisodeAlertLabel={formatAlertLabel(
                        tvStateMap[item.tmdb_id]?.alert_started_at,
                        tvStateMap[item.tmdb_id]?.first_release_alert_state ===
                          "active",
                      )}
                      onClick={() =>
                        setDetailTarget({ id: item.tmdb_id, type: item.media_type })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
      </section>

      {detailTarget && (
        <DetailModal
          open
          onClose={() => setDetailTarget(null)}
          mediaType={detailTarget.type}
          tmdbId={detailTarget.id}
          defaultTab="history"
          onWatchlistChange={handleWatchlistChange}
          onWatchDateChange={handleWatchDateChange}
          onEpisodeHistoryChange={() =>
            {
              localMutationUntilRef.current = Date.now() + 3000;
              setWatchHistoryVersion((prev) => prev + 1);
              dispatchWatchStatusRefresh();
            }
          }
          onEpisodeListViewed={handleEpisodeListViewed}
          watchlistRevision={watchlistRevisionRef.current}
          onWatchlistRevisionConflict={() => {
            watchlistRevisionRef.current = null;
            setDesktopSyncState({
              status: "remote-changed",
              message: "已選擇使用雲端資料，正在重新同步觀看紀錄。",
              updatedAt: Date.now(),
            });
            setItemsVersion((prev) => prev + 1);
            setWatchHistoryVersion((prev) => prev + 1);
          }}
        />
      )}
    </>
  );
}
