"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import useAuth from "@/hooks/useAuth";
import useProfileNames from "@/hooks/useProfileNames";
import {
  DEFAULT_DETAIL_TTL_MS,
  getDetailCache,
  setDetailCache,
} from "@/lib/tmdbDetailCache";

const PROJECT_ID = "watch";

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

type DetailModalProps = {
  open: boolean;
  onClose: () => void;
  mediaType: "movie" | "tv";
  tmdbId: number;
  defaultTab?: "details" | "history";
  onWatchlistChange?: (inWatchlist: boolean, detail: DetailData) => void;
  onWatchDateChange?: (tmdbId: number, watchedDate: string | null) => void;
  onEpisodeHistoryChange?: () => void;
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
}: DetailModalProps) {
  const [activeMediaType, setActiveMediaType] = useState(mediaType);
  const [activeTmdbId, setActiveTmdbId] = useState(tmdbId);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "history">("details");
  const [detailHeight, setDetailHeight] = useState<number | null>(null);
  const [detailBaseHeight, setDetailBaseHeight] = useState<number | null>(null);
  const [detailReady, setDetailReady] = useState(true);
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
  const [isViewportSmall, setIsViewportSmall] = useState(false);
  const { session, loading: sessionLoading } = useAuth();
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [watchedDate, setWatchedDate] = useState("");
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [historyRecordsLoading, setHistoryRecordsLoading] = useState(false);
  const [episodeProgress, setEpisodeProgress] = useState<{
    watched: number;
    total: number;
  } | null>(null);
  const [episodeHistoryMap, setEpisodeHistoryMap] = useState<
    Record<number, HistoryRecord | null>
  >({});
  const [episodeHistoryLoading, setEpisodeHistoryLoading] = useState(false);
  const [episodeHistorySeason, setEpisodeHistorySeason] = useState<
    number | null
  >(null);
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
  const lastSavedEpisodeRef = useRef<{
    season: number;
    episode: number;
  } | null>(null);
  const seasonSelectionManualRef = useRef(false);
  const historyAutoScrollDoneRef = useRef(false);
  const [episodeSaveLoading, setEpisodeSaveLoading] = useState(false);
  const [showHistoryEditor, setShowHistoryEditor] = useState(false);
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
  const historyRequestIdRef = useRef(0);
  const episodeHistoryRequestIdRef = useRef(0);
  const detailModalRef = useRef<HTMLDivElement | null>(null);
  const watchlistSyncRef = useRef<number | null>(null);
  const collectionToastTimerRef = useRef<number | null>(null);
  const collectionToastAnchorRef = useRef<HTMLElement | null>(null);
  const collectionToastRef = useRef<HTMLDivElement | null>(null);
  const [collectionToastPosition, setCollectionToastPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const baseDetailHeight = 447;
  const MIN_MODAL_WIDTH = 820;
  const MIN_MODAL_HEIGHT = 600;

  const getTodayDateString = () => new Date().toLocaleDateString("sv-SE");
  const getDaysUntil = (dateString: string) => {
    const [year, month, day] = dateString.split("-").map(Number);
    if (!year || !month || !day) return null;
    const today = getTodayDateString();
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
  const getTotalAired = (data: DetailData | null) => {
    if (!data || data.media_type !== "tv") return 0;
    return (data.seasons_info ?? []).reduce((sum, season) => {
      if (season.season_number === 0) return sum;
      return sum + (season.episode_count ?? 0);
    }, 0);
  };
  const formatParticipants = (participants: HistoryRecord["participants"]) => {
    if (!participants || participants.length === 0) return "無";
    return participants
      .map((item) => getFriendName(item.friend_id, item.friend_nickname))
      .join("、");
  };
  const isUnreleasedMovie =
    detailData?.media_type === "movie" &&
    detailData.release_date &&
    detailData.release_date > getTodayDateString();

  const resetDetailState = useCallback(
    (initialTab: "details" | "history") => {
      setDetailTab(initialTab);
      setDetailReady(true);
      setDetailHeight(null);
      setDetailBaseHeight(null);
      setDetailLoading(true);
      setDetailError("");
      setDetailData(null);
      setSelectedSeason(null);
      setWatchedDate(getTodayDateString());
      setHistoryRecords([]);
      setHistoryRecordsLoading(false);
      setEpisodeHistoryMap({});
      setEpisodeHistoryLoading(false);
      setEpisodeHistorySeason(null);
      setEpisodeEditorOpen(false);
      setEpisodeEditingRecord(null);
      setEpisodeEditingNumber(null);
      setEpisodeWatchedDate(getTodayDateString());
      setEpisodeSelectedFriendIds([]);
      setEpisodeSaveLoading(false);
      setShowHistoryEditor(false);
      setEditingRecord(null);
      setSelectedFriendIds([]);
      setFriends([]);
      setFriendsLoading(false);
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
      setCollectionToast(null);
      setDeleteConfirmOpen(false);
      setDeleteConfirmTarget(null);
      setDeleteConfirmLoading(false);
      watchlistSyncRef.current = null;
      lastEpisodeScrollKeyRef.current = null;
      lastSavedEpisodeRef.current = null;
      historyAutoScrollDoneRef.current = false;
      seasonSelectionManualRef.current = false;
      setEpisodeSeasonPrefReady(defaultTab !== "history");
    },
    [defaultTab],
  );

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
      const { data, error } = await supabase
        .from("watch_history")
        .select("season_number, episode_number")
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", "tv")
        .eq("tmdb_id", detailData.id);

      if (nextEpisodeRequestIdRef.current !== requestId) return;
      const seasonInfos =
        detailData.seasons_info
          ?.filter(
            (info) =>
              info.season_number > 0 && (info.episode_count ?? 0) > 0,
          )
          .sort((a, b) => a.season_number - b.season_number) ?? [];
      const firstSeason = seasonInfos[0]?.season_number ?? null;
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
            (info) =>
              info.season_number > lastSeason && (info.episode_count ?? 0) > 0,
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
  }, [open, detailTab, session, sessionLoading, detailData]);

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
      target.scrollIntoView({ block: "start", behavior: "smooth" });
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
      target.scrollIntoView({ block: "start", behavior: "smooth" });
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

        const response = await fetch(
          `/api/tmdb/detail?type=${activeMediaType}&id=${activeTmdbId}`,
        );

        if (!response.ok) {
          throw new Error("detail failed");
        }

        const data = (await response.json()) as DetailData;
        if (!isMounted) return;
        if (data.media_type === "tv" && defaultTab !== "history") {
          const firstSeason = data.seasons_info?.[0]?.season_number ?? null;
          setSelectedSeason(firstSeason);
        }
        setDetailData(data);
        setDetailCache(cacheKey, data, DEFAULT_DETAIL_TTL_MS);
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
  }, [open, activeMediaType, activeTmdbId, defaultTab]);

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

    const cacheKey = `tv:${detailData.id}:season:${selectedSeason}`;
    const cached = getDetailCache<EpisodeInfo[]>(cacheKey);
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
        const response = await fetch(
          `/api/tmdb/season?type=tv&id=${detailData.id}&season=${selectedSeason}`,
        );
        if (!response.ok) throw new Error("season failed");
        const data = await response.json();
        if (!isMounted) return;
        const episodes = (data.episodes ?? []) as EpisodeInfo[];
        setSeasonEpisodes(episodes);
        setDetailCache(cacheKey, episodes, DEFAULT_DETAIL_TTL_MS);
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
  }, [detailData, selectedSeason]);

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
  }, [open, detailData, collectionOpen]);

  useEffect(() => {
    if (!open) return;
    if (!session) {
      setCollectionWatchlistMap({});
      return;
    }
    if (!collectionOpen || collectionItems.length === 0) return;

    let isMounted = true;
    const ids = collectionItems.map((item) => item.id);

    supabase
      .from("watchlist_items")
      .select("tmdb_id")
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", "movie")
      .in("tmdb_id", ids)
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) return;
        const nextMap: Record<number, boolean> = {};
        (data ?? []).forEach((row) => {
          if (typeof row.tmdb_id === "number") {
            nextMap[row.tmdb_id] = true;
          }
        });
        setCollectionWatchlistMap(nextMap);
      });

    return () => {
      isMounted = false;
    };
  }, [open, session, collectionOpen, collectionItems]);

  useEffect(() => {
    if (!collectionToast) return;
    if (collectionToastTimerRef.current) {
      window.clearTimeout(collectionToastTimerRef.current);
    }
    collectionToastTimerRef.current = window.setTimeout(() => {
      setCollectionToast(null);
    }, 2400);
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

  useLayoutEffect(() => {
    if (!open) return;
    if (detailTab !== "details") return;
    if (detailLoading || !detailData) return;
    if (!detailModalRef.current) return;
    const nextHeight = detailModalRef.current.offsetHeight;
    if (nextHeight > 0) {
      setDetailHeight(nextHeight);
      setDetailBaseHeight(nextHeight);
      if (defaultTab === "history" && !detailReady) {
        setDetailTab("history");
        setDetailReady(true);
      }
    }
  }, [open, detailTab, detailLoading, detailData, defaultTab, detailReady]);

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

  useEffect(() => {
    if (!open) return;
    if (!session) {
      setIsInWatchlist(false);
      return;
    }

    let isMounted = true;
    setWatchlistLoading(true);
    setWatchlistNotice("");

    const run = async () => {
      try {
        const { data, error } = await supabase
          .from("watchlist_items")
          .select("id")
          .eq("user_id", session.user.id)
          .eq("project_id", PROJECT_ID)
          .eq("media_type", activeMediaType)
          .eq("tmdb_id", activeTmdbId)
          .maybeSingle();
        if (!isMounted) return;
        if (error) {
          setIsInWatchlist(false);
          return;
        }
        setIsInWatchlist(Boolean(data));
      } finally {
        if (!isMounted) return;
        setWatchlistLoading(false);
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, [open, session, sessionLoading, activeMediaType, activeTmdbId]);

  useEffect(() => {
    if (!open) return;
    const checkViewport = () => {
      setIsViewportSmall(
        window.innerWidth < MIN_MODAL_WIDTH ||
          window.innerHeight < MIN_MODAL_HEIGHT,
      );
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

  useEffect(() => {
    if (!watchlistNotice) return;
    showCollectionToast(watchlistNotice, watchlistNoticeTone);
    setWatchlistNotice("");
  }, [watchlistNotice, watchlistNoticeTone, showCollectionToast]);

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
    if (collectionToggleLoading[item.id]) return;

    setCollectionToggleLoading((prev) => ({ ...prev, [item.id]: true }));

    const inWatchlist = Boolean(collectionWatchlistMap[item.id]);
    if (inWatchlist) {
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", "movie")
        .eq("tmdb_id", item.id);
      if (error) {
        showCollectionToast(
          error.message?.includes("watch_history_exists")
            ? "已有觀看紀錄，無法移除清單。"
            : "移除失敗，請稍後再試。",
          "error",
          anchorEl,
        );
      } else {
        setCollectionWatchlistMap((prev) => {
          const next = { ...prev };
          delete next[item.id];
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
        });
      }
      setCollectionToggleLoading((prev) => ({ ...prev, [item.id]: false }));
      return;
    }

    const { error } = await supabase.from("watchlist_items").insert({
      user_id: session.user.id,
      project_id: PROJECT_ID,
      media_type: "movie",
      tmdb_id: item.id,
      title: item.title,
      year: item.year,
      release_date: item.release_date,
      poster_path: item.poster_path,
      is_anime: false,
      tmdb_cached_at: new Date().toISOString(),
    });

    if (error) {
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
      });
    }

    setCollectionToggleLoading((prev) => ({ ...prev, [item.id]: false }));
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
    supabase
      .from("watchlist_items")
      .update({
        title: detailData.title,
        year: getWatchlistYear(detailData),
        release_date:
          detailData.media_type === "movie"
            ? (detailData.release_date ?? null)
            : null,
        poster_path: detailData.poster_path,
        is_anime: detailData.is_anime,
        tmdb_cached_at: new Date().toISOString(),
      })
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .then(() => undefined);
  }, [open, session, isInWatchlist, detailData]);

  useEffect(() => {
    if (!open || !session) return;
    if (activeMediaType !== "movie" && activeMediaType !== "tv") return;

    let isMounted = true;
    setFriendsLoading(true);

    const loadFriends = async () => {
      try {
        const { data } = await supabase
          .from("friends")
          .select("friend_id, friend_nickname")
          .eq("user_id", session.user.id)
          .eq("project_id", PROJECT_ID)
          .order("created_at", { ascending: false });
        if (!isMounted) return;
        setFriends(
          (data ?? []) as Array<{
            friend_id: string;
            friend_nickname: string | null;
          }>,
        );
      } finally {
        if (!isMounted) return;
        setFriendsLoading(false);
      }
    };

    loadFriends();

    return () => {
      isMounted = false;
    };
  }, [open, session, activeMediaType, activeTmdbId]);

  const buildHistoryRecords = useCallback((rows: HistoryRecordRow[]) => {
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
  }, []);

  const fetchHistoryRecords = useCallback(async () => {
    historyRequestIdRef.current += 1;
    const requestId = historyRequestIdRef.current;
    if (!open || !session || activeMediaType !== "movie") {
      setHistoryRecords([]);
      setHistoryRecordsLoading(false);
      return;
    }

    setHistoryRecordsLoading(true);

    try {
      const { data, error } = await supabase.rpc("get_watch_history_records", {
        target_project: PROJECT_ID,
        target_media: "movie",
        target_tmdb_id: activeTmdbId,
        target_season: 0,
        target_episode: 0,
      });
      if (historyRequestIdRef.current !== requestId) return;
      if (error) {
        setHistoryRecords([]);
        return;
      }
      const rows = (data ?? []) as HistoryRecordRow[];
      setHistoryRecords(buildHistoryRecords(rows));
    } finally {
      if (historyRequestIdRef.current !== requestId) return;
      setHistoryRecordsLoading(false);
    }
  }, [open, session, activeMediaType, activeTmdbId, buildHistoryRecords]);

  useEffect(() => {
    fetchHistoryRecords();
    return () => {
      historyRequestIdRef.current += 1;
    };
  }, [fetchHistoryRecords]);

  const fetchEpisodeHistory = useCallback(async () => {
    episodeHistoryRequestIdRef.current += 1;
    const requestId = episodeHistoryRequestIdRef.current;
    if (
      !open ||
      !session ||
      activeMediaType !== "tv" ||
      !detailData ||
      detailData.media_type !== "tv" ||
      !selectedSeason ||
      seasonEpisodes.length === 0
    ) {
      setEpisodeHistoryMap({});
      setEpisodeHistoryLoading(false);
      setEpisodeHistorySeason(null);
      return;
    }

    setEpisodeHistoryLoading(true);

    try {
      const results = await Promise.all(
        seasonEpisodes.map(async (episode) => {
          const { data, error } = await supabase.rpc(
            "get_watch_history_records",
            {
              target_project: PROJECT_ID,
              target_media: "tv",
              target_tmdb_id: detailData.id,
              target_season: selectedSeason,
              target_episode: episode.episode_number,
            },
          );
          if (error) {
            return { episodeNumber: episode.episode_number, record: null };
          }
          const rows = (data ?? []) as HistoryRecordRow[];
          const records = buildHistoryRecords(rows);
          return {
            episodeNumber: episode.episode_number,
            record: records[0] ?? null,
          };
        }),
      );
      if (episodeHistoryRequestIdRef.current !== requestId) return;
      const nextMap: Record<number, HistoryRecord | null> = {};
      results.forEach(({ episodeNumber, record }) => {
        nextMap[episodeNumber] = record;
      });
      setEpisodeHistoryMap(nextMap);
      setEpisodeHistorySeason(selectedSeason);
    } finally {
      if (episodeHistoryRequestIdRef.current !== requestId) return;
      setEpisodeHistoryLoading(false);
    }
  }, [
    open,
    session,
    activeMediaType,
    detailData,
    selectedSeason,
    seasonEpisodes,
    buildHistoryRecords,
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

    const totalAired = getTotalAired(detailData);
    if (!totalAired) {
      setEpisodeProgress(null);
      return;
    }

    const { count, error } = await supabase
      .from("watch_history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", "tv")
      .eq("tmdb_id", detailData.id);

    if (error) {
      setEpisodeProgress(null);
      return;
    }

    setEpisodeProgress({ watched: count ?? 0, total: totalAired });
  }, [detailData, open, session]);

  useEffect(() => {
    void fetchEpisodeProgress();
  }, [fetchEpisodeProgress]);

  useEffect(() => {
    if (!open || !session || activeMediaType !== "movie") return;

    const refresh = () => fetchHistoryRecords();
    const historyChannel = supabase
      .channel(`detail-history-${session.user.id}-${activeTmdbId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history",
          filter: `user_id=eq.${session.user.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history_shares",
          filter: `owner_id=eq.${session.user.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history_shares",
          filter: `target_user_id=eq.${session.user.id}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(historyChannel);
    };
  }, [open, session, activeMediaType, activeTmdbId, fetchHistoryRecords]);

  useEffect(() => {
    if (!open || !session || activeMediaType !== "tv") return;

    const refresh = () => {
      fetchEpisodeHistory();
      fetchEpisodeProgress();
    };
    const historyChannel = supabase
      .channel(`detail-history-tv-${session.user.id}-${activeTmdbId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history",
          filter: `user_id=eq.${session.user.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history_shares",
          filter: `owner_id=eq.${session.user.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history_shares",
          filter: `target_user_id=eq.${session.user.id}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(historyChannel);
    };
  }, [
    open,
    session,
    activeMediaType,
    activeTmdbId,
    fetchEpisodeHistory,
    fetchEpisodeProgress,
  ]);

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
    if (watchlistLoading) return;

    setWatchlistLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    if (isInWatchlist) {
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", detailData.media_type)
        .eq("tmdb_id", detailData.id);
      if (error) {
        setWatchlistNotice(
          error.message?.includes("watch_history_exists")
            ? "已有觀看紀錄，無法移除清單。"
            : "移除失敗，請稍後再試。",
        );
        setWatchlistNoticeTone("error");
      } else {
        setIsInWatchlist(false);
        setWatchlistNotice("已從清單移除。");
        setWatchlistNoticeTone("success");
        onWatchlistChange?.(false, detailData);
      }
      setWatchlistLoading(false);
      return;
    }

    const { error } = await supabase.from("watchlist_items").insert({
      user_id: session.user.id,
      project_id: PROJECT_ID,
      media_type: detailData.media_type,
      tmdb_id: detailData.id,
      title: detailData.title,
      year: getWatchlistYear(detailData),
      release_date:
        detailData.media_type === "movie"
          ? (detailData.release_date ?? null)
          : null,
      poster_path: detailData.poster_path,
      is_anime: detailData.is_anime,
      tmdb_cached_at: new Date().toISOString(),
    });

    if (error) {
      setWatchlistNotice("加入失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
    } else {
      setIsInWatchlist(true);
      setWatchlistNotice("已加入清單。");
      setWatchlistNoticeTone("success");
      onWatchlistChange?.(true, detailData);
    }
    setWatchlistLoading(false);
  };

  const openHistoryEditor = (record?: HistoryRecord) => {
    if (!session) return;
    setEditingRecord(record ?? null);
    setWatchedDate(record?.watched_at ?? getTodayDateString());
    setSelectedFriendIds(
      record?.participants.map((item) => item.friend_id) ?? [],
    );
    setShowHistoryEditor(true);
  };

  const closeHistoryEditor = () => {
    setEditingRecord(null);
    setSelectedFriendIds([]);
    setWatchedDate(getTodayDateString());
    setShowHistoryEditor(false);
  };

  const handleSaveWatchRecord = async () => {
    if (!detailData || detailData.media_type !== "movie") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以紀錄觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (watchlistLoading) return;

    const recordDate = watchedDate || getTodayDateString();
    if (recordDate > getTodayDateString()) {
      setWatchlistNotice("不能紀錄晚於今天的日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    const originalDate = editingRecord?.watched_at ?? null;
    setWatchlistLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    if (!isInWatchlist) {
      const { error } = await supabase.from("watchlist_items").insert({
        user_id: session.user.id,
        project_id: PROJECT_ID,
        media_type: detailData.media_type,
        tmdb_id: detailData.id,
        title: detailData.title,
        year: getWatchlistYear(detailData),
        release_date: detailData.release_date ?? null,
        poster_path: detailData.poster_path,
        is_anime: detailData.is_anime,
        tmdb_cached_at: new Date().toISOString(),
      });

      if (error) {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      setIsInWatchlist(true);
      onWatchlistChange?.(true, detailData);
    }

    const isSameDateEdit =
      editingRecord && recordDate === editingRecord.watched_at;

    if (selectedFriendIds.length > 0) {
      const { data: conflicts, error: conflictError } = await supabase.rpc(
        "get_watch_history_friend_conflicts",
        {
          target_project: PROJECT_ID,
          target_media: detailData.media_type,
          target_tmdb_id: detailData.id,
          target_season: 0,
          target_episode: 0,
          target_watched_at: recordDate,
          target_friend_ids: selectedFriendIds,
        },
      );

      if (conflictError) {
        setWatchlistNotice("同步好友失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      const conflictIds = (conflicts ?? []).map(
        (row: { friend_id: string }) => row.friend_id,
      );
      if (conflictIds.length > 0) {
        const conflictNames = conflictIds.map((id: string) => {
          const fallback =
            friends.find((friend) => friend.friend_id === id)
              ?.friend_nickname ?? null;
          return getFriendName(id, fallback);
        });
        setWatchlistNotice(
          `不能選擇 ${conflictNames.join("、")}，因為好友當天已有紀錄。`,
        );
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }
    }

    if (!isSameDateEdit) {
      const { data: sharedRows, error: sharedError } = await supabase
        .from("watch_history_shares")
        .select("id")
        .eq("target_user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", detailData.media_type)
        .eq("tmdb_id", detailData.id)
        .eq("season_number", 0)
        .eq("episode_number", 0)
        .eq("watched_at", recordDate)
        .limit(1);

      if (sharedError) {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      if ((sharedRows ?? []).length > 0) {
        setWatchlistNotice("當天已有同步的觀看紀錄，無法重複紀錄。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      const { error: historyError } = await supabase
        .from("watch_history")
        .insert({
          user_id: session.user.id,
          project_id: PROJECT_ID,
          media_type: detailData.media_type,
          tmdb_id: detailData.id,
          season_number: 0,
          episode_number: 0,
          watched_at: recordDate,
        });

      if (historyError) {
        const isDuplicate =
          historyError.code === "23505" ||
          historyError.message?.includes("watch_history_exists") ||
          historyError.message?.includes("duplicate key");
        setWatchlistNotice(
          isDuplicate
            ? "當天已有觀看紀錄，無法重複紀錄。"
            : "紀錄失敗，請稍後再試。",
        );
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }
    }

    if (originalDate && originalDate !== recordDate) {
      await supabase
        .from("watch_history")
        .delete()
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", detailData.media_type)
        .eq("tmdb_id", detailData.id)
        .eq("season_number", 0)
        .eq("episode_number", 0)
        .eq("watched_at", originalDate);
    }

    const deleteShareDate = originalDate ?? recordDate;
    const { error: shareDeleteError } = await supabase
      .from("watch_history_shares")
      .delete()
      .eq("owner_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", 0)
      .eq("episode_number", 0)
      .eq("watched_at", deleteShareDate);

    if (shareDeleteError) {
      setWatchlistNotice("同步好友失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    if (selectedFriendIds.length > 0) {
      const { error: syncError } = await supabase.rpc(
        "sync_watch_history_shares",
        {
          target_project: PROJECT_ID,
          target_media: detailData.media_type,
          target_tmdb_id: detailData.id,
          target_season: 0,
          target_episode: 0,
          target_watched_at: recordDate,
          target_friend_ids: selectedFriendIds,
        },
      );

      if (syncError) {
        setWatchlistNotice("同步好友失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      const { error: friendWatchlistError } = await supabase.rpc(
        "sync_watchlist_items_for_friends",
        {
          target_project: PROJECT_ID,
          target_media: detailData.media_type,
          target_tmdb_id: detailData.id,
          target_title: detailData.title,
          target_year: getWatchlistYear(detailData),
          target_release_date: detailData.release_date ?? null,
          target_poster_path: detailData.poster_path,
          target_is_anime: detailData.is_anime,
          target_friend_ids: selectedFriendIds,
        },
      );
      if (friendWatchlistError) {
        setWatchlistNotice("同步好友清單失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }
    }

    setWatchlistNotice("");
    setWatchlistNoticeTone("success");
    onWatchDateChange?.(detailData.id, recordDate);
    closeHistoryEditor();
    fetchHistoryRecords();
    setWatchlistLoading(false);
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

  const confirmDeleteRecord = async (record: HistoryRecord) => {
    if (!detailData || detailData.media_type !== "movie") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以編輯觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (watchlistLoading) return;
    if (record.owner_id !== session.user.id) return;

    setWatchlistLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    const { error } = await supabase
      .from("watch_history")
      .delete()
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", 0)
      .eq("episode_number", 0)
      .eq("watched_at", record.watched_at);

    if (error) {
      setWatchlistNotice("清除失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    await supabase
      .from("watch_history_shares")
      .delete()
      .eq("owner_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", 0)
      .eq("episode_number", 0)
      .eq("watched_at", record.watched_at);

    setWatchlistNotice("");
    setWatchlistNoticeTone("success");
    onWatchDateChange?.(detailData.id, null);
    fetchHistoryRecords();
    setWatchlistLoading(false);
  };

  const openEpisodeEditor = (
    episodeNumber: number,
    record?: HistoryRecord | null,
  ) => {
    if (!session) return;
    if (episodeEditorOpen && episodeEditingNumber === episodeNumber) {
      closeEpisodeEditor();
      return;
    }
    setEpisodeEditingNumber(episodeNumber);
    setEpisodeEditingRecord(record ?? null);
    setEpisodeWatchedDate(record?.watched_at ?? getTodayDateString());
    setEpisodeSelectedFriendIds(
      record?.participants.map((item) => item.friend_id) ?? [],
    );
    setEpisodeEditorOpen(true);
  };

  const closeEpisodeEditor = () => {
    setEpisodeEditingNumber(null);
    setEpisodeEditingRecord(null);
    setEpisodeSelectedFriendIds([]);
    setEpisodeWatchedDate(getTodayDateString());
    setEpisodeEditorOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    if (!episodeEditorOpen) return;
    if (!episodeEditingNumber) return;
    const target = episodeCardRefs.current[episodeEditingNumber];
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open, episodeEditorOpen, episodeEditingNumber]);

  const handleSaveEpisodeRecord = async () => {
    if (!detailData || detailData.media_type !== "tv") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以紀錄觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (episodeSaveLoading) return;
    if (!selectedSeason || episodeEditingNumber === null) return;

    const recordDate = episodeWatchedDate || getTodayDateString();
    const episodeAirDate =
      seasonEpisodes.find(
        (episode) => episode.episode_number === episodeEditingNumber,
      )?.air_date ?? null;
    if (!episodeAirDate || episodeAirDate > getTodayDateString()) {
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
    setEpisodeSaveLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    if (!isInWatchlist) {
      const { error } = await supabase.from("watchlist_items").insert({
        user_id: session.user.id,
        project_id: PROJECT_ID,
        media_type: detailData.media_type,
        tmdb_id: detailData.id,
        title: detailData.title,
        year: getWatchlistYear(detailData),
        release_date: null,
        poster_path: detailData.poster_path,
        is_anime: detailData.is_anime,
        tmdb_cached_at: new Date().toISOString(),
      });

      if (error) {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }

      setIsInWatchlist(true);
      onWatchlistChange?.(true, detailData);
    }

    const isSameDateEdit =
      episodeEditingRecord && recordDate === episodeEditingRecord.watched_at;

    if (episodeSelectedFriendIds.length > 0) {
      const { data: conflicts, error: conflictError } = await supabase.rpc(
        "get_watch_history_friend_conflicts",
        {
          target_project: PROJECT_ID,
          target_media: detailData.media_type,
          target_tmdb_id: detailData.id,
          target_season: selectedSeason,
          target_episode: episodeEditingNumber,
          target_watched_at: recordDate,
          target_friend_ids: episodeSelectedFriendIds,
        },
      );

      if (conflictError) {
        setWatchlistNotice("同步好友失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }

      const conflictIds = (conflicts ?? []).map(
        (row: { friend_id: string }) => row.friend_id,
      );
      if (conflictIds.length > 0) {
        const conflictNames = conflictIds.map((id: string) => {
          const fallback =
            friends.find((friend) => friend.friend_id === id)
              ?.friend_nickname ?? null;
          return getFriendName(id, fallback);
        });
        setWatchlistNotice(
          `不能選擇 ${conflictNames.join("、")}，因為該好友當天已有紀錄。`,
        );
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }
    }

    if (!isSameDateEdit) {
      const { data: sharedRows, error: sharedError } = await supabase
        .from("watch_history_shares")
        .select("id")
        .eq("target_user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", detailData.media_type)
        .eq("tmdb_id", detailData.id)
        .eq("season_number", selectedSeason)
        .eq("episode_number", episodeEditingNumber)
        .eq("watched_at", recordDate)
        .limit(1);

      if (sharedError) {
        setWatchlistNotice("紀錄失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }

      if ((sharedRows ?? []).length > 0) {
        setWatchlistNotice("當天已有同步的觀看紀錄，無法重複紀錄。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }

      const { error: historyError } = await supabase
        .from("watch_history")
        .insert({
          user_id: session.user.id,
          project_id: PROJECT_ID,
          media_type: detailData.media_type,
          tmdb_id: detailData.id,
          season_number: selectedSeason,
          episode_number: episodeEditingNumber,
          watched_at: recordDate,
        });

      if (historyError) {
        setWatchlistNotice(
          historyError.message?.includes("watch_history_exists")
            ? "當天已有觀看紀錄，無法重複紀錄。"
            : "紀錄失敗，請稍後再試。",
        );
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }
    }

    if (originalDate && originalDate !== recordDate) {
      await supabase
        .from("watch_history")
        .delete()
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", detailData.media_type)
        .eq("tmdb_id", detailData.id)
        .eq("season_number", selectedSeason)
        .eq("episode_number", episodeEditingNumber)
        .eq("watched_at", originalDate);
    }

    const deleteShareDate = originalDate ?? recordDate;
    const { error: shareDeleteError } = await supabase
      .from("watch_history_shares")
      .delete()
      .eq("owner_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", selectedSeason)
      .eq("episode_number", episodeEditingNumber)
      .eq("watched_at", deleteShareDate);

    if (shareDeleteError) {
      setWatchlistNotice("同步好友失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setEpisodeSaveLoading(false);
      return;
    }

    if (episodeSelectedFriendIds.length > 0) {
      const { error: syncError } = await supabase.rpc(
        "sync_watch_history_shares",
        {
          target_project: PROJECT_ID,
          target_media: detailData.media_type,
          target_tmdb_id: detailData.id,
          target_season: selectedSeason,
          target_episode: episodeEditingNumber,
          target_watched_at: recordDate,
          target_friend_ids: episodeSelectedFriendIds,
        },
      );

      if (syncError) {
        setWatchlistNotice("同步好友失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }

      const { error: friendWatchlistError } = await supabase.rpc(
        "sync_watchlist_items_for_friends",
        {
          target_project: PROJECT_ID,
          target_media: detailData.media_type,
          target_tmdb_id: detailData.id,
          target_title: detailData.title,
          target_year: getWatchlistYear(detailData),
          target_release_date: null,
          target_poster_path: detailData.poster_path,
          target_is_anime: detailData.is_anime,
          target_friend_ids: episodeSelectedFriendIds,
        },
      );
      if (friendWatchlistError) {
        setWatchlistNotice("同步好友清單失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setEpisodeSaveLoading(false);
        return;
      }
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
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    }
    onEpisodeHistoryChange?.();
    closeEpisodeEditor();
    setEpisodeSaveLoading(false);
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

    setEpisodeSaveLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("success");

    const { error } = await supabase
      .from("watch_history")
      .delete()
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", seasonNumber)
      .eq("episode_number", episodeNumber)
      .eq("watched_at", record.watched_at);

    if (error) {
      setWatchlistNotice("清除失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setEpisodeSaveLoading(false);
      return;
    }

    await supabase
      .from("watch_history_shares")
      .delete()
      .eq("owner_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", seasonNumber)
      .eq("episode_number", episodeNumber)
      .eq("watched_at", record.watched_at);

    setWatchlistNotice("");
    setWatchlistNoticeTone("success");
    setEpisodeHistoryMap((prev) => ({
      ...prev,
      [episodeNumber]: null,
    }));
    if (episodeEditorOpen && episodeEditingNumber === episodeNumber) {
      closeEpisodeEditor();
    }
    onEpisodeHistoryChange?.();
    setEpisodeSaveLoading(false);
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-8"
      onClick={onClose}
    >
      <div
        ref={detailModalRef}
        className={`relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0c] px-6 pb-3 pt-0 shadow-[0_10px_30px_rgba(0,0,0,0.6)] ${
          detailReady || detailLoading ? "opacity-100" : "opacity-0"
        }`}
        style={{
          ...(detailHeight ? { height: `${detailHeight}px` } : {}),
          ...(!detailHeight && (detailTab === "history" || isViewportSmall)
            ? { height: `${detailBaseHeight ?? baseDetailHeight}px` }
            : {}),
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {isViewportSmall && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-[#0b0b0c] text-center text-white/80">
            <div className="max-w-sm px-6">
              <p className="text-base font-semibold text-white">視窗尺寸過小</p>
              <p className="mt-2 text-sm text-white/60">
                請放大瀏覽器視窗以顯示完整內容。
              </p>
              <button
                type="button"
                className="mt-5 rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 hover:border-white/40"
                onClick={onClose}
              >
                關閉
              </button>
            </div>
          </div>
        )}
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 py-3">
            <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => handleToggleWatchlist(event.currentTarget)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${
                    isInWatchlist
                      ? "border-yellow-400/60 text-yellow-300"
                      : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
                  }`}
                  aria-label={isInWatchlist ? "移除清單" : "加入清單"}
                  aria-pressed={isInWatchlist}
                >
                <svg
                  aria-hidden="true"
                  className="h-6 w-6"
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
                  onClick={() => setDetailTab("details")}
                  className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] ${
                    detailTab === "details"
                    ? "border border-white/40 text-white"
                    : "text-white/50 hover:text-white"
                }`}
              >
                詳細資料
              </button>
              <button
                type="button"
                onClick={() => setDetailTab("history")}
                className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] ${
                  detailTab === "history"
                    ? "border border-white/40 text-white"
                    : "text-white/50 hover:text-white"
                  }`}
              >
                觀看紀錄
              </button>
            </div>
            <div className="flex items-center gap-2">
              {episodeProgress && (
                <span className="rounded-full border border-white/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
                  已看 {episodeProgress.watched} / {episodeProgress.total}
                </span>
              )}
              <button
                type="button"
                className="h-8 w-8 rounded-full border border-white/15 text-sm text-white/70 hover:border-white/40"
                onClick={onClose}
                aria-label="Close detail"
              >
                ×
              </button>
            </div>
          </div>
          <div className="mt-3 flex-1 h-full min-h-0 overflow-hidden pr-2">
            {detailLoading && detailTab === "details" && (
              <div className="flex flex-col gap-6 md:flex-row">
                <div className="h-90 w-60 animate-pulse rounded-xl bg-white/5" />
                <div className="flex-1 space-y-3">
                  <div className="h-7 w-1/2 animate-pulse rounded-full bg-white/10" />
                  <div className="h-4 w-1/3 animate-pulse rounded-full bg-white/10" />
                  <div className="h-4 w-2/3 animate-pulse rounded-full bg-white/10" />
                  <div className="h-4 w-full animate-pulse rounded-full bg-white/10" />
                  <div className="h-4 w-5/6 animate-pulse rounded-full bg-white/10" />
                  <div className="h-24 w-full animate-pulse rounded-xl bg-white/5" />
                </div>
              </div>
            )}
            {detailLoading && detailTab === "history" && (
              <div className="flex h-full min-h-0 items-center justify-center">
                <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
              </div>
            )}
            {!detailLoading && detailError && (
              <p className="text-sm text-red-300">{detailError}</p>
            )}
            {!detailLoading && !detailError && detailData && (
              <>
                {detailTab === "details" && (
                  <div className="flex flex-col gap-6 md:flex-row">
                    <div className="relative h-90 w-60 overflow-hidden rounded-xl bg-white/5">
                      {detailData.poster_path ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w342${detailData.poster_path}`}
                          alt={detailData.title}
                          fill
                          sizes="240px"
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="flex h-90 flex-1 flex-col">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h2 className="text-2xl font-semibold">
                          {detailData.title}
                        </h2>
                      </div>
                      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 pr-1 text-sm text-white/70">
                        <p>
                          <span className="text-white/50">類型：</span>
                          {detailData.media_type === "movie"
                            ? "電影"
                            : detailData.is_anime
                              ? "動畫"
                              : "影集"}
                          <span className="text-white/40"> · </span>
                          <span className="text-white/50">年份：</span>
                          {detailData.media_type === "tv" &&
                          detailData.start_year &&
                          detailData.end_year &&
                          detailData.start_year !== detailData.end_year
                            ? `${detailData.start_year} - ${detailData.end_year}`
                            : (detailData.year ?? "未提供")}
                          {detailData.media_type === "tv" &&
                            detailData.seasons && (
                              <span className="text-white/40"> · </span>
                            )}
                          {detailData.media_type === "tv" &&
                            detailData.seasons && (
                              <span className="text-white/50">
                                季數：{detailData.seasons}
                              </span>
                            )}
                          {detailData.media_type === "tv" &&
                            formatTvStatus(detailData.status) && (
                              <span className="ml-2 rounded-full border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
                                {formatTvStatus(detailData.status)}
                              </span>
                            )}
                          {detailData.media_type === "movie" &&
                            detailData.collection_id && (
                              <>
                                <span className="text-white/40"> · </span>
                                <button
                                  type="button"
                                  className="inline-flex max-w-60 items-center rounded-full border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40"
                                  onClick={() =>
                                    setCollectionOpen((prev) => !prev)
                                  }
                                >
                                  <span className="truncate">
                                    {collectionOpen
                                      ? "關閉系列清單"
                                      : "查看系列電影"}
                                  </span>
                                </button>
                              </>
                            )}
                        </p>
                        {collectionOpen ? (
                          <div className="flex flex-col gap-3 text-white/60">
                            {detailData.collection_name && (
                              <p className="text-sm font-semibold text-white">
                                {detailData.collection_name}
                              </p>
                            )}
                            {collectionLoading && (
                              <p className="text-sm text-white/50">
                                載入系列中...
                              </p>
                            )}
                            {!collectionLoading && collectionError && (
                              <p className="text-sm text-red-300">
                                {collectionError}
                              </p>
                            )}
                            {!collectionLoading &&
                              !collectionError &&
                              collectionItems.length === 0 && (
                                <p className="text-sm text-white/50">
                                  尚未取得系列內容。
                                </p>
                              )}
                            {!collectionLoading &&
                              !collectionError &&
                              collectionItems.length > 0 && (
                                <div className="max-h-62 overflow-y-auto pb-2 pr-1">
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {collectionItems.map((item) => {
                                      const isCurrent =
                                        detailData && item.id === detailData.id;
                                      return (
                                        <div
                                          key={item.id}
                                          className={`relative flex items-start gap-3 rounded-xl bg-white/5 p-2 text-left transition ${
                                            isCurrent
                                              ? "border border-white/50"
                                              : "hover:bg-white/10"
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
                                          <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
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
                                              className="text-sm text-white/90"
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
                                              <p className="mt-auto text-xs text-white/50">
                                                {item.year}
                                              </p>
                                            )}
                                          </div>
                                          {!isCurrent && (
                                            <button
                                              type="button"
                                              className={`absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 transition hover:text-white ${
                                                collectionWatchlistMap[item.id]
                                                  ? "text-yellow-300"
                                                  : ""
                                              }`}
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleToggleCollectionWatchlist(
                                                  item,
                                                  event.currentTarget,
                                                );
                                              }}
                                              disabled={
                                                collectionToggleLoading[item.id]
                                              }
                                              aria-label={
                                                collectionWatchlistMap[item.id]
                                                  ? "移除清單"
                                                  : "加入清單"
                                              }
                                              aria-pressed={Boolean(
                                                collectionWatchlistMap[item.id],
                                              )}
                                            >
                                              <svg
                                                aria-hidden="true"
                                                className="h-4 w-4"
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
                        ) : (
                          <>
                            <p>
                              <span className="text-white/50">時長：</span>
                              {detailData.runtime
                                ? detailData.media_type === "tv"
                                  ? `每集約 ${detailData.runtime} 分鐘`
                                  : `${detailData.runtime} 分鐘`
                                : "未提供"}
                              <span className="text-white/40"> · </span>
                              <span className="text-white/50">國家：</span>
                              {detailData.countries.length
                                ? detailData.countries.join(" / ")
                                : "未提供"}
                              <span className="text-white/40"> · </span>
                              <span className="text-white/50">語言：</span>
                              {detailData.languages.length
                                ? detailData.languages.join(" / ")
                                : "未提供"}
                              {detailData.homepage && (
                                <>
                                  <span className="text-white/40"> · </span>
                                  <a
                                    href={detailData.homepage}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm text-sky-300 hover:text-sky-200"
                                  >
                                    官方網站
                                  </a>
                                </>
                              )}
                            </p>
                            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3 text-white/60">
                              <p>{detailData.overview || "未提供簡介。"}</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {detailTab === "history" && (
                  <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
                    {detailData.media_type === "movie" && (
                      <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
                        {!sessionLoading && !session && (
                          <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-10 text-sm text-white/80">
                            請先登入以紀錄觀看日期。
                          </div>
                        )}
                        {!sessionLoading && session && isUnreleasedMovie && (
                          <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-10 text-sm text-white/80">
                            該電影尚未上映，無法紀錄觀看日期。
                          </div>
                        )}
                        {!sessionLoading && session && !isUnreleasedMovie && (
                          <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm text-white/70">
                            {historyRecordsLoading ? (
                              <div className="flex h-full min-h-0 items-center justify-center">
                                <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                              </div>
                            ) : (
                              <>
                                {showHistoryEditor ||
                                historyRecords.length === 0 ? (
                                  <div className="grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] lg:items-start">
                                    <label className="grid gap-3">
                                      <span className="text-sm text-white/60">
                                        選擇日期
                                      </span>
                                      <input
                                        type="date"
                                        id="movie-watch-date"
                                        name="movie-watch-date"
                                        className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-white/80 outline-none focus:border-white/40"
                                        value={watchedDate}
                                        onChange={(event) =>
                                          setWatchedDate(event.target.value)
                                        }
                                      />
                                    </label>
                                    <div className="grid gap-3">
                                      <span className="text-sm text-white/60">
                                        選擇好友
                                      </span>
                                      <div className="max-h-32 overflow-y-auto rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                                        {friendsLoading && (
                                          <p className="text-xs text-white/40">
                                            載入好友中...
                                          </p>
                                        )}
                                        {!friendsLoading &&
                                          friends.length === 0 && (
                                            <p className="text-xs text-white/40">
                                              尚未有好友
                                            </p>
                                          )}
                                        {!friendsLoading &&
                                          friends.length > 0 && (
                                            <div className="grid gap-2 text-xs text-white/80">
                                              {friends.map((friend) => (
                                                <label
                                                  key={friend.friend_id}
                                                  className="flex items-center gap-3"
                                                >
                                                  <input
                                                    type="checkbox"
                                                    className="h-4 w-4 rounded border-white/20 bg-transparent text-white"
                                                    checked={selectedFriendIds.includes(
                                                      friend.friend_id,
                                                    )}
                                                    onChange={(event) => {
                                                      const isChecked =
                                                        event.target.checked;
                                                      setSelectedFriendIds(
                                                        (prev) => {
                                                          if (isChecked) {
                                                            return [
                                                              ...prev,
                                                              friend.friend_id,
                                                            ];
                                                          }
                                                          return prev.filter(
                                                            (id) =>
                                                              id !==
                                                              friend.friend_id,
                                                          );
                                                        },
                                                      );
                                                    }}
                                                  />
                                                  <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/5 text-[10px] font-semibold text-white/80">
                                                    {resolveAvatarUrl(
                                                      friend.friend_id,
                                                    ) ? (
                                                      <Image
                                                        src={
                                                          resolveAvatarUrl(
                                                            friend.friend_id,
                                                          ) as string
                                                        }
                                                        alt=""
                                                        fill
                                                        sizes="28px"
                                                        className="object-cover"
                                                      />
                                                    ) : (
                                                      getFriendInitial(
                                                        friend.friend_id,
                                                        friend.friend_nickname,
                                                      )
                                                    )}
                                                  </span>
                                                  <span>
                                                    {getFriendName(
                                                      friend.friend_id,
                                                      friend.friend_nickname,
                                                    )}
                                                  </span>
                                                </label>
                                              ))}
                                            </div>
                                          )}
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                      <button
                                        type="button"
                                        className="h-fit rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                                        onClick={handleSaveWatchRecord}
                                      >
                                        確認紀錄
                                      </button>
                                      {historyRecords.length > 0 && (
                                        <button
                                          type="button"
                                          className="text-xs text-white/40 hover:text-white"
                                          onClick={closeHistoryEditor}
                                        >
                                          取消
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/80 transition hover:border-white/30"
                                    onClick={() => openHistoryEditor()}
                                  >
                                    <span>新增觀看紀錄</span>
                                    <span className="text-xs text-white/40">
                                      點擊新增
                                    </span>
                                  </button>
                                )}

                                <div className="flex items-center gap-3">
                                  <span className="h-px flex-1 bg-white/10" />
                                  <span className="text-xs text-white/50">
                                    共 {historyRecords.length} 筆紀錄
                                  </span>
                                  <span className="h-px flex-1 bg-white/10" />
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-3">
                                  {historyRecords.length === 0 ? (
                                    <div className="flex h-full min-h-30 items-center justify-center text-xs text-white/50">
                                      尚未建立觀看紀錄。
                                    </div>
                                  ) : (
                                    <div className="grid gap-3">
                                      {historyRecords.map((record) => {
                                        const isOwner =
                                          session?.user.id === record.owner_id;
                                        const participants =
                                          record.participants;
                                        return (
                                          <div
                                            key={`${record.owner_id}-${record.watched_at}`}
                                            className="relative rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                                          >
                                            <div className="flex flex-col gap-3 pr-12">
                                              <div className="flex min-w-0 items-center gap-2 overflow-x-auto text-xs text-white/60">
                                                <span className="shrink-0 text-white/50">
                                                  觀看日期
                                                </span>
                                                <span className="shrink-0 text-sm text-emerald-300">
                                                  {record.watched_at}
                                                </span>
                                                {participants.length > 0 ? (
                                                  <>
                                                    <span className="shrink-0">
                                                      和
                                                    </span>
                                                    <div className="flex items-center gap-2 text-white/80">
                                                      {participants.map(
                                                        (item) => (
                                                          <span
                                                            key={item.friend_id}
                                                            className="flex items-center gap-2 text-white/80"
                                                          >
                                                            <span
                                                              className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-white/5 text-[10px] font-semibold ${
                                                                item.is_owner
                                                                  ? "border-amber-300 text-white border-2"
                                                                  : "border-white/15 text-white"
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
                                                                  ? "text-amber-300"
                                                                  : "text-white"
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
                                                  <span className="shrink-0 text-white/40">
                                                    由好友同步
                                                  </span>
                                                ) : null}
                                              </div>
                                              {isOwner && (
                                                <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
                                                  <button
                                                    type="button"
                                                    className="text-white/60 transition hover:text-white"
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
                                                    className="text-red-300 transition hover:text-red-200"
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
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
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
                          episodeHistorySeason === selectedSeason;
                        const isEpisodeLoading =
                          selectedSeason &&
                          !seasonError &&
                          (seasonLoading ||
                            episodeHistoryLoading ||
                            !episodeSeasonPrefReady ||
                            (seasonEpisodes.length > 0 &&
                              !episodeHistoryReady));

                        return (
                          <>
                            {!sessionLoading && !session && (
                              <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-10 text-sm text-white/80">
                                請先登入以紀錄觀看日期。
                              </div>
                            )}
                            <div
                              className={`flex min-h-0 flex-1 flex-col gap-3 pb-3 text-sm text-white/70 ${
                                !sessionLoading && !session ? "hidden" : ""
                              }`}
                            >
                              {isEpisodeLoading ? (
                                <div className="flex h-full min-h-0 items-center justify-center">
                                  <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                                </div>
                              ) : (
                                <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm text-white/70">
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm text-white/60">
                                      選擇季數
                                    </span>
                                    <select
                                      id="detail-season-select-modal"
                                      name="detail-season-select-modal"
                                      className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-white/80 outline-none focus:border-white/40"
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
                                              第{season.season_number}季 · 共{" "}
                                              {season.episode_count ?? "未知"}{" "}
                                              集
                                            </option>
                                          ),
                                        )
                                      ) : (
                                        <option value="">
                                          尚未取得季數資料
                                        </option>
                                      )}
                                    </select>
                                  </div>
                                  <div className="mt-1 flex min-h-0 flex-1 flex-col">
                                    {showSeasonMessage && (
                                      <p className="text-white/50">
                                        {hasSeasonOptions
                                          ? "尚未選擇季數。"
                                          : "尚未取得季數資料。"}
                                      </p>
                                    )}
                                    {selectedSeason &&
                                      !seasonLoading &&
                                      seasonError && (
                                        <p className="text-red-300">
                                          {seasonError}
                                        </p>
                                      )}
                                    {showEpisodeMessage && (
                                      <p className="text-white/50">
                                        尚未取得集數資料。
                                      </p>
                                    )}
                                    {selectedSeason &&
                                      !seasonError &&
                                      (seasonLoading ||
                                        episodeHistoryLoading ||
                                        !episodeSeasonPrefReady ||
                                        (seasonEpisodes.length > 0 &&
                                          !episodeHistoryReady)) && (
                                        <div className="grid flex-1 min-h-0 gap-3 overflow-y-auto pr-2">
                                          {Array.from(
                                            { length: 6 },
                                            (_, index) => (
                                              <div
                                                key={`episode-skeleton-${index}`}
                                                className="h-16 animate-pulse rounded-lg border border-white/10 bg-white/5"
                                              />
                                            ),
                                          )}
                                        </div>
                                      )}
                                    {selectedSeason &&
                                      !seasonLoading &&
                                      !seasonError &&
                                      !episodeHistoryLoading &&
                                      episodeHistoryReady &&
                                      seasonEpisodes.length > 0 && (
                                        <div className="grid flex-1 min-h-0 gap-3 overflow-y-auto pr-2">
                                          {seasonEpisodes.map((episode) => {
                                            const record =
                                              episodeHistoryMap[
                                                episode.episode_number
                                              ] ?? null;
                                            const episodeAirDate =
                                              episode.air_date ?? null;
                                            const isFutureEpisode =
                                              !episodeAirDate ||
                                              episodeAirDate >
                                                getTodayDateString();
                                            const daysUntilAir =
                                              episodeAirDate && isFutureEpisode
                                                ? getDaysUntil(episodeAirDate)
                                                : null;
                                            const isOwner =
                                              record &&
                                              session?.user.id ===
                                                record.owner_id;
                                            const participants =
                                              record?.participants ?? [];
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
                                                className="relative rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                                              >
                                                <div className="relative flex items-start justify-between gap-3">
                                                  <div className="min-w-0 flex-1 pr-12">
                                                    <p className="text-sm text-white/80">
                                                      S{selectedSeason}E
                                                      {episode.episode_number}
                                                      {episode.name
                                                        ? ` - ${episode.name}`
                                                        : ""}
                                                    </p>
                                                    {record && (
                                                      <div className="mt-2 flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap text-xs text-white/60">
                                                        <span className="text-sm text-emerald-300">
                                                          {record.watched_at}
                                                        </span>
                                                        {participants.length >
                                                        0 ? (
                                                          <>
                                                            <span className="text-white/60">
                                                              和
                                                            </span>
                                                            {participants.map(
                                                              (item) => (
                                                                <span
                                                                  key={
                                                                    item.friend_id
                                                                  }
                                                                  className="flex items-center gap-2 text-white/80"
                                                                >
                                                                  <span
                                                                    className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-white/5 text-[10px] font-semibold ${
                                                                      item.is_owner
                                                                        ? "border-amber-300 text-white border-2"
                                                                        : "border-white/15 text-white"
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
                                                                        ? "text-amber-300"
                                                                        : "text-white"
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
                                                            <span className="text-white/60">
                                                              一起看
                                                            </span>
                                                          </>
                                                        ) : !isOwner ? (
                                                          <span className="text-white/40">
                                                            由好友同步
                                                          </span>
                                                        ) : null}
                                                      </div>
                                                    )}
                                                  </div>
                                                  {isFutureEpisode && (
                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/50">
                                                      {daysUntilAir !== null
                                                        ? `${daysUntilAir}天後播出`
                                                        : "尚未播出"}
                                                    </span>
                                                  )}
                                                  {!isFutureEpisode &&
                                                    (!record || canEdit) && (
                                                      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
                                                        {!record && (
                                                          <button
                                                            type="button"
                                                            className="text-white/60 transition hover:text-white"
                                                            onClick={() =>
                                                              openEpisodeEditor(
                                                                episode.episode_number,
                                                                null,
                                                              )
                                                            }
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
                                                              className="text-white/60 transition hover:text-white"
                                                              onClick={() =>
                                                                openEpisodeEditor(
                                                                  episode.episode_number,
                                                                  record ??
                                                                    null,
                                                                )
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
                                                              className="text-red-300 transition hover:text-red-200"
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
                                                {episodeEditorOpen &&
                                                  selectedSeason !== null &&
                                                  episodeEditingNumber ===
                                                    episode.episode_number && (
                                                    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] lg:items-start">
                                                      <label className="grid gap-3">
                                                        <span className="text-sm text-white/60">
                                                          選擇日期
                                                        </span>
                                                        <input
                                                          type="date"
                                                          id="episode-watch-date"
                                                          name="episode-watch-date"
                                                          className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-white/80 outline-none focus:border-white/40"
                                                          value={
                                                            episodeWatchedDate
                                                          }
                                                          onChange={(event) =>
                                                            setEpisodeWatchedDate(
                                                              event.target
                                                                .value,
                                                            )
                                                          }
                                                        />
                                                      </label>
                                                      <div className="grid gap-3">
                                                        <span className="text-sm text-white/60">
                                                          選擇好友
                                                        </span>
                                                        <div className="max-h-32 overflow-y-auto rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                                                          {friendsLoading && (
                                                            <p className="text-xs text-white/40">
                                                              載入好友中...
                                                            </p>
                                                          )}
                                                          {!friendsLoading &&
                                                            friends.length ===
                                                              0 && (
                                                              <p className="text-xs text-white/40">
                                                                尚未有好友
                                                              </p>
                                                            )}
                                                          {!friendsLoading &&
                                                            friends.length >
                                                              0 && (
                                                              <div className="grid gap-2 text-xs text-white/80">
                                                                {friends.map(
                                                                  (friend) => (
                                                                    <label
                                                                      key={
                                                                        friend.friend_id
                                                                      }
                                                                      className="flex items-center gap-3"
                                                                    >
                                                                      <input
                                                                        type="checkbox"
                                                                        className="h-4 w-4 rounded border-white/20 bg-transparent text-white"
                                                                        checked={episodeSelectedFriendIds.includes(
                                                                          friend.friend_id,
                                                                        )}
                                                                        onChange={(
                                                                          event,
                                                                        ) => {
                                                                          const isChecked =
                                                                            event
                                                                              .target
                                                                              .checked;
                                                                          setEpisodeSelectedFriendIds(
                                                                            (
                                                                              prev,
                                                                            ) => {
                                                                              if (
                                                                                isChecked
                                                                              ) {
                                                                                return [
                                                                                  ...prev,
                                                                                  friend.friend_id,
                                                                                ];
                                                                              }
                                                                              return prev.filter(
                                                                                (
                                                                                  id,
                                                                                ) =>
                                                                                  id !==
                                                                                  friend.friend_id,
                                                                              );
                                                                            },
                                                                          );
                                                                        }}
                                                                      />
                                                                      <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/5 text-[10px] font-semibold text-white/80">
                                                                        {resolveAvatarUrl(
                                                                          friend.friend_id,
                                                                        ) ? (
                                                                          <Image
                                                                            src={
                                                                              resolveAvatarUrl(
                                                                                friend.friend_id,
                                                                              ) as string
                                                                            }
                                                                            alt=""
                                                                            fill
                                                                            sizes="28px"
                                                                            className="object-cover"
                                                                          />
                                                                        ) : (
                                                                          getFriendInitial(
                                                                            friend.friend_id,
                                                                            friend.friend_nickname,
                                                                          )
                                                                        )}
                                                                      </span>
                                                                      <span>
                                                                        {getFriendName(
                                                                          friend.friend_id,
                                                                          friend.friend_nickname,
                                                                        )}
                                                                      </span>
                                                                    </label>
                                                                  ),
                                                                )}
                                                              </div>
                                                            )}
                                                        </div>
                                                      </div>
                                                      <div className="flex flex-col gap-3">
                                                        <button
                                                          type="button"
                                                          className="h-fit rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                                                          onClick={
                                                            handleSaveEpisodeRecord
                                                          }
                                                          disabled={
                                                            episodeSaveLoading
                                                          }
                                                        >
                                                          確認紀錄
                                                        </button>
                                                      </div>
                                                    </div>
                                                  )}
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
      </div>
      {collectionToast && (
        <div
          ref={collectionToastRef}
          className={`fixed z-50 whitespace-nowrap rounded-full border border-white/15 bg-black/80 px-3 py-1.5 text-xs ${
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
                ? "text-red-300"
                : "text-emerald-300"
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
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-white">確認刪除</p>
            <p className="mt-2 text-xs text-white/60">
              刪除後無法復原，請確認以下內容。
            </p>
            <div className="mt-4 grid gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-white/70">
              {deleteConfirmTarget.kind === "episode" ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/50">片名</span>
                    <span className="text-white/80">
                      {detailData?.title ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/50">集數</span>
                    <span className="text-white/80">
                      S{deleteConfirmTarget.season}E
                      {deleteConfirmTarget.episodeNumber}
                      {deleteConfirmTarget.episodeName
                        ? ` - ${deleteConfirmTarget.episodeName}`
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/50">觀看日期</span>
                    <span className="text-white/80">
                      {deleteConfirmTarget.record.watched_at}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/50">同步好友</span>
                    <span className="text-white/80">
                      {formatParticipants(
                        deleteConfirmTarget.record.participants,
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/50">片名</span>
                    <span className="text-white/80">
                      {detailData?.title ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/50">觀看日期</span>
                    <span className="text-white/80">
                      {deleteConfirmTarget.record.watched_at}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/50">同步好友</span>
                    <span className="text-white/80">
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
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40"
                onClick={closeDeleteConfirm}
                disabled={deleteConfirmLoading}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-full border border-red-500/40 bg-[#140606] px-4 py-2 text-xs uppercase tracking-[0.2em] text-red-200 transition hover:border-red-400"
                onClick={handleConfirmDelete}
                disabled={deleteConfirmLoading}
              >
                {deleteConfirmLoading ? "刪除中..." : "刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
