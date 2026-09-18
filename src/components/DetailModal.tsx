"use client";

import useWatchRealtimeRefresh from "@/hooks/useWatchRealtimeRefresh";
import { isEpisodeDate } from "@/lib/episodeDateCache";
import useAccountFetch from "@/hooks/useAccountFetch";
import useModalFocus from "@/hooks/useModalFocus";
import { fetchTmdbClient } from "@/lib/fetchTmdbClient";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import DetailOverview, { DetailOverviewSkeleton } from "./DetailOverview";
import WatchRecordEditor from "./WatchRecordEditor";
import styles from "./DetailModal.module.css";
import historyStyles from "./DetailHistory.module.css";
import useEpisodeDataClock from "@/hooks/useEpisodeDataClock";
import { getSharedEpisodeProgress, getSharedSeasonAiredTotal, unavailableAiredTotalHint, airedTotalHint, taipeiDate } from "@/lib/episodeTotals";
import useAuth from "@/hooks/useAuth";
import usePageActivityState from "@/hooks/usePageActivityState";
import useProfileNames from "@/hooks/useProfileNames";
import { getFriendGraphRevision } from "@/lib/friendNoticeEvents";
import { compareParticipantDisplayName } from "@/lib/participantSort";
import { isKnownTvSeason } from "@/lib/upcomingEpisodeSeasons";
import { dispatchWatchStatusRefresh } from "@/lib/watchStatusEvents";
import { markWatchlistDirty } from "@/lib/watchlistMutationEvents";
import {
  ensureEpisodeDatesCached,
  fetchSeasonEpisodesCached,
  seasonEpisodesCacheKey,
} from "@/lib/seasonEpisodes";
import {
  DEFAULT_DETAIL_TTL_MS,
  getDetailCache,
  getOrLoadDetailCache,
  SHORT_DETAIL_TTL_MS,
  setDetailCache,
} from "@/lib/tmdbDetailCache";

type DetailData = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
  release_date?: string | null;
  start_year: string | null;
  end_year: string | null;
  is_anime: boolean;
  status?: string;
  seasons?: number | null;
  seasons_info?: Array<{ season_number: number; episode_count: number | null }>;
  runtime: number | null;
  countries: string[];
  languages: string[];
  overview: string | null;
  poster_path: string | null;
  homepage: string | null;
  collection_id?: number | null;
  collection_name?: string | null;
  collection_poster_path?: string | null;
};

type EpisodeInfo = {
  episode_number: number;
  name: string | null;
  air_date?: string | null;
};

type CollectionItem = {
  id: number;
  title: string;
  year: string | null;
  release_date: string | null;
  poster_path: string | null;
};

type HistoryRecord = {
  watched_at: string;
  owner_id: string;
  participants: Array<{
    friend_id: string;
    friend_nickname: string | null;
    is_owner: boolean;
  }>;
};
type HistoryRecordRow = {
  watched_at: string;
  owner_id: string;
  friend_id: string | null;
  friend_nickname: string | null;
  is_owner: boolean | null;
};
type SeasonHistoryRecordRow = HistoryRecordRow & {
  episode_number: number;
};

type DetailModalProps = {
  open: boolean;
  onClose: () => void;
  mediaType: "movie" | "tv";
  tmdbId: number;
  defaultTab?: "details" | "history";
  onWatchlistChange?: (
    inWatchlist: boolean,
    detail: DetailData,
    affectedIsAnime?: boolean[],
  ) => void;
  onWatchDateChange?: (tmdbId: number, watchedDate: string | null) => void;
  onEpisodeHistoryChange?: () => void;
  onEpisodeListViewed?: (tmdbId: number) => void;
  watchlistRevision?: string | null;
  onWatchlistRevisionConflict?: () => void;
};

type WatchlistRevisionConflictPayload = {
  code?: string;
  message?: string;
  currentRevision?: string;
  baseRevision?: string;
};

type CachedFriendList = {
  rows: Array<{ friend_id: string; friend_nickname: string | null }>;
  expiresAt: number;
  revision: number;
};

const DETAIL_FRIENDS_CACHE_TTL_MS = 5 * 60 * 1000;
const detailFriendsCache = new Map<string, CachedFriendList>();

// 集數清單可能長達上千集，距離太遠時改用瞬移，避免平滑捲動耗時過久
const EPISODE_SMOOTH_SCROLL_MAX_DISTANCE_PX = 2400;

const scrollEpisodeCardIntoView = (
  target: HTMLElement,
  container: HTMLElement | null,
) => {
  // 手機版清單容器是 overflow-visible（實際捲動交給更外層的祖先），
  // 這種情況下容器本身不是捲動框，只能改用「離可視區頂端多遠」當距離基準
  const containerTop =
    container && container.scrollHeight > container.clientHeight + 1
      ? container.getBoundingClientRect().top
      : 0;
  const distance = Math.abs(target.getBoundingClientRect().top - containerTop);
  target.scrollIntoView({
    block: "start",
    behavior:
      distance > EPISODE_SMOOTH_SCROLL_MAX_DISTANCE_PX ? "auto" : "smooth",
  });
};

export default function DetailModal({
  open,
  onClose,
  mediaType,
  tmdbId,
  defaultTab = "details",
  onWatchlistChange,
  onWatchDateChange,
  onEpisodeHistoryChange,
  onEpisodeListViewed,
  watchlistRevision = null,
  onWatchlistRevisionConflict,
}: DetailModalProps) {
  const fetch = useAccountFetch();
  const [activeMediaType, setActiveMediaType] = useState(mediaType);
  const [activeTmdbId, setActiveTmdbId] = useState(tmdbId);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "history">("details");
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [seasonEpisodes, setSeasonEpisodes] = useState<EpisodeInfo[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState("");
  const [collectionItems, setCollectionItems] = useState<CollectionItem[]>([]);
  const [collectionWatchlistMap, setCollectionWatchlistMap] = useState<
    Record<number, boolean>
  >({});
  const [collectionToggleLoading, setCollectionToggleLoading] = useState<
    Record<number, boolean>
  >({});
  const [collectionToast, setCollectionToast] = useState<{
    message: string;
    tone: "error" | "success";
    anchor?: { left: number; top: number } | null;
  } | null>(null);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [isCompactTabLabel, setIsCompactTabLabel] = useState(false);
  const { session, loading: sessionLoading } = useAuth();
  const [isInWatchlist, setIsInWatchlist] = useState<boolean | null>(null);
  const [privateDataError, setPrivateDataError] = useState("");
  const [privateDataRetry, setPrivateDataRetry] = useState(0);
  const [privateDataLoading, setPrivateDataLoading] = useState(false);
  const privateMutationPendingRef = useRef(new Set<string>());
  const privateMutationVersionsRef = useRef(new Map<string, number>());
  const [collectionWatchlistError, setCollectionWatchlistError] = useState("");
  const [collectionWatchlistLoading, setCollectionWatchlistLoading] = useState(false);
  const [collectionWatchlistRetry, setCollectionWatchlistRetry] = useState(0);
  const privateDataScopeRef = useRef<string | null>(null);
  const [friendsReady, setFriendsReady] = useState(false);
  const [watchedDate, setWatchedDate] = useState("");
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [historyRecordsLoading, setHistoryRecordsLoading] = useState(false);
  const [historyRecordsError, setHistoryRecordsError] = useState("");
  const historyRecordsScopeRef = useRef<string | null>(null);
  const [episodeProgress, setEpisodeProgress] = useState<{
    watched: number;
    total: number;
  } | null>(null);
  const [episodeHistoryMap, setEpisodeHistoryMap] = useState<
    Record<number, HistoryRecord | null>
  >({});
  const [episodeHistoryLoading, setEpisodeHistoryLoading] = useState(false);
  const [episodeHistoryError, setEpisodeHistoryError] = useState<{ scope: string; message: string } | null>(null);
  const [episodeHistoryScope, setEpisodeHistoryScope] = useState<string | null>(null);
  const [episodeSeasonPrefReady, setEpisodeSeasonPrefReady] = useState(true);
  const [nextEpisodeTarget, setNextEpisodeTarget] = useState<{
    season: number;
    episode: number;
  } | null>(null);
  const [episodeEditorOpen, setEpisodeEditorOpen] = useState(false);
  const [episodeEditingRecord, setEpisodeEditingRecord] =
    useState<HistoryRecord | null>(null);
  const [episodeEditingNumber, setEpisodeEditingNumber] = useState<
    number | null
  >(null);
  const [episodeWatchedDate, setEpisodeWatchedDate] = useState("");
  const [episodeSelectedFriendIds, setEpisodeSelectedFriendIds] = useState<
    string[]
  >([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmLoading, setDeleteConfirmLoading] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<
    | { kind: "movie"; record: HistoryRecord }
    | {
        kind: "episode";
        record: HistoryRecord;
        season: number;
        episodeNumber: number;
        episodeName: string | null;
      }
    | null
  >(null);
  const episodeCardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const lastEpisodeScrollKeyRef = useRef<string | null>(null);
  const nextEpisodeRequestIdRef = useRef(0);
  const tvStatusSyncRequestIdRef = useRef(0);
  const lastSavedEpisodeRef = useRef<{
    season: number;
    episode: number;
  } | null>(null);
  const seasonSelectionManualRef = useRef(false);
  const historyAutoScrollDoneRef = useRef(false);
  const [episodeSaveLoading, setEpisodeSaveLoading] = useState(false);
  const [showHistoryEditor, setShowHistoryEditor] = useState(false);
  const [movieDraftKey, setMovieDraftKey] = useState<string | null>(null);
  const [episodeDraftKey, setEpisodeDraftKey] = useState<string | null>(null);
  const initialMovieEditorScopeRef = useRef<string | null>(null);
  const [lastOwnRecordDate, setLastOwnRecordDate] = useState<string>();
  const [editingRecord, setEditingRecord] = useState<HistoryRecord | null>(
    null,
  );
  const [friends, setFriends] = useState<
    Array<{ friend_id: string; friend_nickname: string | null }>
  >([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState("");
  const [watchlistNoticeTone, setWatchlistNoticeTone] = useState<
    "error" | "success"
  >("success");
  const [revisionConflictOpen, setRevisionConflictOpen] = useState(false);
  const [revisionConflictLoading, setRevisionConflictLoading] = useState(false);
  const [revisionConflictMessage, setRevisionConflictMessage] = useState("");
  const [revisionConflictLocalSummary, setRevisionConflictLocalSummary] =
    useState("");
  const [revisionConflictRemoteSummary, setRevisionConflictRemoteSummary] =
    useState("");
  const revisionConflictRetryRef = useRef<(() => Promise<void>) | null>(null);
  const [movieDatePickerActive, setMovieDatePickerActive] = useState(false);
  const [episodeDatePickerActive, setEpisodeDatePickerActive] = useState(false);
  const historyRequestIdRef = useRef(0);
  const episodeHistoryRequestIdRef = useRef(0);
  const episodeListViewedKeyRef = useRef<string | null>(null);
  const detailModalRef = useRef<HTMLDivElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const conflictDialogRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();
  const movieHistoryScrollRef = useRef<HTMLDivElement | null>(null);
  const episodeHistoryScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingAutoRefreshScrollRef = useRef<{
    section: "movie" | "episode";
    key: string;
    top: number;
    element: HTMLDivElement;
  } | null>(null);
  const watchlistSyncRef = useRef<number | null>(null);
  const collectionToastTimerRef = useRef<number | null>(null);
  const collectionToastAnchorRef = useRef<HTMLElement | null>(null);
  const collectionToastRef = useRef<HTMLDivElement | null>(null);
  const [collectionToastPosition, setCollectionToastPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const pageInactive = usePageActivityState({
    enabled: open && Boolean(session),
  });
  const episodeDataActive = open && !pageInactive && !episodeEditorOpen && !episodeDatePickerActive && activeMediaType === "tv";
  const { today: episodeToday, refreshEpoch: episodeRefreshEpoch } = useEpisodeDataClock(open && !pageInactive);
  const [episodeMetadataStale, setEpisodeMetadataStale] = useState(false);
  const displayEpisodeProgress = episodeProgress && !episodeMetadataStale
    ? getSharedEpisodeProgress(activeTmdbId, episodeProgress.watched, episodeProgress.total, episodeToday) : null;
  useEffect(() => {
    if (!session || !episodeDataActive || detailData?.media_type !== "tv" || detailData.id !== activeTmdbId) return;
    let cancelled = false;
    void ensureEpisodeDatesCached(detailData.id, detailData.seasons_info, detailData.status, () => !cancelled);
    return () => { cancelled = true; };
  }, [session, episodeDataActive, detailData, activeTmdbId, episodeRefreshEpoch]);
  const MIN_MODAL_WIDTH = 820;
  const MIN_MODAL_HEIGHT = 600;
  const detailsTabLabel = isCompactTabLabel ? "\u8cc7\u6599" : "\u8a73\u7d30\u8cc7\u6599";
  const historyTabLabel = isCompactTabLabel ? "\u7d00\u9304" : "\u89c0\u770b\u7d00\u9304";
  const sessionUserId = session?.user.id ?? null;
  const editorScope = `${sessionUserId}:${activeMediaType}:${activeTmdbId}`;
  const activeEditorScopeRef = useRef(editorScope);
  useLayoutEffect(() => { activeEditorScopeRef.current = editorScope; }, [editorScope]);
  // Drafts live only in this detail view and never cross account or media boundaries.
  useEffect(() => {
    setWatchlistLoading(false);
    setEpisodeSaveLoading(false);
    setShowHistoryEditor(false);
    setEpisodeEditorOpen(false);
    setMovieDraftKey(null);
    setEpisodeDraftKey(null);
    setEditingRecord(null);
    setEpisodeEditingRecord(null);
    setEpisodeEditingNumber(null);
    setSelectedFriendIds([]);
    setEpisodeSelectedFriendIds([]);
    setWatchedDate(getTodayDateString());
    setEpisodeWatchedDate(getTodayDateString());
    setMovieDatePickerActive(false);
    setEpisodeDatePickerActive(false);
    setLastOwnRecordDate(undefined);
    initialMovieEditorScopeRef.current = null;
    setRevisionConflictOpen(false);
    setRevisionConflictLoading(false);
    revisionConflictRetryRef.current = null;
  }, [editorScope]);
  const postDetailApi = useCallback(
    async <T,>(path: string, body: unknown): Promise<T | null> => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    },
    [fetch],
  );
  const postDetailApiResult = useCallback(
    async <T,>(path: string, body: unknown) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as T | null;
      return { ok: response.ok, status: response.status, payload };
    },
    [fetch],
  );

  const beginPrivateMutation = useCallback((mediaType: "movie" | "tv", id: number) => {
    const key = `${mediaType}:${id}`;
    if (privateMutationPendingRef.current.has(key)) return null;
    privateMutationPendingRef.current.add(key);
    privateMutationVersionsRef.current.set(key, (privateMutationVersionsRef.current.get(key) ?? 0) + 1);
    return () => {
      privateMutationVersionsRef.current.set(key, (privateMutationVersionsRef.current.get(key) ?? 0) + 1);
      privateMutationPendingRef.current.delete(key);
    };
  }, []);

  const revisionPayload = useCallback(
    (force = false) => ({
      isAnime: detailData?.media_type === "tv" ? Boolean(detailData.is_anime) : false,
      ...(watchlistRevision ? { baseRevision: watchlistRevision } : {}),
      ...(force ? { force: true } : {}),
    }),
    [detailData, watchlistRevision],
  );

  const isRevisionConflict = (
    status: number,
    payload: WatchlistRevisionConflictPayload | null,
  ) =>
    status === 409 && payload?.code === "WATCHLIST_REVISION_CONFLICT";

  const showRevisionConflict = useCallback(
    (
      retry: () => Promise<void>,
      options?: {
        message?: string;
        localSummary?: string;
        remoteSummary?: string;
      },
    ) => {
      if (activeEditorScopeRef.current !== editorScope) return;
      revisionConflictRetryRef.current = async () => {
        if (activeEditorScopeRef.current === editorScope) await retry();
      };
      setRevisionConflictMessage(
        options?.message ||
          "其他裝置或網站版已更新這份觀看紀錄。請選擇要重新載入雲端資料，或仍套用這次操作。",
      );
      setRevisionConflictLocalSummary(options?.localSummary ?? "");
      setRevisionConflictRemoteSummary(
        options?.remoteSummary ?? "正在讀取雲端目前資料...",
      );
      setRevisionConflictOpen(true);
      setWatchlistNotice("偵測到觀看紀錄版本不同，請選擇要保留哪一邊。");
      setWatchlistNoticeTone("error");
    },
    [editorScope],
  );

  const useRemoteRevision = () => {
    setRevisionConflictOpen(false);
    revisionConflictRetryRef.current = null;
    setRevisionConflictLocalSummary("");
    setRevisionConflictRemoteSummary("");
    onWatchlistRevisionConflict?.();
    fetchHistoryRecords();
    fetchEpisodeHistory();
    fetchEpisodeProgress();
  };

  const forceLocalRevision = async () => {
    const retry = revisionConflictRetryRef.current;
    if (!retry) return;
    setRevisionConflictLoading(true);
    try {
      setRevisionConflictOpen(false);
      revisionConflictRetryRef.current = null;
      setRevisionConflictLocalSummary("");
      setRevisionConflictRemoteSummary("");
      await retry();
    } finally {
      setRevisionConflictLoading(false);
    }
  };

  const getTodayDateString = () => new Date().toLocaleDateString("sv-SE");
  const getDaysUntil = (dateString: string) => {
    const [year, month, day] = dateString.split("-").map(Number);
    if (!year || !month || !day) return null;
    const today = episodeToday;
    const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
    const targetUtc = Date.UTC(year, month - 1, day);
    const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
    return Math.max(0, Math.ceil((targetUtc - todayUtc) / 86400000));
  };
  const getInitial = (value: string) => value.trim().slice(0, 1).toUpperCase();
  const profileNameIds = [
    ...friends.map((friend) => friend.friend_id),
    ...historyRecords.flatMap((record) =>
      record.participants.map((item) => item.friend_id),
    ),
    ...Object.values(episodeHistoryMap).flatMap((record) =>
      record ? record.participants.map((item) => item.friend_id) : [],
    ),
  ];
  const profileNames = useProfileNames(profileNameIds);

  const resolveName = (id: string, fallback?: string | null) =>
    profileNames[id]?.nickname || fallback || `使用者-${id.slice(0, 6)}`;
  const resolveAvatarUrl = (id: string) => profileNames[id]?.avatarUrl || null;
  const getFriendName = (id: string, fallback?: string | null) =>
    resolveName(id, fallback);
  const getFriendInitial = (id: string, fallback?: string | null) =>
    getInitial(getFriendName(id, fallback));
  const sortParticipantsForDisplay = (participants: HistoryRecord["participants"]) => {
    const owners = participants.filter((item) => item.is_owner);
    const others = participants
      .filter((item) => !item.is_owner)
      .slice()
      .sort((left, right) =>
        compareParticipantDisplayName(
          {
            id: left.friend_id,
            name: getFriendName(left.friend_id, left.friend_nickname),
          },
          {
            id: right.friend_id,
            name: getFriendName(right.friend_id, right.friend_nickname),
          }
        )
      );
    return [...owners, ...others];
  };
  const getKnownEpisodeTotal = (data: DetailData | null) => {
    if (!data || data.media_type !== "tv") return 0;
    return (data.seasons_info ?? []).reduce((sum, season) => {
      if (season.season_number === 0) return sum;
      return sum + (season.episode_count ?? 0);
    }, 0);
  };
  const formatParticipants = (participants: HistoryRecord["participants"]) => {
    if (!participants || participants.length === 0) return "無";
    return sortParticipantsForDisplay(participants)
      .map((item) => getFriendName(item.friend_id, item.friend_nickname))
      .join("、");
  };
  const isUnreleasedMovie =
    detailData?.media_type === "movie" &&
    detailData.release_date &&
    detailData.release_date > episodeToday;

  const resetDetailState = useCallback(
    (initialTab: "details" | "history") => {
      setDetailTab(initialTab);
      setDetailLoading(true);
      setDetailError("");
      setDetailData(null);
      setSelectedSeason(null);
      setWatchedDate(getTodayDateString());
      setHistoryRecords([]);
      setHistoryRecordsLoading(false);
      setHistoryRecordsError("");
      historyRecordsScopeRef.current = null;
      setEpisodeHistoryMap({});
      setEpisodeHistoryLoading(false);
      setEpisodeHistoryScope(null);
      setEpisodeHistoryError(null);
      setEpisodeEditorOpen(false);
      setEpisodeEditingRecord(null);
      setEpisodeEditingNumber(null);
      setEpisodeWatchedDate(getTodayDateString());
      setEpisodeSelectedFriendIds([]);
      setEpisodeSaveLoading(false);
      setShowHistoryEditor(false);
      setMovieDraftKey(null);
      setEpisodeDraftKey(null);
      setLastOwnRecordDate(undefined);
      initialMovieEditorScopeRef.current = null;
      setRevisionConflictOpen(false);
      setRevisionConflictLoading(false);
      revisionConflictRetryRef.current = null;
      setEditingRecord(null);
      setSelectedFriendIds([]);
      setFriends([]);
      setFriendsLoading(false);
      setFriendsReady(false);
      setIsInWatchlist(null);
      setPrivateDataError("");
      setPrivateDataLoading(false);
      privateDataScopeRef.current = null;
      setMovieDatePickerActive(false);
      setEpisodeDatePickerActive(false);
      setWatchlistNoticeTone("success");
      setSeasonEpisodes([]);
      setSeasonLoading(false);
      setSeasonError("");
      setCollectionOpen(false);
      setCollectionLoading(false);
      setCollectionError("");
      setCollectionItems([]);
      setCollectionWatchlistMap({});
      setCollectionToggleLoading({});
      setCollectionWatchlistError("");
      setCollectionWatchlistLoading(false);
      setCollectionToast(null);
      setDeleteConfirmOpen(false);
      setDeleteConfirmTarget(null);
      setDeleteConfirmLoading(false);
      watchlistSyncRef.current = null;
      lastEpisodeScrollKeyRef.current = null;
      lastSavedEpisodeRef.current = null;
      historyAutoScrollDoneRef.current = false;
      episodeListViewedKeyRef.current = null;
      seasonSelectionManualRef.current = false;
      setEpisodeSeasonPrefReady(defaultTab !== "history");
    },
    [defaultTab],
  );

  const handleDetailTabChange = (nextTab: "details" | "history") => {
    if (nextTab === detailTab) return;
    if (nextTab === "history" && detailData?.media_type === "tv") {
      historyAutoScrollDoneRef.current = false;
      lastEpisodeScrollKeyRef.current = null;
    }
    setDetailTab(nextTab);
  };

  useEffect(() => {
    if (!open) return;
    setActiveMediaType(mediaType);
    setActiveTmdbId(tmdbId);
    const initialTab = defaultTab;
    resetDetailState(initialTab);
  }, [open, defaultTab, mediaType, tmdbId, resetDetailState]);

  useEffect(() => {
    if (!open) return;
    if (detailTab !== "history") return;
    if (!session || sessionLoading) return;
    if (!detailData || detailData.media_type !== "tv") return;
    nextEpisodeRequestIdRef.current += 1;
    const requestId = nextEpisodeRequestIdRef.current;
    setEpisodeSeasonPrefReady(false);

    const run = async () => {
      const payload = await postDetailApi<{
        rows?: Array<{
          season_number: number | null;
          episode_number: number | null;
        }>;
        count?: number;
      }>("/api/detail/history-episodes", {
        tmdbId: detailData.id,
      }).catch(() => null);
      const data = payload?.rows ?? null;
      const error = payload ? null : { message: "failed" };

      if (nextEpisodeRequestIdRef.current !== requestId) return;
      const seasonInfos =
        detailData.seasons_info
          ?.filter(isKnownTvSeason)
          .sort((a, b) => a.season_number - b.season_number) ?? [];
      const firstSeason = seasonInfos[0]?.season_number ?? null;
      const totalAired = getKnownEpisodeTotal(detailData);
      if (!error && typeof payload?.count === "number" && totalAired > 0) {
        setEpisodeProgress({ watched: payload.count, total: totalAired });
      } else if (error) {
        setEpisodeProgress(null);
      }
      if (error || !data || data.length === 0 || seasonInfos.length === 0) {
        setNextEpisodeTarget(null);
        setSelectedSeason(firstSeason);
        setEpisodeSeasonPrefReady(true);
        return;
      }

      const watchedSet = new Set<string>();
      let lastSeason: number | null = null;
      let lastEpisode: number | null = null;
      for (const row of data) {
        const season = row.season_number ?? 0;
        const episode = row.episode_number ?? 0;
        if (season <= 0 || episode <= 0) continue;
        watchedSet.add(`${season}-${episode}`);
        if (
          lastSeason === null ||
          season > lastSeason ||
          (season === lastSeason && episode > (lastEpisode ?? 0))
        ) {
          lastSeason = season;
          lastEpisode = episode;
        }
      }

      let missingTarget: { season: number; episode: number } | null = null;
      for (const seasonInfo of seasonInfos) {
        const seasonNumber = seasonInfo.season_number;
        const episodeCount = seasonInfo.episode_count ?? 0;
        for (let episode = 1; episode <= episodeCount; episode += 1) {
          if (!watchedSet.has(`${seasonNumber}-${episode}`)) {
            missingTarget = { season: seasonNumber, episode };
            break;
          }
        }
        if (missingTarget) break;
      }

      if (missingTarget) {
        setNextEpisodeTarget(missingTarget);
        setEpisodeSeasonPrefReady(true);
        return;
      }

      if (!lastSeason || !lastEpisode) {
        setNextEpisodeTarget(null);
        setSelectedSeason(firstSeason);
        setEpisodeSeasonPrefReady(true);
        return;
      }
      const seasonInfo =
        detailData.seasons_info?.find(
          (info) => info.season_number === lastSeason,
        ) ?? null;
      const episodeCount = seasonInfo?.episode_count ?? null;
      if (episodeCount && lastEpisode >= episodeCount) {
        const nextSeason =
          detailData.seasons_info?.find(
            (info) => info.season_number > lastSeason && isKnownTvSeason(info),
          ) ?? null;
        if (nextSeason) {
          setNextEpisodeTarget({
            season: nextSeason.season_number,
            episode: 1,
          });
          setEpisodeSeasonPrefReady(true);
          return;
        }
        setNextEpisodeTarget(null);
        setEpisodeSeasonPrefReady(true);
        return;
      }
      setNextEpisodeTarget({
        season: lastSeason,
        episode: lastEpisode + 1,
      });
      setEpisodeSeasonPrefReady(true);
    };

    run();
  }, [open, detailTab, session, sessionLoading, detailData, postDetailApi]);

  useEffect(() => {
    if (!open) return;
    if (detailTab !== "history") return;
    if (!selectedSeason && !nextEpisodeTarget) return;
    if (seasonLoading || episodeHistoryLoading) return;
    if (!seasonEpisodes.length) return;
    if (seasonSelectionManualRef.current) return;
    if (historyAutoScrollDoneRef.current) return;
    if (lastSavedEpisodeRef.current) {
      const { season, episode } = lastSavedEpisodeRef.current;
      if (selectedSeason !== season) {
        if (!seasonSelectionManualRef.current) {
          setSelectedSeason(season);
        }
        return;
      }
      const scrollKey = `${season}-${episode}`;
      if (lastEpisodeScrollKeyRef.current === scrollKey) return;
      const target = episodeCardRefs.current[episode];
      if (!target) return;
      lastEpisodeScrollKeyRef.current = scrollKey;
      lastSavedEpisodeRef.current = null;
      historyAutoScrollDoneRef.current = true;
      scrollEpisodeCardIntoView(target, episodeHistoryScrollRef.current);
      return;
    }
    if (nextEpisodeTarget) {
      if (seasonSelectionManualRef.current) return;
      if (selectedSeason !== nextEpisodeTarget.season) {
        setSelectedSeason(nextEpisodeTarget.season);
        return;
      }
      const scrollKey = `${nextEpisodeTarget.season}-${nextEpisodeTarget.episode}`;
      if (lastEpisodeScrollKeyRef.current === scrollKey) return;
      const target = episodeCardRefs.current[nextEpisodeTarget.episode];
      if (!target) return;
      lastEpisodeScrollKeyRef.current = scrollKey;
      historyAutoScrollDoneRef.current = true;
      scrollEpisodeCardIntoView(target, episodeHistoryScrollRef.current);
      return;
    }

    // 不再自動捲到第一集或下一集，避免儲存後被覆蓋
  }, [
    open,
    detailTab,
    selectedSeason,
    seasonLoading,
    episodeHistoryLoading,
    seasonEpisodes,
    episodeHistoryMap,
    nextEpisodeTarget,
  ]);

  useEffect(() => {
    if (!open) return;
    let isMounted = true;

    const fetchDetail = async () => {
      setDetailLoading(true);
      setDetailError("");
      try {
        const cacheKey = `${activeMediaType}:${activeTmdbId}`;
        const cached = getDetailCache<DetailData>(cacheKey);
        const cacheMissingSeasons =
          cached?.media_type === "tv" &&
          (!cached.seasons_info || cached.seasons_info.length === 0);
        if (cached && !cacheMissingSeasons) {
          if (cached.media_type === "tv" && defaultTab !== "history") {
            const firstSeason = cached.seasons_info?.[0]?.season_number ?? null;
            setSelectedSeason(firstSeason);
          }
          setDetailData({ ...cached });
          setDetailLoading(false);
          return;
        }

        const data = await getOrLoadDetailCache<DetailData>(
          cacheKey,
          async () => {
            const response = await fetchTmdbClient(
              `/api/tmdb/detail?type=${activeMediaType}&id=${activeTmdbId}`,
            );
            if (!response.ok) {
              throw new Error("detail failed");
            }
            return (await response.json()) as DetailData;
          },
          SHORT_DETAIL_TTL_MS,
          { skipCache: cacheMissingSeasons, priority: "foreground" },
        );
        if (!data) {
          throw new Error("detail failed");
        }
        if (!isMounted) return;
        if (data.media_type === "tv" && defaultTab !== "history") {
          const firstSeason = data.seasons_info?.[0]?.season_number ?? null;
          setSelectedSeason(firstSeason);
        }
        setDetailData(data);
      } catch {
        if (!isMounted) return;
        setDetailError("載入詳細資料失敗，請稍後再試。");
      } finally {
        if (!isMounted) return;
        setDetailLoading(false);
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [open, activeMediaType, activeTmdbId, defaultTab, detailRetry]);

  useEffect(() => {
    if (!episodeDataActive) return;
    const key = `tv:${activeTmdbId}`;
    let cancelled = false;
    const applyDetail = (data: DetailData) => {
      if (cancelled) return;
      setEpisodeMetadataStale(false);
      // 另一個畫面可能先更新共用快取；採用新內容，未變則保留參考，避免重查觀看紀錄。
      setDetailData(current => JSON.stringify(current) === JSON.stringify(data) ? current : data);
    };
    const cached = getDetailCache<DetailData>(key);
    if (cached) {
      queueMicrotask(() => applyDetail(cached));
      return () => { cancelled = true; };
    }
    void getOrLoadDetailCache<DetailData>(key, async () => {
      const response = await fetchTmdbClient(`/api/tmdb/detail?type=tv&id=${activeTmdbId}`);
      if (!response.ok) return null;
      return await response.json() as DetailData;
    }, SHORT_DETAIL_TTL_MS, {priority:"background"}).then(data => {
      if (cancelled) return;
      setEpisodeMetadataStale(!data);
      if (data) applyDetail(data);
    }).catch(() => { if (!cancelled) setEpisodeMetadataStale(true); });
    return () => { cancelled = true; };
  }, [activeTmdbId, episodeDataActive, episodeRefreshEpoch]);

  useEffect(() => {
    if (!detailData || detailData.media_type !== "tv") {
      setSelectedSeason(null);
      setSeasonEpisodes([]);
      setSeasonLoading(false);
      setSeasonError("");
      setEpisodeSeasonPrefReady(true);
      return;
    }
    if (selectedSeason !== null || !episodeSeasonPrefReady) return;
    const firstSeason = detailData.seasons_info?.[0]?.season_number ?? null;
    setSelectedSeason(firstSeason);
  }, [detailData, selectedSeason, episodeSeasonPrefReady]);

  useEffect(() => {
    if (!open || activeMediaType !== "tv") return;
    setEpisodeEditorOpen(false);
    setEpisodeDraftKey(null);
    setEpisodeDatePickerActive(false);
    setEpisodeEditingNumber(null);
    setEpisodeEditingRecord(null);
    setEpisodeSelectedFriendIds([]);
    setEpisodeWatchedDate(getTodayDateString());
  }, [open, activeMediaType, activeTmdbId, selectedSeason]);

  useEffect(() => {
    if (!detailData || detailData.media_type !== "tv" || !selectedSeason) {
      setSeasonEpisodes([]);
      setSeasonLoading(false);
      setSeasonError("");
      return;
    }

    if (!episodeDataActive) return;
    const cached = getDetailCache<EpisodeInfo[]>(
      seasonEpisodesCacheKey(detailData.id, selectedSeason),
    );
    if (cached) {
      setSeasonEpisodes(cached);
      setSeasonLoading(false);
      setSeasonError("");
      return;
    }

    let isMounted = true;
    setSeasonLoading(true);
    setSeasonError("");

    const run = async () => {
      try {
        const episodes = await fetchSeasonEpisodesCached<EpisodeInfo>(
          detailData.id,
          selectedSeason,
          detailData.status,
          { priority: "foreground" },
        );
        if (!episodes) {
          throw new Error("season failed");
        }
        if (!isMounted) return;
        setSeasonEpisodes(episodes);
      } catch {
        if (!isMounted) return;
        setSeasonError("載入集數失敗，請稍後再試。");
        setSeasonEpisodes([]);
      } finally {
        if (!isMounted) return;
        setSeasonLoading(false);
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, [detailData, selectedSeason, episodeRefreshEpoch, episodeDataActive]);

  useEffect(() => {
    if (!open) return;
    if (!detailData || detailData.media_type !== "movie") {
      setCollectionOpen(false);
      setCollectionItems([]);
      setCollectionLoading(false);
      setCollectionError("");
      return;
    }
    if (!detailData.collection_id || !collectionOpen) {
      setCollectionItems([]);
      setCollectionLoading(false);
      setCollectionError("");
      return;
    }

    const cacheKey = `collection:${detailData.collection_id}`;
    const cached = getDetailCache<CollectionItem[]>(cacheKey);
    if (cached) {
      setCollectionItems(cached);
      setCollectionLoading(false);
      setCollectionError("");
      return;
    }

    let isMounted = true;
    setCollectionLoading(true);
    setCollectionError("");

    const run = async () => {
      try {
        const response = await fetch(
          `/api/tmdb/collection?id=${detailData.collection_id}`,
        );
        if (!response.ok) throw new Error("collection failed");
        const data = await response.json();
        if (!isMounted) return;
        const items = (data.items ?? []) as CollectionItem[];
        setCollectionItems(items);
        setDetailCache(cacheKey, items, DEFAULT_DETAIL_TTL_MS);
      } catch {
        if (!isMounted) return;
        setCollectionError("載入系列失敗，請稍後再試。");
        setCollectionItems([]);
      } finally {
        if (!isMounted) return;
        setCollectionLoading(false);
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, [open, detailData, collectionOpen, fetch]);

  useEffect(() => {
    if (!open) return;
    if (!session) {
      setCollectionWatchlistMap({});
      return;
    }
    if (!collectionOpen || collectionItems.length === 0) return;

    let isMounted = true;
    const ids = collectionItems.map((item) => item.id);
    const versions = new Map(privateMutationVersionsRef.current);
    const pendingAtStart = new Set(privateMutationPendingRef.current);
    setCollectionWatchlistLoading(true);
    setCollectionWatchlistError("");
    const load = async () => {
      const payload = await postDetailApi<{ ids?: number[] }>("/api/detail/watchlist-map", {
        mediaType: "movie", tmdbIds: ids,
      });
      if (!payload || !Array.isArray(payload.ids) || payload.ids.some(id => !Number.isInteger(id))) {
        throw new Error("Collection watchlist unavailable");
      }
      if (!isMounted) return;
      const idSet = new Set(payload.ids);
      setCollectionWatchlistMap(previous => {
        const next = { ...previous };
        for (const id of ids) {
          const key = `movie:${id}`;
          if (pendingAtStart.has(key) || privateMutationPendingRef.current.has(key) || versions.get(key) !== privateMutationVersionsRef.current.get(key)) continue;
          next[id] = idSet.has(id);
        }
        return next;
      });
    };
    void load().catch(error => {
      if (isMounted && error.name !== "AbortError") setCollectionWatchlistError("系列清單狀態讀取失敗，已有資料會先保留。");
    }).finally(() => { if (isMounted) setCollectionWatchlistLoading(false); });
    return () => { isMounted = false; };
  }, [open, session, collectionOpen, collectionItems, postDetailApi, collectionWatchlistRetry]);

  useEffect(() => {
    if (!collectionToast) return;
    if (collectionToastTimerRef.current) {
      window.clearTimeout(collectionToastTimerRef.current);
    }
    collectionToastTimerRef.current = window.setTimeout(() => {
      setCollectionToast(null);
    }, collectionToast.tone === "error" ? 6000 : 2400);
    return () => {
      if (collectionToastTimerRef.current) {
        window.clearTimeout(collectionToastTimerRef.current);
      }
    };
  }, [collectionToast]);

  useLayoutEffect(() => {
    if (!collectionToast?.anchor || !collectionToastRef.current) {
      setCollectionToastPosition(null);
      return;
    }
    const width = collectionToastRef.current.offsetWidth;
    const padding = 12;
    const minLeft = padding + width / 2;
    const maxLeft = window.innerWidth - padding - width / 2;
    const clampedLeft = Math.min(
      Math.max(collectionToast.anchor.left, minLeft),
      maxLeft,
    );
    setCollectionToastPosition({
      left: clampedLeft,
      top: collectionToast.anchor.top,
    });
  }, [collectionToast?.anchor, collectionToast?.message]);


  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

  const bootstrapDetailId = detailData?.id;
  const bootstrapMediaType = detailData?.media_type;
  const bootstrapIsAnime = Boolean(detailData?.is_anime);
  useEffect(() => {
    if (!open || sessionLoading) return;
    if (!session) {
      setIsInWatchlist(false);
      setFriends([]);
      setFriendsReady(false);
      setPrivateDataError("");
      privateDataScopeRef.current = null;
      return;
    }
    if (bootstrapDetailId !== activeTmdbId || bootstrapMediaType !== activeMediaType) return;
    const scope = `${sessionUserId}:${activeMediaType}:${activeTmdbId}:${bootstrapIsAnime}`;
    if (privateDataScopeRef.current !== scope) {
      privateDataScopeRef.current = scope;
      setIsInWatchlist(null);
      setFriends([]);
      setFriendsReady(false);
      setPrivateDataError("");
    }
    let isMounted = true;
    setPrivateDataLoading(true);
    const mutationKey = `${activeMediaType}:${activeTmdbId}`;
    const mutationVersion = privateMutationVersionsRef.current.get(mutationKey) ?? 0;
    const startedDuringMutation = privateMutationPendingRef.current.has(mutationKey);
    const run = async () => {
      const now = Date.now();
      const cachedFriends = sessionUserId ? detailFriendsCache.get(sessionUserId) : null;
      const canUseFriendCache = Boolean(cachedFriends) &&
        cachedFriends!.expiresAt > now &&
        cachedFriends!.revision === getFriendGraphRevision();
      if (canUseFriendCache) {
        setFriends(cachedFriends!.rows);
        setFriendsReady(true);
      }
      setFriendsLoading(!canUseFriendCache);
      try {
        const payload = await postDetailApi<{
          inWatchlist?: boolean;
          friends?: Array<{ friend_id: string; friend_nickname: string | null }>;
        }>("/api/detail/bootstrap", {
          mediaType: activeMediaType,
          tmdbId: activeTmdbId,
          isAnime: activeMediaType === "tv" ? bootstrapIsAnime : false,
          includeFriends: !canUseFriendCache,
        });
        if (!isMounted) return;
        if (!payload || typeof payload.inWatchlist !== "boolean" ||
          (!canUseFriendCache && (!Array.isArray(payload.friends) ||
            payload.friends.some(friend => !friend || typeof friend.friend_id !== "string")))) {
          throw new Error("Incomplete detail bootstrap");
        }
        if (!startedDuringMutation &&
          !privateMutationPendingRef.current.has(mutationKey) &&
          mutationVersion === (privateMutationVersionsRef.current.get(mutationKey) ?? 0)) {
          setIsInWatchlist(payload.inWatchlist);
        }
        if (!canUseFriendCache) {
          const rows = payload.friends!;
          if (sessionUserId) detailFriendsCache.set(sessionUserId, {
            rows, expiresAt: now + DETAIL_FRIENDS_CACHE_TTL_MS, revision: getFriendGraphRevision(),
          });
          setFriends(rows);
          setFriendsReady(true);
        }
        setPrivateDataError("");
      } catch {
        if (!isMounted) return;
        setPrivateDataError("清單狀態與好友讀取失敗，請重試。");
      } finally {
        if (isMounted) {
          setPrivateDataLoading(false);
          setFriendsLoading(false);
        }
      }
    };
    void run();
    return () => { isMounted = false; };
  }, [
    open, session, sessionLoading, activeMediaType, activeTmdbId,
    bootstrapDetailId, bootstrapMediaType, bootstrapIsAnime,
    postDetailApi, sessionUserId, privateDataRetry,
  ]);

  useEffect(() => {
    if (!open) return;
    const checkViewport = () => {
      const isMobile = window.innerWidth < MIN_MODAL_WIDTH || window.innerHeight < MIN_MODAL_HEIGHT;
      setIsMobileLayout(isMobile);
      setIsCompactTabLabel(window.innerWidth < 640);
    };
    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => {
      window.removeEventListener("resize", checkViewport);
    };
  }, [open]);

  const formatTvStatus = (value?: string) => {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "returning series") return "連載中";
    if (normalized === "ended") return "已完結";
    if (normalized === "canceled") return "取消";
    if (normalized === "in production") return "製作中";
    if (normalized === "planned") return "計劃中";
    if (normalized === "pilot") return "試播";
    return value;
  };

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

  const getToastAnchor = useCallback((el?: HTMLElement | null) => {
    const fallback =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const target = el ?? collectionToastAnchorRef.current ?? fallback;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    };
  }, []);

  const showCollectionToast = useCallback(
    (message: string, tone: "error" | "success", anchorEl?: HTMLElement | null) => {
      const anchor = getToastAnchor(anchorEl);
      setCollectionToast({ message, tone, anchor });
    },
    [getToastAnchor],
  );

  const getAutoRefreshScrollKey = useCallback(
    (section: "movie" | "episode") =>
      section === "movie"
        ? `movie:${activeMediaType}:${activeTmdbId}`
        : `episode:${activeMediaType}:${activeTmdbId}:season:${selectedSeason ?? "none"}`,
    [activeMediaType, activeTmdbId, selectedSeason],
  );

  const preserveHistoryScrollForAutoRefresh = useCallback(
    (section: "movie" | "episode") => {
      const target =
        section === "movie"
          ? movieHistoryScrollRef.current
          : episodeHistoryScrollRef.current;
      if (!target) return;
      pendingAutoRefreshScrollRef.current = {
        section,
        key: getAutoRefreshScrollKey(section),
        top: target.scrollTop,
        element: target,
      };
    },
    [getAutoRefreshScrollKey],
  );

  useEffect(() => {
    if (!watchlistNotice) return;
    showCollectionToast(watchlistNotice, watchlistNoticeTone);
    setWatchlistNotice("");
  }, [watchlistNotice, watchlistNoticeTone, showCollectionToast]);

  useLayoutEffect(() => {
    const pending = pendingAutoRefreshScrollRef.current;
    if (!pending) return;
    if (
      pending.section !== "movie" ||
      pending.key !== getAutoRefreshScrollKey("movie") ||
      historyRecordsLoading
    ) {
      return;
    }
    const target = movieHistoryScrollRef.current;
    if (!target) return;
    // A retained list already keeps its current position, including any scroll
    // made while the request was in flight. Restore only a rebuilt list.
    if (target !== pending.element) target.scrollTop = pending.top;
    pendingAutoRefreshScrollRef.current = null;
  }, [getAutoRefreshScrollKey, historyRecordsLoading, historyRecords]);

  useLayoutEffect(() => {
    const pending = pendingAutoRefreshScrollRef.current;
    if (!pending) return;
    if (
      pending.section !== "episode" ||
      pending.key !== getAutoRefreshScrollKey("episode") ||
      episodeHistoryLoading
    ) {
      return;
    }
    const target = episodeHistoryScrollRef.current;
    if (!target) return;
    // A retained list already keeps its current position, including any scroll
    // made while the request was in flight. Restore only a rebuilt list.
    if (target !== pending.element) target.scrollTop = pending.top;
    pendingAutoRefreshScrollRef.current = null;
  }, [
    episodeHistoryLoading,
    episodeHistoryMap,
    selectedSeason,
    getAutoRefreshScrollKey,
  ]);

  useEffect(() => {
    const pending = pendingAutoRefreshScrollRef.current;
    if (!pending) return;
    if (pending.key === getAutoRefreshScrollKey(pending.section)) return;
    pendingAutoRefreshScrollRef.current = null;
  }, [activeMediaType, activeTmdbId, selectedSeason, getAutoRefreshScrollKey]);

  const handleToggleCollectionWatchlist = async (
    item: CollectionItem,
    anchorEl?: HTMLButtonElement | null,
  ) => {
    if (anchorEl) {
      collectionToastAnchorRef.current = anchorEl;
    }
    if (sessionLoading) return;
    if (!session) {
      showCollectionToast("請先登入以加入清單。", "error", anchorEl);
      return;
    }
    if (collectionToggleLoading[item.id] || collectionWatchlistMap[item.id] === undefined) return;
    const finishMutation = beginPrivateMutation("movie", item.id);
    if (!finishMutation) return;

    setCollectionToggleLoading((prev) => ({ ...prev, [item.id]: true }));
      try {

    const inWatchlist = Boolean(collectionWatchlistMap[item.id]);
    if (inWatchlist) {
      const { ok, payload } = await postDetailApiResult<{
        ok?: boolean;
        message?: string;
        affectedIsAnime?: boolean[];
      }>(
        "/api/detail/watchlist-delete",
        {
          mediaType: "movie",
          tmdbId: item.id,
        },
      );
      if (!ok || !payload?.ok) {
        showCollectionToast(
          payload?.message?.includes("watch_history_exists")
            ? "已有觀看紀錄，無法移除清單。"
            : "移除失敗，請稍後再試。",
          "error",
          anchorEl,
        );
      } else {
        setCollectionWatchlistMap((prev) => {
          const next = { ...prev };
          next[item.id] = false;
          return next;
        });
        showCollectionToast("已從清單移除。", "success", anchorEl);
        onWatchlistChange?.(false, {
          id: item.id,
          media_type: "movie",
          title: item.title,
          year: item.year,
          start_year: item.year,
          end_year: item.year,
          is_anime: false,
          runtime: null,
          countries: [],
          languages: [],
          overview: null,
          poster_path: item.poster_path,
          homepage: null,
        }, payload?.affectedIsAnime);
      }
      setCollectionToggleLoading((prev) => ({ ...prev, [item.id]: false }));
      return;
    }

    const payload = await postDetailApi<{
      ok?: boolean;
      affectedIsAnime?: boolean[];
    }>(
      "/api/detail/watchlist-upsert",
      {
        mediaType: "movie",
        tmdbId: item.id,
        isAnime: false,
      },
    );

    if (!payload?.ok) {
      showCollectionToast("加入失敗，請稍後再試。", "error", anchorEl);
    } else {
      setCollectionWatchlistMap((prev) => ({
        ...prev,
        [item.id]: true,
      }));
      showCollectionToast("已加入清單。", "success", anchorEl);
      onWatchlistChange?.(true, {
        id: item.id,
        media_type: "movie",
        title: item.title,
        year: item.year,
        start_year: item.year,
        end_year: item.year,
        is_anime: false,
        runtime: null,
        countries: [],
        languages: [],
        overview: null,
        poster_path: item.poster_path,
        homepage: null,
      }, payload.affectedIsAnime);
    }

    setCollectionToggleLoading((prev) => ({ ...prev, [item.id]: false }));
    } catch {
      showCollectionToast("操作失敗，請稍後再試。", "error", anchorEl);
    } finally {
      finishMutation();
      setCollectionToggleLoading((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleSelectCollectionItem = (id: number) => {
    if (!detailData) return;
    if (id === detailData.id) return;
    setActiveMediaType("movie");
    setActiveTmdbId(id);
    resetDetailState("details");
  };

  useEffect(() => {
    if (!open) return;
    if (!session) return;
    if (!isInWatchlist) return;
    if (!detailData) return;
    if (watchlistSyncRef.current === detailData.id) return;

    watchlistSyncRef.current = detailData.id;
    postDetailApi<{ ok?: boolean }>("/api/detail/watchlist-upsert", {
      mediaType: detailData.media_type,
      tmdbId: detailData.id,
      isAnime: detailData.is_anime,
    }).then(() => undefined);
  }, [open, session, isInWatchlist, detailData, postDetailApi]);

  const buildHistoryRecords = useCallback((rows: HistoryRecordRow[]) => {
    const currentUserId = session?.user.id;
    const recordMap = new Map<string, HistoryRecord>();
    rows.forEach((row) => {
      const recordKey = `${row.watched_at}|${row.owner_id}`;
      if (!recordMap.has(recordKey)) {
        recordMap.set(recordKey, {
          watched_at: row.watched_at,
          owner_id: row.owner_id,
          participants: [],
        });
      }
      if (row.friend_id) {
        if (currentUserId && row.friend_id === currentUserId) {
          return;
        }
        recordMap.get(recordKey)?.participants.push({
          friend_id: row.friend_id,
          friend_nickname: row.friend_nickname ?? null,
          is_owner: Boolean(row.is_owner),
        });
      }
    });
    return Array.from(recordMap.values()).sort((a, b) =>
      b.watched_at.localeCompare(a.watched_at),
    );
  }, [session?.user.id]);

  const describeParticipants = useCallback(
    (record: HistoryRecord | null | undefined) => {
      if (!record || record.participants.length === 0) return "無";
      return record.participants
        .map(
          (item) =>
            profileNames[item.friend_id]?.nickname ||
            item.friend_nickname ||
            `使用者-${item.friend_id.slice(0, 6)}`,
        )
        .join("、");
    },
    [profileNames],
  );

  const loadMovieRemoteConflictSummary = useCallback(async () => {
    if (!detailData || detailData.media_type !== "movie") return;
    const payload = await postDetailApi<{ rows?: HistoryRecordRow[] }>(
      "/api/detail/history-records",
      {
        mediaType: "movie",
        tmdbId: detailData.id,
        season: 0,
        episode: 0,
      },
    );
    if (activeEditorScopeRef.current !== editorScope) return;
    const records = buildHistoryRecords(payload?.rows ?? []);
    if (records.length === 0) {
      setRevisionConflictRemoteSummary("雲端目前沒有觀看紀錄。");
      return;
    }
    setRevisionConflictRemoteSummary(
      records
        .map(
          (record) =>
            `${record.watched_at}，同步好友：${describeParticipants(record)}`,
        )
        .join("；"),
    );
  }, [buildHistoryRecords, describeParticipants, detailData, postDetailApi, editorScope]);

  const loadEpisodeRemoteConflictSummary = useCallback(
    async (season: number, episode: number) => {
      if (!detailData || detailData.media_type !== "tv") return;
      const payload = await postDetailApi<{ rows?: SeasonHistoryRecordRow[] }>(
        "/api/detail/history-season-records",
        {
          tmdbId: detailData.id,
          season,
        },
      );
      if (activeEditorScopeRef.current !== editorScope) return;
      const rows = (payload?.rows ?? []).filter(
        (row) => row.episode_number === episode,
      );
      const records = buildHistoryRecords(rows);
      if (records.length === 0) {
        setRevisionConflictRemoteSummary("雲端目前沒有這一集的觀看紀錄。");
        return;
      }
      setRevisionConflictRemoteSummary(
        records
          .map(
            (record) =>
              `S${season}E${episode}，${record.watched_at}，同步好友：${describeParticipants(record)}`,
          )
          .join("；"),
      );
    },
    [buildHistoryRecords, describeParticipants, detailData, postDetailApi, editorScope],
  );

  const fetchHistoryRecords = useCallback(async () => {
    historyRequestIdRef.current += 1;
    const requestId = historyRequestIdRef.current;
    if (!open || !session || activeMediaType !== "movie") {
      setHistoryRecords([]);
      setHistoryRecordsLoading(false);
      setHistoryRecordsError("");
      historyRecordsScopeRef.current = null;
      return;
    }

    const scope = `${session.user.id}:${activeTmdbId}`;
    if (historyRecordsScopeRef.current !== scope) {
      historyRecordsScopeRef.current = scope;
      setHistoryRecords([]);
    }
    setHistoryRecordsError("");
    setHistoryRecordsLoading(true);

    try {
      const payload = await postDetailApi<{ rows?: HistoryRecordRow[] }>(
        "/api/detail/history-records",
        {
          mediaType: "movie",
          tmdbId: activeTmdbId,
          season: 0,
          episode: 0,
        },
      );
      if (historyRequestIdRef.current !== requestId) return;
      if (!payload || !Array.isArray(payload.rows)) {
        throw new Error("History unavailable");
      }
      setHistoryRecords(buildHistoryRecords(payload.rows));
    } catch {
      if (historyRequestIdRef.current !== requestId) return;
      setHistoryRecordsError("觀看紀錄讀取失敗，請重試；已有紀錄會先保留。");
    } finally {
      if (historyRequestIdRef.current !== requestId) return;
      setHistoryRecordsLoading(false);
    }
  }, [
    open,
    session,
    activeMediaType,
    activeTmdbId,
    buildHistoryRecords,
    postDetailApi,
  ]);

  useEffect(() => {
    fetchHistoryRecords();
    return () => {
      historyRequestIdRef.current += 1;
    };
  }, [fetchHistoryRecords]);

  const buildEpisodeHistoryMap = useCallback(
    (rows: SeasonHistoryRecordRow[]) => {
      const rowsByEpisode = new Map<number, HistoryRecordRow[]>();
      rows.forEach((row) => {
        const list = rowsByEpisode.get(row.episode_number) ?? [];
        list.push({
          watched_at: row.watched_at,
          owner_id: row.owner_id,
          friend_id: row.friend_id,
          friend_nickname: row.friend_nickname,
          is_owner: row.is_owner,
        });
        rowsByEpisode.set(row.episode_number, list);
      });

      const nextMap: Record<number, HistoryRecord | null> = {};
      rowsByEpisode.forEach((episodeRows, episodeNumber) => {
        const records = buildHistoryRecords(episodeRows);
        nextMap[episodeNumber] = records[0] ?? null;
      });
      return nextMap;
    },
    [buildHistoryRecords],
  );

  const fetchEpisodeHistory = useCallback(async () => {
    episodeHistoryRequestIdRef.current += 1;
    const requestId = episodeHistoryRequestIdRef.current;
    if (
      !open ||
      !session ||
      activeMediaType !== "tv" ||
      detailTab !== "history" ||
      !detailData ||
      detailData.media_type !== "tv" ||
      detailData.id !== activeTmdbId ||
      !selectedSeason ||
      seasonEpisodes.length === 0
    ) {
      setEpisodeHistoryMap({});
      setEpisodeHistoryLoading(false);
      setEpisodeHistoryScope(null);
      setEpisodeHistoryError(null);
      return;
    }

    const scope = `${session.user.id}:tv:${detailData.id}:${selectedSeason}`;
    setEpisodeHistoryError(current => current?.scope === scope ? current : null);
    setEpisodeHistoryLoading(true);

    try {
      const payload = await postDetailApi<{ rows?: SeasonHistoryRecordRow[] }>(
        "/api/detail/history-season-records",
        {
          tmdbId: detailData.id,
          season: selectedSeason,
        },
      );
      if (episodeHistoryRequestIdRef.current !== requestId) return;
      if (!payload || !Array.isArray(payload.rows)) {
        throw new Error("Episode history unavailable");
      }
      const nextMap = seasonEpisodes.reduce<Record<number, HistoryRecord | null>>(
        (map, episode) => {
          map[episode.episode_number] = null;
          return map;
        },
        {},
      );
      const seasonRows = payload.rows;
      const builtMap = buildEpisodeHistoryMap(seasonRows);
      Object.entries(builtMap).forEach(([episodeNumber, record]) => {
        nextMap[Number(episodeNumber)] = record;
      });
      setEpisodeHistoryMap(nextMap);
      setEpisodeHistoryScope(scope);
      setEpisodeHistoryError(null);
      const viewedKey = `${detailData.id}:${selectedSeason}`;
      if (episodeListViewedKeyRef.current !== viewedKey) {
        episodeListViewedKeyRef.current = viewedKey;
        onEpisodeListViewed?.(detailData.id);
      }
    } catch {
      if (episodeHistoryRequestIdRef.current !== requestId) return;
      setEpisodeHistoryError({ scope, message: "集數觀看紀錄讀取失敗，請重試；已有紀錄會先保留。" });
    } finally {
      if (episodeHistoryRequestIdRef.current !== requestId) return;
      setEpisodeHistoryLoading(false);
    }
  }, [
    open,
    session,
    activeMediaType,
    detailTab,
    detailData,
    selectedSeason,
    seasonEpisodes,
    activeTmdbId,
    buildEpisodeHistoryMap,
    postDetailApi,
    onEpisodeListViewed,
  ]);

  useEffect(() => {
    fetchEpisodeHistory();
    return () => {
      episodeHistoryRequestIdRef.current += 1;
    };
  }, [fetchEpisodeHistory]);

  const fetchEpisodeProgress = useCallback(async () => {
    if (!open || !session || !detailData || detailData.media_type !== "tv") {
      setEpisodeProgress(null);
      return;
    }

    const totalAired = getKnownEpisodeTotal(detailData);
    if (!totalAired) {
      setEpisodeProgress(null);
      return;
    }

    const payload = await postDetailApi<{ count?: number }>(
      "/api/detail/history-count",
      {
        mediaType: "tv",
        tmdbId: detailData.id,
      },
    );

    if (!payload) {
      setEpisodeProgress(null);
      return;
    }

    setEpisodeProgress({ watched: payload.count ?? 0, total: totalAired });
  }, [detailData, open, session, postDetailApi]);

  const syncTvWatchStatus = useCallback(async (change?: {
    season: number;
    episode: number;
    watched: boolean;
  }) => {
    if (!session || !detailData || detailData.media_type !== "tv") return;

    const requestId = ++tvStatusSyncRequestIdRef.current;
    const totalAired = getKnownEpisodeTotal(detailData);
    let payload: { count?: number } | null = null;
    try {
      payload = await postDetailApi<{ count?: number }>(
        "/api/detail/history-count",
        {
          mediaType: "tv",
          tmdbId: detailData.id,
        },
      );
    } catch {
      if (tvStatusSyncRequestIdRef.current !== requestId) return;
      setEpisodeProgress(null);
      return;
    }

    if (!payload) {
      if (tvStatusSyncRequestIdRef.current !== requestId) return;
      setEpisodeProgress(null);
      return;
    }

    if (tvStatusSyncRequestIdRef.current !== requestId) return;

    const watchedCount = payload.count ?? 0;
    if (totalAired > 0) {
      setEpisodeProgress({ watched: watchedCount, total: totalAired });
    } else {
      setEpisodeProgress(null);
    }

    const nextProgress =
      watchedCount <= 0
        ? "unwatched"
        : totalAired > 0 && watchedCount >= totalAired
          ? "completed"
          : "watching";
    const watchedEpisodeSet = new Set<number>();
    if (selectedSeason) {
      Object.entries(episodeHistoryMap).forEach(([episodeNumber, record]) => {
        if (record) watchedEpisodeSet.add(Number(episodeNumber));
      });
      if (change && change.season === selectedSeason) {
        if (change.watched) {
          watchedEpisodeSet.add(change.episode);
        } else {
          watchedEpisodeSet.delete(change.episode);
        }
      }
    }
    const nextEpisode =
      nextProgress === "watching" && selectedSeason
        ? seasonEpisodes.find(
            (episode) =>
              episode.episode_number > 0 &&
              !watchedEpisodeSet.has(episode.episode_number),
          ) ?? null
        : null;

    try {
      const response = await fetch("/api/watchlist/tv-states/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...revisionPayload(),
          states: [
            {
              tmdb_id: detailData.id,
              last_progress: nextProgress,
              last_total_aired: totalAired,
              last_watched_count: watchedCount,
              next_episode_season: nextEpisode ? selectedSeason : null,
              next_episode_number: nextEpisode?.episode_number ?? null,
              next_episode_name: nextEpisode?.name ?? null,
              next_episode_air_date: nextEpisode?.air_date ?? null,
              last_watched_season: null,
              last_watched_episode: null,
              last_checked_at: new Date().toISOString(),
            },
          ],
        }),
      });
      if (tvStatusSyncRequestIdRef.current !== requestId) return;
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | WatchlistRevisionConflictPayload
          | null;
        if (isRevisionConflict(response.status, payload)) {
          onWatchlistRevisionConflict?.();
        }
        return;
      }
      if (sessionUserId) {
        markWatchlistDirty({
          userId: sessionUserId,
          mediaType: "tv",
          isAnime: Boolean(detailData.is_anime),
        });
      }
      dispatchWatchStatusRefresh();
    } catch {
      // Keep the detail modal usable even if status sync fails.
    }
  }, [session, detailData, selectedSeason, seasonEpisodes, postDetailApi, episodeHistoryMap, fetch, revisionPayload, sessionUserId, onWatchlistRevisionConflict]);

  useEffect(() => {
    if (detailTab === "history" && detailData?.media_type === "tv") return;
    void fetchEpisodeProgress();
  }, [detailData?.media_type, detailTab, fetchEpisodeProgress]);

  useWatchRealtimeRefresh(async () => {
    if (activeMediaType === "movie") {
      preserveHistoryScrollForAutoRefresh("movie");
      await fetchHistoryRecords();
    } else {
      preserveHistoryScrollForAutoRefresh("episode");
      await Promise.all([fetchEpisodeHistory(), fetchEpisodeProgress()]);
    }
  }, {
    enabled: open && Boolean(session),
    paused: activeMediaType === "movie"
      ? showHistoryEditor || movieDatePickerActive
      : episodeEditorOpen || episodeDatePickerActive,
    runOnMount: false,
    pauseWhenHidden: true,
    fallbackIntervalMs: 5 * 60 * 1000,
  });

  const handleToggleWatchlist = async (anchorEl?: HTMLButtonElement | null) => {
    if (anchorEl) {
      collectionToastAnchorRef.current = anchorEl;
    }
    if (!detailData) return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以加入清單。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (privateDataLoading || watchlistLoading || isInWatchlist === null || privateDataError) return;

    const finishMutation = beginPrivateMutation(detailData.media_type, detailData.id);
    if (!finishMutation) return;
    setWatchlistLoading(true);
    try {
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    if (isInWatchlist) {
      const { ok, payload } = await postDetailApiResult<{
        ok?: boolean;
        message?: string;
        affectedIsAnime?: boolean[];
      }>(
        "/api/detail/watchlist-delete",
        {
          mediaType: detailData.media_type,
          tmdbId: detailData.id,
          isAnime: detailData.media_type === "tv" ? detailData.is_anime : false,
        },
      );
      if (!ok || !payload?.ok) {
        setWatchlistNotice(
          payload?.message?.includes("watch_history_exists")
            ? "已有觀看紀錄，無法移除清單。"
            : "移除失敗，請稍後再試。",
        );
        setWatchlistNoticeTone("error");
      } else {
        setIsInWatchlist(false);
        setWatchlistNotice("已從清單移除。");
        setWatchlistNoticeTone("success");
        onWatchlistChange?.(false, detailData, payload?.affectedIsAnime);
      }
      setWatchlistLoading(false);
      return;
    }

    const payload = await postDetailApi<{
      ok?: boolean;
      affectedIsAnime?: boolean[];
    }>(
      "/api/detail/watchlist-upsert",
      {
        mediaType: detailData.media_type,
        tmdbId: detailData.id,
        isAnime: detailData.is_anime,
      },
    );

    if (!payload?.ok) {
      setWatchlistNotice("加入失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
    } else {
      await fetch("/api/home/watchlist-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: {
            type: detailData.media_type,
            id: detailData.id,
            title: detailData.title,
            year: getWatchlistYear(detailData),
            releaseDate: detailData.release_date ?? null,
            posterPath: detailData.poster_path,
            isAnime: detailData.is_anime,
          },
        }),
      });
      setIsInWatchlist(true);
      setWatchlistNotice("已加入清單。");
      setWatchlistNoticeTone("success");
      onWatchlistChange?.(true, detailData, payload.affectedIsAnime);
    }
    setWatchlistLoading(false);
    } catch {
      setWatchlistNotice("操作失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
    } finally {
      finishMutation();
      setWatchlistLoading(false);
    }
  };

  const openHistoryEditor = (record?: HistoryRecord) => {
    if (!session || watchlistLoading || episodeSaveLoading) return;
    if (record && record.owner_id !== session.user.id) return;
    const key = `${editorScope}:${record ? `${record.owner_id}:${record.watched_at}` : "new"}`;
    if (movieDraftKey !== key) {
      setEditingRecord(record ?? null);
      setWatchedDate(record?.watched_at ?? getTodayDateString());
      setSelectedFriendIds(record?.participants.map((item) => item.friend_id) ?? []);
      setMovieDraftKey(key);
    }
    setCollectionToast(null);
    setShowHistoryEditor(true);
  };

  const dismissHistoryEditor = () => {
    if (watchlistLoading || episodeSaveLoading || revisionConflictLoading) return;
    setMovieDatePickerActive(false);
    setShowHistoryEditor(false);
  };

  const closeHistoryEditor = () => {
    setMovieDraftKey(null);
    setEditingRecord(null);
    setSelectedFriendIds([]);
    setWatchedDate(getTodayDateString());
    setMovieDatePickerActive(false);
    setShowHistoryEditor(false);
  };

  // Preserve the existing immediate entry form for a movie with no records,
  // but do not reopen it after the user dismisses it or after background refresh.
  useEffect(() => {
    if (!open || detailTab !== "history" || !sessionUserId || sessionLoading ||
        detailData?.media_type !== "movie" || detailData.id !== activeTmdbId ||
        isUnreleasedMovie || historyRecordsLoading || historyRecordsError ||
        historyRecordsScopeRef.current !== `${sessionUserId}:${activeTmdbId}` ||
        initialMovieEditorScopeRef.current === editorScope) return;
    initialMovieEditorScopeRef.current = editorScope;
    if (historyRecords.length) return;
    setEditingRecord(null);
    setWatchedDate(getTodayDateString());
    setSelectedFriendIds([]);
    setMovieDraftKey(`${editorScope}:new`);
    setShowHistoryEditor(true);
  }, [open, detailTab, sessionUserId, sessionLoading, detailData, activeTmdbId,
      isUnreleasedMovie, historyRecordsLoading, historyRecordsError, historyRecords.length, editorScope]);

  const handleSaveWatchRecord = async (force = false) => {
    if (!detailData || detailData.media_type !== "movie") return;
    if (sessionLoading || activeEditorScopeRef.current !== editorScope) return;
    if (!session) {
      setWatchlistNotice("請先登入以紀錄觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (privateDataLoading || watchlistLoading || isInWatchlist === null || privateDataError) return;

    if (!movieDraftKey?.startsWith(`${editorScope}:`) ||
        (editingRecord && editingRecord.owner_id !== session.user.id)) return;
    const recordDate = watchedDate || getTodayDateString();
    if (recordDate > getTodayDateString()) {
      setWatchlistNotice("不能紀錄晚於今天的日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    const originalDate = editingRecord?.watched_at ?? null;
    const finishMutation = beginPrivateMutation(detailData.media_type, detailData.id);
    if (!finishMutation) return;
    setWatchlistLoading(true);
    try {
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    if (!isInWatchlist) {
      // 建立觀看紀錄時會自動加入清單，因為這份清單同時也是使用者的進度片庫，
      // 不只是暫時性的「想看」佇列。
      const payload = await postDetailApi<{
        ok?: boolean;
        affectedIsAnime?: boolean[];
      }>(
        "/api/detail/watchlist-upsert",
        {
          mediaType: detailData.media_type,
          tmdbId: detailData.id,
          isAnime: detailData.is_anime,
        },
      );

      if (activeEditorScopeRef.current !== editorScope) return;
      if (!payload?.ok) {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      setIsInWatchlist(true);
      onWatchlistChange?.(true, detailData, payload.affectedIsAnime);
    }

    if (selectedFriendIds.length > 0) {
      const conflictPayload = await postDetailApi<{ conflictFriendIds?: string[] }>(
        "/api/detail/history-conflicts",
        {
          mediaType: detailData.media_type,
          tmdbId: detailData.id,
          season: 0,
          episode: 0,
          watchedAt: recordDate,
          originalDate,
          friendIds: selectedFriendIds,
        },
      );

      if (activeEditorScopeRef.current !== editorScope) return;
      if (!conflictPayload) {
        setWatchlistNotice("同步好友失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      const conflictIds = conflictPayload.conflictFriendIds ?? [];
      if (conflictIds.length > 0) {
        const conflictNames = conflictIds.map((id: string) => {
          const fallback =
            friends.find((friend) => friend.friend_id === id)
              ?.friend_nickname ?? null;
          return getFriendName(id, fallback);
        });
        setWatchlistNotice(
          `${conflictNames.join("、")} 有衝突紀錄，無法同步這一筆。請取消勾選，或請好友確認能否調整原紀錄。`,
        );
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }
    }

    const { ok: upsertOk, status: upsertStatus, payload: upsertPayload } =
      await postDetailApiResult<{
        ok?: boolean;
        duplicate?: boolean;
        message?: string;
        conflictFriendIds?: string[];
      } & WatchlistRevisionConflictPayload>("/api/detail/history-upsert", {
        mediaType: detailData.media_type,
        tmdbId: detailData.id,
        ...revisionPayload(force),
        season: 0,
        episode: 0,
        watchedAt: recordDate,
        originalDate,
        friendIds: selectedFriendIds,
      });

    if (activeEditorScopeRef.current !== editorScope) return;
    if (!upsertOk || !upsertPayload?.ok) {
      if (isRevisionConflict(upsertStatus, upsertPayload)) {
        const friendLabel =
          selectedFriendIds.length === 0
            ? "無"
            : selectedFriendIds
                .map((id) => {
                  const fallback =
                    friends.find((friend) => friend.friend_id === id)
                      ?.friend_nickname ?? null;
                  return getFriendName(id, fallback);
                })
                .join("、");
        showRevisionConflict(() => handleSaveWatchRecord(true), {
          localSummary: `本次操作：${
            originalDate ? "更新" : "新增"
          }電影觀看日期 ${recordDate}，同步好友：${friendLabel}`,
        });
        void loadMovieRemoteConflictSummary();
        setWatchlistLoading(false);
        return;
      }
      const conflictIds = upsertPayload?.conflictFriendIds ?? [];
      if (
        upsertPayload?.message?.includes("friend_history_exists") &&
        conflictIds.length > 0
      ) {
        const conflictNames = conflictIds.map((id: string) => {
          const fallback =
            friends.find((friend) => friend.friend_id === id)?.friend_nickname ??
            null;
          return getFriendName(id, fallback);
        });
        setWatchlistNotice(
          `${conflictNames.join("、")} 有衝突紀錄，無法同步這一筆。請取消勾選，或請好友確認能否調整原紀錄。`,
        );
      } else {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
      }
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    if (upsertPayload.duplicate) {
      setWatchlistNotice("當天已有同步的觀看紀錄，無法重複紀錄。");
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    setWatchlistNotice("");
    setWatchlistNoticeTone("success");
    onWatchDateChange?.(detailData.id, recordDate);
    setLastOwnRecordDate(recordDate);
    closeHistoryEditor();
    fetchHistoryRecords();
    setWatchlistLoading(false);
    } catch {
      if (activeEditorScopeRef.current !== editorScope) return;
      setWatchlistNotice("操作失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
    } finally {
      finishMutation();
      if (activeEditorScopeRef.current === editorScope) setWatchlistLoading(false);
    }
  };

  const handleDeleteRecord = async (record: HistoryRecord) => {
    if (!detailData || detailData.media_type !== "movie") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以編輯觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (watchlistLoading) return;
    if (record.owner_id !== session.user.id) return;
    setDeleteConfirmTarget({ kind: "movie", record });
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteRecord = async (record: HistoryRecord, force = false) => {
    if (!detailData || detailData.media_type !== "movie") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以編輯觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (watchlistLoading) return;
    if (record.owner_id !== session.user.id) return;

    const finishMutation = beginPrivateMutation(detailData.media_type, detailData.id);
    if (!finishMutation) return;
    setWatchlistLoading(true);
    try {
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    const { ok, payload, status } = await postDetailApiResult<
      { ok?: boolean } & WatchlistRevisionConflictPayload
    >("/api/detail/history-delete", {
      mediaType: detailData.media_type,
      tmdbId: detailData.id,
      ...revisionPayload(force),
      season: 0,
      episode: 0,
      watchedAt: record.watched_at,
    });
    const error = !ok || !payload?.ok;

    if (error) {
      if (isRevisionConflict(status, payload)) {
        showRevisionConflict(() => confirmDeleteRecord(record, true), {
          localSummary: `本次操作：刪除電影觀看日期 ${record.watched_at}，原同步好友：${formatParticipants(
            record.participants,
          )}`,
        });
        void loadMovieRemoteConflictSummary();
        setWatchlistLoading(false);
        return;
      }
      setWatchlistNotice("清除失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    setWatchlistNotice("");
    setWatchlistNoticeTone("success");
    onWatchDateChange?.(detailData.id, null);
    fetchHistoryRecords();
    setWatchlistLoading(false);
    } catch {
      setWatchlistNotice("操作失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
    } finally {
      finishMutation();
      setWatchlistLoading(false);
    }
  };

  const openEpisodeEditor = (
    episodeNumber: number,
    record?: HistoryRecord | null,
  ) => {
    if (!session || episodeSaveLoading || watchlistLoading || selectedSeason === null) return;
    if (record && record.owner_id !== session.user.id) return;
    if (episodeEditorOpen && episodeEditingNumber === episodeNumber) {
      dismissEpisodeEditor();
      return;
    }
    const key = `${editorScope}:${selectedSeason}:${episodeNumber}:${record ? `${record.owner_id}:${record.watched_at}` : "new"}`;
    if (episodeDraftKey !== key) {
      setEpisodeEditingNumber(episodeNumber);
      setEpisodeEditingRecord(record ?? null);
      setEpisodeWatchedDate(record?.watched_at ?? getTodayDateString());
      setEpisodeSelectedFriendIds(record?.participants.map((item) => item.friend_id) ?? []);
      setEpisodeDraftKey(key);
    }
    setCollectionToast(null);
    setEpisodeEditorOpen(true);
  };

  const dismissEpisodeEditor = () => {
    if (episodeSaveLoading || watchlistLoading || revisionConflictLoading) return;
    setEpisodeDatePickerActive(false);
    setEpisodeEditorOpen(false);
  };

  const closeEpisodeEditor = () => {
    setEpisodeDraftKey(null);
    setEpisodeEditingNumber(null);
    setEpisodeEditingRecord(null);
    setEpisodeSelectedFriendIds([]);
    setEpisodeWatchedDate(getTodayDateString());
    setEpisodeDatePickerActive(false);
    setEpisodeEditorOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    if (!episodeEditorOpen) return;
    if (!episodeEditingNumber) return;
    const target = episodeCardRefs.current[episodeEditingNumber];
    if (!target) return;
    scrollEpisodeCardIntoView(target, episodeHistoryScrollRef.current);
  }, [open, episodeEditorOpen, episodeEditingNumber]);

  const handleSaveEpisodeRecord = async (force = false) => {
    if (!detailData || detailData.media_type !== "tv") return;
    if (sessionLoading || activeEditorScopeRef.current !== editorScope) return;
    if (!session) {
      setWatchlistNotice("請先登入以紀錄觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (privateDataLoading || episodeSaveLoading || watchlistLoading || isInWatchlist === null || privateDataError) return;
    if (!selectedSeason || episodeEditingNumber === null) return;

    if (!episodeDraftKey?.startsWith(`${editorScope}:${selectedSeason}:${episodeEditingNumber}:`) ||
        (episodeEditingRecord && episodeEditingRecord.owner_id !== session.user.id)) return;
    const recordDate = episodeWatchedDate || getTodayDateString();
    const episodeAirDate =
      seasonEpisodes.find(
        (episode) => episode.episode_number === episodeEditingNumber,
      )?.air_date ?? null;
    if (!isEpisodeDate(episodeAirDate) || episodeAirDate > taipeiDate()) {
      setWatchlistNotice("該集尚未播出，無法紀錄觀看日期。");
      setWatchlistNoticeTone("error");
      setEpisodeSaveLoading(false);
      return;
    }
    if (recordDate > getTodayDateString()) {
      setWatchlistNotice("不能紀錄晚於今天的日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    const originalDate = episodeEditingRecord?.watched_at ?? null;
    const finishMutation = beginPrivateMutation(detailData.media_type, detailData.id);
    if (!finishMutation) return;
    setEpisodeSaveLoading(true);
    try {
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    if (!isInWatchlist) {
      // 影集/動畫在建立集數觀看紀錄後也必須保留在清單中，
      // 這樣使用者之後才能繼續從片庫查看與追蹤進度。
      const payload = await postDetailApi<{
        ok?: boolean;
        affectedIsAnime?: boolean[];
      }>(
        "/api/detail/watchlist-upsert",
        {
          mediaType: detailData.media_type,
          tmdbId: detailData.id,
          isAnime: detailData.is_anime,
        },
      );

      if (activeEditorScopeRef.current !== editorScope) return;
      if (!payload?.ok) {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }

      setIsInWatchlist(true);
      onWatchlistChange?.(true, detailData, payload.affectedIsAnime);
    }

    if (episodeSelectedFriendIds.length > 0) {
      const conflictPayload = await postDetailApi<{
        conflictFriendIds?: string[];
      }>("/api/detail/history-conflicts", {
        mediaType: detailData.media_type,
        tmdbId: detailData.id,
        season: selectedSeason,
        episode: episodeEditingNumber,
        watchedAt: recordDate,
        originalDate,
        friendIds: episodeSelectedFriendIds,
      });

      if (activeEditorScopeRef.current !== editorScope) return;
      if (!conflictPayload) {
        setWatchlistNotice("同步好友失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }

      const conflictIds = conflictPayload.conflictFriendIds ?? [];
      if (conflictIds.length > 0) {
        const conflictNames = conflictIds.map((id: string) => {
          const fallback =
            friends.find((friend) => friend.friend_id === id)
              ?.friend_nickname ?? null;
          return getFriendName(id, fallback);
        });
        setWatchlistNotice(
          `${conflictNames.join("、")} 有衝突紀錄，無法同步這一筆。請取消勾選，或請好友確認能否調整原紀錄。`,
        );
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }
    }

    const { ok: upsertOk, status: upsertStatus, payload: upsertPayload } =
      await postDetailApiResult<{
        ok?: boolean;
        duplicate?: boolean;
        message?: string;
        conflictFriendIds?: string[];
      } & WatchlistRevisionConflictPayload>("/api/detail/history-upsert", {
        mediaType: detailData.media_type,
        tmdbId: detailData.id,
        ...revisionPayload(force),
        season: selectedSeason,
        episode: episodeEditingNumber,
        watchedAt: recordDate,
        originalDate,
        friendIds: episodeSelectedFriendIds,
      });

    if (activeEditorScopeRef.current !== editorScope) return;
    if (!upsertOk || !upsertPayload?.ok) {
      if (isRevisionConflict(upsertStatus, upsertPayload)) {
        const friendLabel =
          episodeSelectedFriendIds.length === 0
            ? "無"
            : episodeSelectedFriendIds
                .map((id) => {
                  const fallback =
                    friends.find((friend) => friend.friend_id === id)
                      ?.friend_nickname ?? null;
                  return getFriendName(id, fallback);
                })
                .join("、");
        showRevisionConflict(() => handleSaveEpisodeRecord(true), {
          localSummary: `本次操作：${
            originalDate ? "更新" : "新增"
          } S${selectedSeason}E${episodeEditingNumber} 觀看日期 ${recordDate}，同步好友：${friendLabel}`,
        });
        void loadEpisodeRemoteConflictSummary(selectedSeason, episodeEditingNumber);
        setEpisodeSaveLoading(false);
        return;
      }
      const conflictIds = upsertPayload?.conflictFriendIds ?? [];
      if (
        upsertPayload?.message?.includes("friend_history_exists") &&
        conflictIds.length > 0
      ) {
        const conflictNames = conflictIds.map((id: string) => {
          const fallback =
            friends.find((friend) => friend.friend_id === id)?.friend_nickname ??
            null;
          return getFriendName(id, fallback);
        });
        setWatchlistNotice(
          `${conflictNames.join("、")} 有衝突紀錄，無法同步這一筆。請取消勾選，或請好友確認能否調整原紀錄。`,
        );
      } else {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
      }
      setWatchlistNoticeTone("error");
      setEpisodeSaveLoading(false);
      return;
    }

    if (upsertPayload.duplicate) {
      setWatchlistNotice("當天已有同步的觀看紀錄，無法重複紀錄。");
      setWatchlistNoticeTone("error");
      setEpisodeSaveLoading(false);
      return;
    }

    setWatchlistNotice("");
    setWatchlistNoticeTone("success");
    if (selectedSeason !== null && episodeEditingNumber !== null) {
      const participants = episodeSelectedFriendIds.map((id) => {
        const fallback =
          friends.find((friend) => friend.friend_id === id)?.friend_nickname ??
          null;
        return {
          friend_id: id,
          friend_nickname: fallback,
          is_owner: false,
        };
      });
      setEpisodeHistoryMap((prev) => ({
        ...prev,
        [episodeEditingNumber]: {
          watched_at: episodeWatchedDate || getTodayDateString(),
          owner_id: session.user.id,
          participants,
        },
      }));
      historyAutoScrollDoneRef.current = true;
      requestAnimationFrame(() => {
        const target = episodeCardRefs.current[episodeEditingNumber];
        if (!target) return;
        scrollEpisodeCardIntoView(target, episodeHistoryScrollRef.current);
      });
    }
    void syncTvWatchStatus({
      season: selectedSeason,
      episode: episodeEditingNumber,
      watched: true,
    });
    onEpisodeHistoryChange?.();
    setLastOwnRecordDate(recordDate);
    closeEpisodeEditor();
    setEpisodeSaveLoading(false);
    } catch {
      if (activeEditorScopeRef.current !== editorScope) return;
      setWatchlistNotice("操作失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
    } finally {
      finishMutation();
      if (activeEditorScopeRef.current === editorScope) setEpisodeSaveLoading(false);
    }
  };

  const handleDeleteEpisodeRecord = async (
    episodeNumber: number,
    record: HistoryRecord,
  ) => {
    if (!detailData || detailData.media_type !== "tv") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以編輯觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (episodeSaveLoading) return;
    if (record.owner_id !== session.user.id) return;
    if (!selectedSeason) return;
    const episodeName =
      seasonEpisodes.find((episode) => episode.episode_number === episodeNumber)
        ?.name ?? null;
    setDeleteConfirmTarget({
      kind: "episode",
      record,
      season: selectedSeason,
      episodeNumber,
      episodeName,
    });
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteEpisodeRecord = async (
    seasonNumber: number,
    episodeNumber: number,
    record: HistoryRecord,
    force = false,
  ) => {
    if (!detailData || detailData.media_type !== "tv") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以編輯觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (episodeSaveLoading) return;
    if (record.owner_id !== session.user.id) return;

    const finishMutation = beginPrivateMutation(detailData.media_type, detailData.id);
    if (!finishMutation) return;
    setEpisodeSaveLoading(true);
    try {
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    const { ok, payload, status } = await postDetailApiResult<
      { ok?: boolean } & WatchlistRevisionConflictPayload
    >("/api/detail/history-delete", {
      mediaType: detailData.media_type,
      tmdbId: detailData.id,
      ...revisionPayload(force),
      season: seasonNumber,
      episode: episodeNumber,
      watchedAt: record.watched_at,
    });
    const error = !ok || !payload?.ok;

    if (error) {
      if (isRevisionConflict(status, payload)) {
        showRevisionConflict(
          () => confirmDeleteEpisodeRecord(seasonNumber, episodeNumber, record, true),
          {
            localSummary: `本次操作：刪除 S${seasonNumber}E${episodeNumber} 觀看日期 ${record.watched_at}，原同步好友：${formatParticipants(
              record.participants,
            )}`,
          },
        );
        void loadEpisodeRemoteConflictSummary(seasonNumber, episodeNumber);
        setEpisodeSaveLoading(false);
        return;
      }
      setWatchlistNotice("清除失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setEpisodeSaveLoading(false);
      return;
    }

    setWatchlistNotice("");
    setWatchlistNoticeTone("success");
    setEpisodeHistoryMap((prev) => ({
      ...prev,
      [episodeNumber]: null,
    }));
    void syncTvWatchStatus({
      season: seasonNumber,
      episode: episodeNumber,
      watched: false,
    });
    if (episodeEditorOpen && episodeEditingNumber === episodeNumber) {
      closeEpisodeEditor();
    }
    onEpisodeHistoryChange?.();
    setEpisodeSaveLoading(false);
    } catch {
      setWatchlistNotice("操作失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
    } finally {
      finishMutation();
      setEpisodeSaveLoading(false);
    }
  };

  const closeDeleteConfirm = () => {
    if (deleteConfirmLoading) return;
    setDeleteConfirmOpen(false);
    setDeleteConfirmTarget(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmTarget) return;
    setDeleteConfirmLoading(true);
    if (deleteConfirmTarget.kind === "movie") {
      await confirmDeleteRecord(deleteConfirmTarget.record);
    } else {
      await confirmDeleteEpisodeRecord(
        deleteConfirmTarget.season,
        deleteConfirmTarget.episodeNumber,
        deleteConfirmTarget.record,
      );
    }
    setDeleteConfirmLoading(false);
    setDeleteConfirmOpen(false);
    setDeleteConfirmTarget(null);
  };

  useModalFocus(detailModalRef, open, () => {
    if (watchlistLoading || episodeSaveLoading || deleteConfirmLoading || revisionConflictLoading) return;
    if (movieDatePickerActive || episodeDatePickerActive) {
      (document.activeElement as HTMLElement | null)?.blur();
      setMovieDatePickerActive(false);
      setEpisodeDatePickerActive(false);
      return;
    }
    if (episodeEditorOpen) { dismissEpisodeEditor(); return; }
    if (showHistoryEditor) { dismissHistoryEditor(); return; }
    onClose();
  });
  useModalFocus(deleteDialogRef, open && deleteConfirmOpen && Boolean(deleteConfirmTarget), closeDeleteConfirm);
  useModalFocus(conflictDialogRef, open && revisionConflictOpen, () => {
    if (!revisionConflictLoading) setRevisionConflictOpen(false);
  });

  const recordEditorOpen = Boolean(open && session && !sessionLoading && detailTab === "history" &&
    detailData?.id === activeTmdbId && detailData?.media_type === activeMediaType &&
    (activeMediaType === "movie"
      ? showHistoryEditor && movieDraftKey?.startsWith(`${editorScope}:`)
      : episodeEditorOpen && episodeDraftKey?.startsWith(`${editorScope}:${selectedSeason}:`)));
  const editorBusy = watchlistLoading || episodeSaveLoading || deleteConfirmLoading || revisionConflictLoading;
  const dismissRecordEditor = () => {
    if (editorBusy) return;
    if (activeMediaType === "movie") dismissHistoryEditor();
    else dismissEpisodeEditor();
  };
  const escapeRecordEditor = () => {
    if (editorBusy) return;
    if (movieDatePickerActive || episodeDatePickerActive) {
      (document.activeElement as HTMLElement | null)?.blur();
      setMovieDatePickerActive(false);
      setEpisodeDatePickerActive(false);
      return;
    }
    dismissRecordEditor();
  };
  const lastLoadedOwnDate = (activeMediaType === "movie" ? historyRecords : Object.values(episodeHistoryMap))
    .reduce<string | undefined>((latest, record) =>
      record?.owner_id === sessionUserId && isEpisodeDate(record.watched_at) &&
      (!latest || record.watched_at > latest) ? record.watched_at : latest, undefined);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-40 flex bg-black/70 ${
        isMobileLayout
          ? "items-stretch justify-stretch px-0"
          : "items-center justify-center px-3 md:px-8"
      }`}
      onClick={() => { if (!editorBusy) { if (recordEditorOpen) dismissRecordEditor(); else onClose(); } }}
    >
      <div
        ref={detailModalRef}
        role="dialog"
        aria-modal={!deleteConfirmOpen && !revisionConflictOpen && !recordEditorOpen}
        aria-label={detailData?.title || "作品詳情"}
        tabIndex={-1}
        inert={deleteConfirmOpen || revisionConflictOpen}
        className={`${styles.shell} relative w-full overflow-hidden bg-watch-bg px-4 pb-3 pt-0 md:px-6 ${isMobileLayout ? "h-dvh max-w-none" : "max-w-4xl"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-watch-border-subtle py-3">
            <div className="flex items-center gap-2" inert={recordEditorOpen}>
                <button
                  type="button"
                  onClick={(event) => handleToggleWatchlist(event.currentTarget)}
                  className={`${styles.roundButton} flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${
                    isInWatchlist
                      ? "border-watch-favorite/60 text-watch-favorite"
                      : "border-watch-border text-watch-text-secondary enabled:hover:border-watch-border enabled:hover:text-watch-text"
                  }`}
                  aria-label={isInWatchlist === null ? "清單狀態待確認" : isInWatchlist ? "移除清單" : "加入清單"}
                  aria-pressed={isInWatchlist ?? undefined}
                  aria-busy={watchlistLoading || privateDataLoading}
                  disabled={privateDataLoading || watchlistLoading || episodeSaveLoading || sessionLoading || Boolean(session && (isInWatchlist === null || privateDataError))}
                >
                {(watchlistLoading || privateDataLoading) && <span className="watch-spinner" aria-hidden="true" />}
                <svg
                  aria-hidden="true"
                  className={watchlistLoading || privateDataLoading ? "hidden" : "h-6 w-6"}
                  viewBox="0 0 24 24"
                  fill={isInWatchlist ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path
                    d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.9L12 16.9 6.8 19.6l1-5.9-4.2-4.1 5.8-.8L12 3.5z"
                    strokeLinejoin="round"
                  />
                </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleDetailTabChange("details")}
                  aria-pressed={detailTab === "details"}
                  className={`${styles.tab} whitespace-nowrap px-4 py-2 text-xs max-[640px]:px-2 ${
                    detailTab === "details"
                    ? "border border-watch-border text-watch-text"
                    : "text-watch-text-muted enabled:hover:text-watch-text"
                }`}
              >
                {detailsTabLabel}
              </button>
              <button
                type="button"
                onClick={() => handleDetailTabChange("history")}
                  aria-pressed={detailTab === "history"}
                className={`${styles.tab} whitespace-nowrap px-4 py-2 text-xs max-[640px]:px-2 ${
                  detailTab === "history"
                    ? "border border-watch-border text-watch-text"
                    : "text-watch-text-muted enabled:hover:text-watch-text"
                  }`}
              >
                {historyTabLabel}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {displayEpisodeProgress && (
                <span
                  title={displayEpisodeProgress.total === null ? unavailableAiredTotalHint : airedTotalHint}
                  aria-label={displayEpisodeProgress.total === null ? `已看 ${displayEpisodeProgress.watched} 集，${unavailableAiredTotalHint}` : `已看 ${displayEpisodeProgress.watched} / ${displayEpisodeProgress.total} 集（已播出集數）`}
                  className={`${styles.progress} whitespace-nowrap rounded-full border border-watch-border px-3 py-1 text-[10px] max-[640px]:px-1.5 max-[640px]:text-[9px] ${
                    displayEpisodeProgress.total === null ? "text-watch-warning" :
                    displayEpisodeProgress.total > 0 &&
                    displayEpisodeProgress.watched >= displayEpisodeProgress.total
                      ? "text-watch-complete"
                      : "text-watch-progress"
                  }`}
                >
                  {displayEpisodeProgress.total === null ? `已看 ${displayEpisodeProgress.watched} 集` : isCompactTabLabel
                    ? `${displayEpisodeProgress.watched}/${displayEpisodeProgress.total}`
                    : `已看 ${displayEpisodeProgress.watched} / ${displayEpisodeProgress.total}`}
                  <span className="ml-1 tracking-normal text-watch-text-muted">{displayEpisodeProgress.total === null ? (isCompactTabLabel ? "待確認" : "已播出待確認") : "已播出"}</span>
                </span>
              )}
              <button
                type="button"
                className={`${styles.roundButton} h-8 w-8 rounded-full border border-watch-border text-sm text-watch-text-secondary enabled:hover:border-watch-border`}
                onClick={onClose}
                disabled={editorBusy}
                aria-label="關閉詳情"
              >
                ×
              </button>
            </div>
          </div>
          {privateDataError && !recordEditorOpen && (
            <div role="alert" className="mt-3 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-watch-error/20 bg-watch-error/5 px-3 py-2 text-sm text-watch-error">
              <span>{privateDataError}</span>
              <button type="button" aria-label="重試清單狀態與好友" disabled={privateDataLoading || watchlistLoading || episodeSaveLoading} onClick={() => setPrivateDataRetry(value => value + 1)} className={`watch-button watch-button--small shrink-0 ${styles.retryButton}`}>
                <span className="watch-spinner-slot" aria-hidden="true">{privateDataLoading && <span className="watch-spinner" />}</span>{privateDataLoading ? "重試中…" : "重試"}
              </button>
            </div>
          )}
          <div
            inert={recordEditorOpen}
            className={`${styles.body} ${detailTab === "history" ? styles.historyBody : ""}`}
          >
            {detailLoading && detailTab === "details" && <DetailOverviewSkeleton />}
            {detailLoading && detailTab === "history" && (
              <div className="flex h-full min-h-0 items-center justify-center">
                <p role="status" className="watch-loading text-sm"><span className="watch-spinner" aria-hidden="true" />正在讀取資料…</p>
              </div>
            )}
            {!detailLoading && detailError && (
              <div role="alert" className="flex items-center gap-3 text-sm text-watch-error">
                <p>{detailError}</p>
                <button type="button" aria-label="重試作品詳情" onClick={() => setDetailRetry(value => value + 1)} className="watch-button watch-button--small shrink-0">重試</button>
              </div>
            )}
            {!detailLoading && !detailError && detailData && (
              <>
                {detailTab === "details" && (
                  <DetailOverview
                    detail={detailData}
                    status={formatTvStatus(detailData.status)}
                    collectionOpen={collectionOpen}
                    onToggleCollection={() => setCollectionOpen(prev => !prev)}
                  >
                    {collectionOpen && (
                          <div className="flex flex-col gap-3 text-watch-text-secondary">
                            {detailData.collection_name && (
                              <p className="text-sm font-semibold text-watch-text">
                                {detailData.collection_name}
                              </p>
                            )}
                            {collectionLoading && (
                              <p role="status" className="watch-loading text-sm">
                                <span className="watch-spinner" aria-hidden="true" />載入系列中...
                              </p>
                            )}
                            {!collectionLoading && collectionError && (
                              <p className="text-sm text-watch-error">
                                {collectionError}
                              </p>
                            )}
                            {session && collectionItems.length > 0 && (collectionWatchlistError || (!collectionWatchlistLoading && collectionItems.some(item => collectionWatchlistMap[item.id] === undefined))) && (
                              <div role="alert" className={`flex items-center gap-3 text-xs ${collectionWatchlistError ? "text-watch-error" : "text-watch-warning"}`}>
                                <span>{collectionWatchlistError || "系列清單狀態待確認，請重試。"}</span>
                                <button type="button" aria-label="重試系列清單狀態" disabled={collectionWatchlistLoading} onClick={() => setCollectionWatchlistRetry(value => value + 1)} className="watch-button watch-button--small shrink-0"><span className="watch-spinner-slot" aria-hidden="true">{collectionWatchlistLoading && <span className="watch-spinner" />}</span>重試</button>
                              </div>
                            )}
                            {!collectionLoading &&
                              !collectionError &&
                              collectionItems.length === 0 && (
                                <p className="text-sm text-watch-text-muted">
                                  尚未取得系列內容。
                                </p>
                              )}
                            {!collectionLoading &&
                              !collectionError &&
                              collectionItems.length > 0 && (
                                <div
                                  className="pb-2"
                                >
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {collectionItems.map((item) => {
                                      const isCurrent =
                                        detailData && item.id === detailData.id;
                                      return (
                                        <div
                                          key={item.id}
                                          className={`relative flex items-start gap-3 rounded-xl bg-watch-surface p-2 text-left transition ${
                                            isCurrent
                                              ? "border border-watch-border"
                                              : "hover:bg-watch-selected"
                                          }`}
                                        >
                                          <button
                                            type="button"
                                            disabled={isCurrent}
                                            onClick={() =>
                                              handleSelectCollectionItem(
                                                item.id,
                                              )
                                            }
                                            className={`absolute inset-0 z-0 rounded-xl ${
                                              isCurrent
                                                ? "cursor-default"
                                                : "cursor-pointer"
                                            }`}
                                            aria-label={
                                              isCurrent
                                                ? "目前電影"
                                                : "查看詳細資料"
                                            }
                                          />
                                          <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-watch-surface">
                                            {item.poster_path ? (
                                              <Image
                                                src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                                                alt={item.title}
                                                fill
                                                sizes="56px"
                                                className="object-cover"
                                              />
                                            ) : null}
                                          </div>
                                          <div className="min-w-0 flex h-20 flex-1 flex-col">
                                            <p
                                              className="text-sm text-watch-text"
                                              style={{
                                                display: "-webkit-box",
                                                WebkitLineClamp: 3,
                                                WebkitBoxOrient: "vertical",
                                                overflow: "hidden",
                                              }}
                                            >
                                              {item.title || "未提供片名"}
                                            </p>
                                            {item.year && (
                                              <p className="mt-auto text-xs text-watch-text-muted">
                                                {item.year}
                                              </p>
                                            )}
                                          </div>
                                          {!isCurrent && (
                                            <button
                                              type="button"
                                              className={`absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 transition ${
                                                collectionWatchlistMap[item.id]
                                                  ? "text-watch-favorite"
                                                  : "text-watch-text-secondary enabled:hover:text-watch-text"
                                              }`}
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleToggleCollectionWatchlist(
                                                  item,
                                                  event.currentTarget,
                                                );
                                              }}
                                              disabled={
                                                sessionLoading || collectionToggleLoading[item.id] || (Boolean(session) && collectionWatchlistMap[item.id] === undefined)
                                              }
                                              aria-busy={Boolean(collectionToggleLoading[item.id])}
                                              aria-label={
                                                session && collectionWatchlistMap[item.id] === undefined ? "清單狀態待確認" : collectionWatchlistMap[item.id]
                                                  ? "移除清單"
                                                  : "加入清單"
                                              }
                                              aria-pressed={session && collectionWatchlistMap[item.id] === undefined ? undefined : Boolean(collectionWatchlistMap[item.id])}
                                            >
                                              {collectionToggleLoading[item.id] && <span className="watch-spinner" aria-hidden="true" />}
                                              <svg
                                                aria-hidden="true"
                                                className={collectionToggleLoading[item.id] ? "hidden" : "h-4 w-4"}
                                                viewBox="0 0 24 24"
                                                fill={
                                                  collectionWatchlistMap[
                                                    item.id
                                                  ]
                                                    ? "currentColor"
                                                    : "none"
                                                }
                                                stroke="currentColor"
                                                strokeWidth="1.6"
                                              >
                                                <path
                                                  d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.9L12 16.9 6.8 19.6l1-5.9-4.2-4.1 5.8-.8L12 3.5z"
                                                  strokeLinejoin="round"
                                                />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                          </div>
                    )}
                  </DetailOverview>
                )}
                {detailTab === "history" && (
                  <div className={`${historyStyles.page} flex h-full min-h-0 flex-1 flex-col gap-3`}>
                    {detailData.media_type === "movie" && (
                      <div className={`${historyStyles.page} flex h-full min-h-0 flex-1 flex-col gap-3`}>
                        {!sessionLoading && !session && (
                          <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-watch-border-subtle bg-watch-surface px-4 py-10 text-sm text-watch-text-secondary">
                            請先登入以紀錄觀看日期。
                          </div>
                        )}
                        {!sessionLoading && session && isUnreleasedMovie && (
                          <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-watch-border-subtle bg-watch-surface px-4 py-10 text-sm text-watch-text-secondary">
                            該電影尚未上映，無法紀錄觀看日期。
                          </div>
                        )}
                        {!sessionLoading && session && !isUnreleasedMovie && (
                          <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm text-watch-text-secondary">
                            {historyRecordsError && (
                              <div role="alert" className="flex items-center gap-3 text-sm text-watch-error">
                                <span>{historyRecordsError}</span>
                                <button
                                  type="button"
                                  disabled={historyRecordsLoading}
                                  onClick={() => {
                                    preserveHistoryScrollForAutoRefresh("movie");
                                    void fetchHistoryRecords();
                                  }}
                                  className="watch-button watch-button--small shrink-0"
                                >
                                  <span className="watch-spinner-slot" aria-hidden="true">{historyRecordsLoading && <span className="watch-spinner" />}</span>重試
                                </button>
                              </div>
                            )}
                            {historyRecordsLoading && historyRecords.length === 0 ? (
                              <div role="status" className="watch-loading flex h-full min-h-0 items-center justify-center text-sm">
                                <span className="watch-spinner" aria-hidden="true" />正在讀取觀看紀錄…
                              </div>
                            ) : historyRecordsError && historyRecords.length === 0 ? null : (
                              <>
                                <div className={historyStyles.toolbar}>
                                  <span className={`${historyStyles.count} watch-loading`}>
                                    <span className="watch-spinner-slot" aria-hidden="true">{historyRecordsLoading && <span className="watch-spinner" />}</span>共 {historyRecords.length} 筆紀錄
                                  </span>
                                  {!showHistoryEditor && (
                                    <button
                                      type="button"
                                      className={`watch-button watch-button--primary ${historyStyles.addButton}`}
                                      onClick={() => openHistoryEditor()}
                                    >
                                      新增觀看紀錄
                                    </button>
                                  )}
                                </div>


                                <div
                                  ref={movieHistoryScrollRef}
                                  className={`${historyStyles.scrollList} flex-1 min-h-0 pb-3 ${
                                    isMobileLayout
                                      ? "overflow-visible pr-0"
                                      : "overflow-y-auto pr-1"
                                  }`}
                                >
                                  {historyRecords.length === 0 ? (
                                    <div className="flex h-full min-h-30 items-center justify-center text-xs text-watch-text-muted">
                                      尚未建立觀看紀錄。
                                    </div>
                                  ) : (
                                    <div>
                                      {historyRecords.map((record, recordIndex) => {
                                        const isOwner =
                                          session?.user.id === record.owner_id;
                                        const participants =
                                          sortParticipantsForDisplay(record.participants);
                                        return (
                                          <div
                                            key={`${record.owner_id}-${record.watched_at}`}
                                            className={historyStyles.movieEntry}
                                          >
                                            {(recordIndex === 0 ||
                                              historyRecords[recordIndex - 1].watched_at.slice(0, 7) !==
                                                record.watched_at.slice(0, 7)) && (
                                              <p className={historyStyles.monthGroup}>
                                                {record.watched_at.slice(0, 4)} 年 {record.watched_at.slice(5, 7)} 月
                                              </p>
                                            )}
                                            <div className={historyStyles.timelineItem} data-status="seen">
                                              <div className={historyStyles.timeLabel} aria-hidden="true">
                                                {record.watched_at.slice(5, 7)}月
                                                <strong>{record.watched_at.slice(8, 10)}</strong>
                                              </div>
                                              <div className={historyStyles.timelineBody}>
                                                <div className={historyStyles.row}>
                                                  <div className={historyStyles.metadata}>
                                                    <span className="shrink-0 text-watch-text-muted">
                                                      觀看日期
                                                    </span>
                                                    <span className={historyStyles.watchDate}>
                                                      {record.watched_at}
                                                    </span>
                                                    {participants.length > 0 ? (
                                                      <>
                                                        <span className="shrink-0">
                                                          和
                                                        </span>
                                                        <div className="flex items-center gap-2 text-watch-text-secondary">
                                                          {participants.map(
                                                            (item) => (
                                                              <span
                                                                key={item.friend_id}
                                                                className="flex items-center gap-2 text-watch-text-secondary"
                                                              >
                                                                <span
                                                                  className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-watch-surface text-[10px] font-semibold ${
                                                                    item.is_owner
                                                                      ? "border-watch-owner text-watch-text border-2"
                                                                      : "border-watch-border text-watch-text"
                                                                  }`}
                                                                  aria-hidden="true"
                                                                >
                                                                  {resolveAvatarUrl(
                                                                    item.friend_id,
                                                                  ) ? (
                                                                    <Image
                                                                      src={
                                                                        resolveAvatarUrl(
                                                                          item.friend_id,
                                                                        ) as string
                                                                      }
                                                                      alt=""
                                                                      fill
                                                                      sizes="24px"
                                                                      className="object-cover"
                                                                    />
                                                                  ) : (
                                                                    getFriendInitial(
                                                                      item.friend_id,
                                                                      item.friend_nickname,
                                                                    )
                                                                  )}
                                                                </span>
                                                                <span
                                                                  className={`whitespace-nowrap font-semibold ${
                                                                    item.is_owner
                                                                      ? "text-watch-owner"
                                                                      : "text-watch-text"
                                                                  }`}
                                                                >
                                                                  {getFriendName(
                                                                    item.friend_id,
                                                                    item.friend_nickname,
                                                                  )}
                                                                </span>
                                                              </span>
                                                            ),
                                                          )}
                                                        </div>
                                                        <span className="shrink-0">
                                                          一起看
                                                        </span>
                                                      </>
                                                    ) : !isOwner ? (
                                                      <span className="shrink-0 text-watch-text-muted">
                                                        由好友同步
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                  {isOwner && (
                                                    <div className={historyStyles.actions}>
                                                      <button
                                                        type="button"
                                                        className="text-watch-text-secondary transition enabled:hover:text-watch-text"
                                                        onClick={() =>
                                                          openHistoryEditor(record)
                                                        }
                                                        aria-label="編輯觀看日期"
                                                      >
                                                        <svg
                                                          aria-hidden="true"
                                                          className="h-6 w-6"
                                                          viewBox="0 0 24 24"
                                                          fill="none"
                                                          stroke="currentColor"
                                                          strokeWidth="1.6"
                                                        >
                                                          <path
                                                            d="M4 20h4l10-10-4-4L4 16v4z"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                          />
                                                          <path
                                                            d="M14 6l4 4"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                          />
                                                        </svg>
                                                      </button>
                                                      <button
                                                        type="button"
                                                        className="text-watch-error transition enabled:hover:text-watch-error"
                                                        onClick={() =>
                                                          handleDeleteRecord(record)
                                                        }
                                                        aria-label="刪除觀看日期"
                                                      >
                                                        <svg
                                                          aria-hidden="true"
                                                          className="h-6 w-6"
                                                          viewBox="0 0 24 24"
                                                          fill="none"
                                                          stroke="currentColor"
                                                          strokeWidth="1.6"
                                                        >
                                                          <path
                                                            d="M3 6h18"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                          />
                                                          <path
                                                            d="M8 6V4h8v2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                          />
                                                          <path
                                                            d="M6 6l1 14h10l1-14"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                          />
                                                        </svg>
                                                      </button>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {detailData.media_type !== "movie" &&
                      detailData.media_type !== "tv" && (
                        <div className="rounded-xl border border-watch-border-subtle bg-watch-surface p-4 text-sm text-watch-text-secondary">
                          此內容沒有季數。
                        </div>
                      )}
                    {detailData.media_type === "tv" &&
                      (() => {
                        const seasonCount =
                          detailData.seasons_info?.length ?? 0;
                        const hasSeasonOptions = seasonCount > 0;
                        const showSeasonMessage =
                          !hasSeasonOptions || selectedSeason === null;
                        const showEpisodeMessage =
                          hasSeasonOptions &&
                          selectedSeason !== null &&
                          !seasonLoading &&
                          !seasonError &&
                          seasonEpisodes.length === 0;
                        const episodeHistoryReady =
                          selectedSeason !== null &&
                          episodeHistoryScope === `${sessionUserId}:tv:${activeTmdbId}:${selectedSeason}`;
                        const episodeHistoryErrorMessage = episodeHistoryError?.scope === `${sessionUserId}:tv:${activeTmdbId}:${selectedSeason}`
                          ? episodeHistoryError.message : "";
                        const isEpisodeLoading =
                          selectedSeason &&
                          !seasonError &&
                          (seasonLoading ||
                            (episodeHistoryLoading && !episodeHistoryReady) ||
                            !episodeSeasonPrefReady ||
                            (seasonEpisodes.length > 0 &&
                              !episodeHistoryReady && !episodeHistoryErrorMessage));

                        return (
                          <>
                            {!sessionLoading && !session && (
                              <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-watch-border-subtle bg-watch-surface px-4 py-10 text-sm text-watch-text-secondary">
                                請先登入以紀錄觀看日期。
                              </div>
                            )}
                            <div
                              className={`flex min-h-0 flex-1 flex-col gap-3 pb-3 text-sm text-watch-text-secondary ${
                                !sessionLoading && !session ? "hidden" : ""
                              }`}
                            >
                              {episodeHistoryErrorMessage && (
                                <div role="alert" className="flex shrink-0 items-center gap-3 text-sm text-watch-error">
                                  <span>{episodeHistoryErrorMessage}</span>
                                  <button
                                    type="button"
                                    aria-label="重試集數觀看紀錄"
                                    aria-busy={episodeHistoryLoading}
                                    disabled={episodeHistoryLoading}
                                    className="watch-button watch-button--small shrink-0"
                                    onClick={() => {
                                      preserveHistoryScrollForAutoRefresh("episode");
                                      void fetchEpisodeHistory();
                                    }}
                                  >
                                    <span className="watch-spinner-slot" aria-hidden="true">{episodeHistoryLoading && <span className="watch-spinner" />}</span>重試
                                  </button>
                                </div>
                              )}
                              {isEpisodeLoading ? (
                                <div className="flex h-full min-h-0 items-center justify-center">
                                  <p role="status" className="watch-loading text-sm"><span className="watch-spinner" aria-hidden="true" />正在讀取資料…</p>
                                </div>
                              ) : (
                                <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm text-watch-text-secondary">
                                  <div className={`${historyStyles.toolbar} ${historyStyles.seasonToolbar}`}>
                                    <select
                                      aria-label="選擇季數"
                                      id="detail-season-select-modal"
                                      name="detail-season-select-modal"
                                      className={historyStyles.seasonSelect}
                                      value={selectedSeason ?? ""}
                                      onChange={(event) => {
                                        seasonSelectionManualRef.current = true;
                                        lastSavedEpisodeRef.current = null;
                                        setSelectedSeason(
                                          event.target.value
                                            ? Number(event.target.value)
                                            : null,
                                        );
                                      }}
                                      disabled={!hasSeasonOptions}
                                    >
                                      {hasSeasonOptions ? (
                                        detailData.seasons_info?.map(
                                          (season) => (
                                            <option
                                              key={season.season_number}
                                              value={season.season_number}
                                            >
                                              第{season.season_number}季 · {(() => {
                                                const aired = getSharedSeasonAiredTotal(detailData.id, season, episodeToday);
                                                return aired === null ? "已播出待確認" : `已播 ${aired} 集`;
                                              })()}
                                            </option>
                                          ),
                                        )
                                      ) : (
                                        <option value="">
                                          尚未取得季數資料
                                        </option>
                                      )}
                                    </select>
                                    {episodeHistoryLoading && <span className="watch-spinner" role="status" aria-label="正在更新觀看紀錄" title="正在更新觀看紀錄" />}
                                  </div>
                                  <div className="mt-1 flex min-h-0 flex-1 flex-col">
                                    {showSeasonMessage && (
                                      <p className="text-watch-text-muted">
                                        {hasSeasonOptions
                                          ? "尚未選擇季數。"
                                          : "尚未取得季數資料。"}
                                      </p>
                                    )}
                                    {selectedSeason &&
                                      !seasonLoading &&
                                      seasonError && (
                                        <p className="text-watch-error">
                                          {seasonError}
                                        </p>
                                      )}
                                    {showEpisodeMessage && (
                                      <p className="text-watch-text-muted">
                                        尚未取得集數資料。
                                      </p>
                                    )}
                                    {selectedSeason &&
                                      !seasonLoading &&
                                      !seasonError &&
                                      episodeHistoryReady &&
                                      seasonEpisodes.length > 0 && (
                                        <div
                                          ref={episodeHistoryScrollRef}
                                          className={`${historyStyles.scrollList} ${historyStyles.episodeList} grid content-start flex-1 min-h-0 ${
                                            isMobileLayout
                                              ? "overflow-visible pr-0"
                                              : "overflow-y-auto pr-2"
                                          }`}
                                        >
                                          {seasonEpisodes.map((episode) => {
                                            const record =
                                              episodeHistoryMap[
                                                episode.episode_number
                                              ] ?? null;
                                            const episodeAirDate =
                                              episode.air_date ?? null;
                                            const isFutureEpisode =
                                              !isEpisodeDate(episodeAirDate) ||
                                              episodeAirDate >
                                                episodeToday;
                                            const daysUntilAir =
                                              episodeAirDate && isFutureEpisode
                                                ? getDaysUntil(episodeAirDate)
                                                : null;
                                            const isOwner =
                                              record &&
                                              session?.user.id ===
                                                record.owner_id;
                                            const participants = record
                                              ? sortParticipantsForDisplay(record.participants)
                                              : [];
                                            const canEdit =
                                              Boolean(record) &&
                                              isOwner &&
                                              !isFutureEpisode;

                                            return (
                                              <div
                                                ref={(node) => {
                                                  episodeCardRefs.current[
                                                    episode.episode_number
                                                  ] = node;
                                                }}
                                                key={`${selectedSeason}-${episode.episode_number}`}
                                                className={historyStyles.timelineItem}
                                                data-episode={episode.episode_number}
                                                data-status={isFutureEpisode ? "upcoming" : record ? "seen" : "unseen"}
                                              >
                                                <div className={historyStyles.timeLabel} aria-hidden="true">
                                                  第
                                                  <strong>{String(episode.episode_number).padStart(2, "0")}</strong>
                                                  集
                                                </div>
                                                <div className={historyStyles.timelineBody}>
                                                  <div className={historyStyles.row}>
                                                    <div className={historyStyles.rowText}>
                                                      <p className={historyStyles.episodeTitle}>
                                                        S{selectedSeason}E
                                                        {episode.episode_number}
                                                        {episode.name
                                                          ? ` - ${episode.name}`
                                                          : ""}
                                                      </p>
                                                      {record && (
                                                        <div className={historyStyles.metadata}>
                                                          <span className={historyStyles.watchDate}>
                                                            {record.watched_at}
                                                          </span>
                                                          {participants.length >
                                                          0 ? (
                                                            <>
                                                              <span className="text-watch-text-secondary">
                                                                和
                                                              </span>
                                                              {participants.map(
                                                                (item) => (
                                                                  <span
                                                                    key={
                                                                      item.friend_id
                                                                    }
                                                                    className="flex items-center gap-2 text-watch-text-secondary"
                                                                  >
                                                                    <span
                                                                      className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-watch-surface text-[10px] font-semibold ${
                                                                        item.is_owner
                                                                          ? "border-watch-owner text-watch-text border-2"
                                                                          : "border-watch-border text-watch-text"
                                                                      }`}
                                                                      aria-hidden="true"
                                                                    >
                                                                      {resolveAvatarUrl(
                                                                        item.friend_id,
                                                                      ) ? (
                                                                        <Image
                                                                          src={
                                                                            resolveAvatarUrl(
                                                                              item.friend_id,
                                                                            ) as string
                                                                          }
                                                                          alt=""
                                                                          fill
                                                                          sizes="24px"
                                                                          className="object-cover"
                                                                        />
                                                                      ) : (
                                                                        getFriendInitial(
                                                                          item.friend_id,
                                                                          item.friend_nickname,
                                                                        )
                                                                      )}
                                                                    </span>
                                                                    <span
                                                                      className={`whitespace-nowrap font-semibold ${
                                                                        item.is_owner
                                                                          ? "text-watch-owner"
                                                                          : "text-watch-text"
                                                                      }`}
                                                                    >
                                                                      {getFriendName(
                                                                        item.friend_id,
                                                                        item.friend_nickname,
                                                                      )}
                                                                    </span>
                                                                  </span>
                                                                ),
                                                              )}
                                                              <span className="text-watch-text-secondary">
                                                                一起看
                                                              </span>
                                                            </>
                                                          ) : !isOwner ? (
                                                            <span className="text-watch-text-muted">
                                                              由好友同步
                                                            </span>
                                                          ) : null}
                                                        </div>
                                                      )}
                                                    </div>
                                                    {isFutureEpisode && (
                                                      <span className={historyStyles.airNotice}>
                                                        {daysUntilAir !== null
                                                          ? `${daysUntilAir}天後播出`
                                                          : "尚未播出"}
                                                      </span>
                                                    )}
                                                    {!isFutureEpisode &&
                                                      (!record || canEdit) && (
                                                        <div className={historyStyles.actions}>
                                                          {!record && (
                                                            <button
                                                              type="button"
                                                              className="text-watch-text-secondary transition enabled:hover:text-watch-text"
                                                              onClick={() =>
                                                                openEpisodeEditor(
                                                                  episode.episode_number,
                                                                  null,
                                                                )
                                                              }
                                                              disabled={episodeHistoryLoading}
                                                              aria-label="紀錄觀看日期"
                                                            >
                                                              <svg
                                                                aria-hidden="true"
                                                                className="h-6 w-6"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                strokeWidth="1.6"
                                                              >
                                                                <rect
                                                                  x="3"
                                                                  y="4"
                                                                  width="18"
                                                                  height="18"
                                                                  rx="3"
                                                                />
                                                                <path d="M16 2v4M8 2v4M3 10h18" />
                                                              </svg>
                                                            </button>
                                                          )}
                                                          {canEdit && (
                                                            <>
                                                              <button
                                                                type="button"
                                                                className="text-watch-text-secondary transition enabled:hover:text-watch-text"
                                                                onClick={() =>
                                                                  openEpisodeEditor(
                                                                    episode.episode_number,
                                                                    record ??
                                                                      null,
                                                                  )
                                                                }
                                                                disabled={episodeHistoryLoading}
                                                                aria-label="編輯觀看日期"
                                                              >
                                                                <svg
                                                                  aria-hidden="true"
                                                                  className="h-6 w-6"
                                                                  viewBox="0 0 24 24"
                                                                  fill="none"
                                                                  stroke="currentColor"
                                                                  strokeWidth="1.6"
                                                                >
                                                                  <path
                                                                    d="M4 20h4l10-10-4-4L4 16v4z"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                  />
                                                                  <path
                                                                    d="M14 6l4 4"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                  />
                                                                </svg>
                                                              </button>
                                                              <button
                                                                type="button"
                                                                className="text-watch-error transition enabled:hover:text-watch-error"
                                                                disabled={episodeHistoryLoading}
                                                                onClick={() =>
                                                                  handleDeleteEpisodeRecord(
                                                                    episode.episode_number,
                                                                    record ??
                                                                      null,
                                                                  )
                                                                }
                                                                aria-label="刪除觀看日期"
                                                              >
                                                                <svg
                                                                  aria-hidden="true"
                                                                  className="h-6 w-6"
                                                                  viewBox="0 0 24 24"
                                                                  fill="none"
                                                                  stroke="currentColor"
                                                                  strokeWidth="1.6"
                                                                >
                                                                  <path
                                                                    d="M3 6h18"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                  />
                                                                  <path
                                                                    d="M8 6V4h8v2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                  />
                                                                  <path
                                                                    d="M6 6l1 14h10l1-14"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                  />
                                                                </svg>
                                                              </button>
                                                            </>
                                                          )}
                                                        </div>
                                                      )}
                                                  </div>


                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {recordEditorOpen && detailData && (
          <div className={styles.editorLayer}>
            <WatchRecordEditor
              inputId={activeMediaType === "movie" ? "movie-watch-date" : "episode-watch-date"}
              title={activeMediaType === "movie"
                ? editingRecord ? "編輯觀看紀錄" : "新增觀看紀錄"
                : `${episodeEditingRecord ? "編輯" : "記錄"} S${selectedSeason}E${episodeEditingNumber}`}
              subtitle={activeMediaType === "movie" ? detailData.title
                : seasonEpisodes.find(episode => episode.episode_number === episodeEditingNumber)?.name || detailData.title}
              date={activeMediaType === "movie" ? watchedDate : episodeWatchedDate}
              today={getTodayDateString()}
              lastDate={lastOwnRecordDate || lastLoadedOwnDate}
              friends={friends.map(friend => ({
                id: friend.friend_id,
                name: getFriendName(friend.friend_id, friend.friend_nickname),
                avatarUrl: resolveAvatarUrl(friend.friend_id),
              }))}
              selectedFriendIds={activeMediaType === "movie" ? selectedFriendIds : episodeSelectedFriendIds}
              friendsLoading={friendsLoading}
              friendsReady={friendsReady && !privateDataError}
              disabled={privateDataLoading || isInWatchlist === null || Boolean(privateDataError)}
              busy={editorBusy}
              retryLoading={privateDataLoading}
              notice={privateDataError || collectionToast?.message}
              noticeTone={privateDataError ? "error" : collectionToast?.tone}
              onRetry={privateDataError ? () => setPrivateDataRetry(value => value + 1) : undefined}
              onDateChange={activeMediaType === "movie" ? setWatchedDate : setEpisodeWatchedDate}
              onFriendsChange={activeMediaType === "movie" ? setSelectedFriendIds : setEpisodeSelectedFriendIds}
              onDateFocus={() => activeMediaType === "movie" ? setMovieDatePickerActive(true) : setEpisodeDatePickerActive(true)}
              onDateBlur={() => activeMediaType === "movie" ? setMovieDatePickerActive(false) : setEpisodeDatePickerActive(false)}
              onDismiss={dismissRecordEditor}
              onEscape={escapeRecordEditor}
              onSubmit={() => { if (activeMediaType === "movie") void handleSaveWatchRecord(); else void handleSaveEpisodeRecord(); }}
            />
          </div>
        )}
      </div>
      {collectionToast && !recordEditorOpen && (
        <div
          ref={collectionToastRef}
          className={`fixed z-50 whitespace-nowrap rounded-full border border-watch-border bg-watch-popover px-3 py-1.5 text-xs ${
            collectionToast.anchor
              ? "-translate-x-1/2 -translate-y-full"
              : "right-6 top-24"
          }`}
          style={
            collectionToast.anchor
              ? {
                  left:
                    collectionToastPosition?.left ?? collectionToast.anchor.left,
                  top:
                    collectionToastPosition?.top ?? collectionToast.anchor.top,
                }
              : undefined
          }
        >
          <span
            className={
              collectionToast.tone === "error"
                ? "text-watch-error"
                : "text-watch-complete"
            }
          >
            {collectionToast.message}
          </span>
        </div>
      )}
      {deleteConfirmOpen && deleteConfirmTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          onClick={closeDeleteConfirm}
        >
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-delete`}
            tabIndex={-1}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-sm rounded-2xl border border-watch-border-subtle bg-watch-popover p-6 shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <p id={`${dialogId}-delete`} className="text-sm font-semibold text-watch-text">確認刪除</p>
            <p className="mt-2 text-xs text-watch-text-secondary">
              刪除後無法復原，請確認以下內容。
            </p>
            <div className="mt-4 grid gap-2 rounded-lg border border-watch-border-subtle bg-watch-surface px-3 py-3 text-xs text-watch-text-secondary">
              {deleteConfirmTarget.kind === "episode" ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-watch-text-muted">片名</span>
                    <span className="text-watch-text-secondary">
                      {detailData?.title ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-watch-text-muted">集數</span>
                    <span className="text-watch-text-secondary">
                      S{deleteConfirmTarget.season}E
                      {deleteConfirmTarget.episodeNumber}
                      {deleteConfirmTarget.episodeName
                        ? ` - ${deleteConfirmTarget.episodeName}`
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-watch-text-muted">觀看日期</span>
                    <span className="text-watch-text-secondary">
                      {deleteConfirmTarget.record.watched_at}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-watch-text-muted">同步好友</span>
                    <span className="text-watch-text-secondary">
                      {formatParticipants(
                        deleteConfirmTarget.record.participants,
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-watch-text-muted">片名</span>
                    <span className="text-watch-text-secondary">
                      {detailData?.title ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-watch-text-muted">觀看日期</span>
                    <span className="text-watch-text-secondary">
                      {deleteConfirmTarget.record.watched_at}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-watch-text-muted">同步好友</span>
                    <span className="text-watch-text-secondary">
                      {formatParticipants(
                        deleteConfirmTarget.record.participants,
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                className="watch-button"
                onClick={closeDeleteConfirm}
                disabled={deleteConfirmLoading}
              >
                取消
              </button>
              <button
                type="button"
                className={`watch-button watch-button--danger ${styles.deleteButton}`}
                onClick={handleConfirmDelete}
                disabled={deleteConfirmLoading}
              >
                <span className="watch-spinner-slot" aria-hidden="true">{deleteConfirmLoading && <span className="watch-spinner" />}</span>{deleteConfirmLoading ? "刪除中..." : "刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
      {revisionConflictOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          onClick={() => {
            if (revisionConflictLoading) return;
            setRevisionConflictOpen(false);
          }}
        >
          <div
            ref={conflictDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-conflict`}
            tabIndex={-1}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-md rounded-2xl border border-watch-border-subtle bg-watch-popover p-6 shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <p id={`${dialogId}-conflict`} className="text-sm font-semibold text-watch-text">觀看紀錄已更新</p>
            <p className="mt-2 text-xs leading-5 text-watch-text-secondary">
              {revisionConflictMessage}
            </p>
            <div className="mt-4 grid gap-3 text-xs leading-5">
              {revisionConflictLocalSummary && (
                <div className="rounded-lg border border-watch-border-subtle bg-watch-surface px-3 py-3">
                  <p className="font-semibold text-watch-text-secondary">本機這次操作</p>
                  <p className="mt-1 text-watch-text-secondary">
                    {revisionConflictLocalSummary}
                  </p>
                </div>
              )}
              <div className="rounded-lg border border-watch-progress/20 bg-watch-progress/10 px-3 py-3">
                <p className="font-semibold text-watch-progress">雲端目前資料</p>
                <p className="mt-1 text-watch-text-secondary">
                  {revisionConflictRemoteSummary && revisionConflictRemoteSummary !== "正在讀取雲端目前資料..." ? revisionConflictRemoteSummary : <span className="watch-loading"><span className="watch-spinner" aria-hidden="true" />正在讀取雲端目前資料...</span>}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-watch-warning/20 bg-watch-warning/10 px-3 py-3 text-xs leading-5 text-watch-warning">
              選擇雲端資料會重新載入目前最新紀錄；選擇仍套用會用這次操作覆蓋目前雲端版本。
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                className="watch-button"
                onClick={useRemoteRevision}
                disabled={revisionConflictLoading}
              >
                使用雲端資料
              </button>
              <button
                type="button"
                className={`watch-button ${styles.applyButton}`}
                onClick={forceLocalRevision}
                disabled={revisionConflictLoading}
              >
                <span className="watch-spinner-slot" aria-hidden="true">{revisionConflictLoading && <span className="watch-spinner" />}</span>{revisionConflictLoading ? "套用中..." : "仍套用這次操作"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
