"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import WatchlistCard from "@/components/WatchlistCard";
import DetailModal from "@/components/DetailModal";
import useAuth from "@/hooks/useAuth";
import useProfileNames from "@/hooks/useProfileNames";
import { getDetailCache, setDetailCache } from "@/lib/tmdbDetailCache";

const PROJECT_ID = "watch";

type WatchlistItem = {
  id: string;
  tmdb_id: number;
  title: string;
  year: string | null;
  release_date: string | null;
  tmdb_cached_at: string | null;
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

type UpcomingEpisodeItem = {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  season: number;
  episode: number;
  name: string | null;
  air_date: string;
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
};

export default function WatchlistSection({
  title,
  mediaType,
  isAnime,
  filter = "all",
  onCountChange,
}: WatchlistSectionProps) {
  const { session, loading: sessionLoading } = useAuth();
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
  const [episodeStatusLoading, setEpisodeStatusLoading] = useState(false);
  const [episodeStatusMap, setEpisodeStatusMap] = useState<
    Record<number, string>
  >({});
  const [episodeProgressMap, setEpisodeProgressMap] = useState<
    Record<number, "unwatched" | "watching" | "completed">
  >({});
  const [watchedEpisodeCountMap, setWatchedEpisodeCountMap] = useState<
    Record<number, number>
  >({});
  const [latestWatchedDateMap, setLatestWatchedDateMap] = useState<
    Record<number, string>
  >({});
  const [upcomingEpisodes, setUpcomingEpisodes] = useState<UpcomingEpisodeItem[]>(
    [],
  );
  const [upcomingLoading, setUpcomingLoading] = useState(false);
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
  const [watchHistoryVersion, setWatchHistoryVersion] = useState(0);
  const refreshingRef = useRef<Set<number>>(new Set());
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
  const statusLoading =
    mediaType === "tv"
      ? episodeHistoryLoading || episodeStatusLoading
      : watchHistoryLoading;
  const todayString = new Date().toLocaleDateString("sv-SE");
  const isUpcomingTab = mediaType === "tv" && filter === "upcoming";
  const getDaysUntil = (dateString: string) => {
    const target = new Date(`${dateString}T00:00:00`);
    const today = new Date(`${todayString}T00:00:00`);
    const diffMs = target.getTime() - today.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };
  const filteredItems = useMemo(() => {
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
        return bTime - aTime;
      };
      if (filter === "unwatched") {
        return items.filter(
          (item) => (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "unwatched",
        ).sort(sortByCreatedAtDesc);
      }
      if (filter === "watching") {
        return items.filter(
          (item) => (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "watching",
        ).sort(sortByLatestWatchedDateDesc);
      }
      if (filter === "completed") {
        return items.filter(
          (item) => (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "completed",
        ).sort(sortByLatestWatchedDateDesc);
      }
      if (filter === "all") {
        const watching = items
          .filter(
            (item) =>
              (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "watching",
          )
          .sort(sortByLatestWatchedDateDesc);
        const unwatched = items
          .filter(
            (item) =>
              (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "unwatched",
          )
          .sort(sortByCreatedAtDesc);
        const completed = items
          .filter(
            (item) =>
              (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "completed",
          )
          .sort(sortByLatestWatchedDateDesc);
        return [...watching, ...unwatched, ...completed];
      }
      return items;
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
      return bTime - aTime;
    };

    if (filter === "upcoming") {
      return items
        .filter((item) => isUpcoming(item))
        .sort(sortByReleaseDateAsc);
    }
    if (filter === "watched") {
      return items.filter(isWatched).sort(sortByWatchedDateDesc);
    }
    if (filter === "unwatched") {
      const unwatched = items.filter((item) => !isWatched(item));
      const today = unwatched.filter(isToday).sort(sortByCreatedAtDesc);
      const rest = unwatched
        .filter((item) => !isToday(item) && !isUpcoming(item))
        .sort(sortByCreatedAtDesc);
      return [...today, ...rest];
    }
    if (filter === "all") {
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
      return [...today, ...unwatchedRest, ...upcoming, ...watchedSorted];
    }

    return items;
  }, [
    filter,
    items,
    mediaType,
    todayString,
    watchedDateMap,
    episodeProgressMap,
    latestWatchedDateMap,
  ]);

  const allTabGroups = useMemo<AllTabGroups>(() => {
    if (filter !== "all") return null;
    const sortByCreatedAtDesc = (a: WatchlistItem, b: WatchlistItem) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const sortByLatestWatchedDateDesc = (a: WatchlistItem, b: WatchlistItem) => {
      const aDate = latestWatchedDateMap[a.tmdb_id];
      const bDate = latestWatchedDateMap[b.tmdb_id];
      const aTime = aDate ? new Date(aDate).getTime() : 0;
      const bTime = bDate ? new Date(bDate).getTime() : 0;
      return bTime - aTime;
    };
    if (mediaType === "tv") {
      const watching = items
        .filter(
          (item) =>
            (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "watching",
        )
        .sort(sortByLatestWatchedDateDesc);
      const unwatched = items
        .filter(
          (item) =>
            (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "unwatched",
        )
        .sort(sortByCreatedAtDesc);
      const completed = items
        .filter(
          (item) =>
            (episodeProgressMap[item.tmdb_id] ?? "unwatched") === "completed",
        )
        .sort(sortByLatestWatchedDateDesc);
      return { kind: "tv", watching, unwatched, completed };
    }

    const isWatched = (item: WatchlistItem) =>
      Boolean(watchedDateMap[item.tmdb_id]);
    const isUpcoming = (item: WatchlistItem) =>
      Boolean(item.release_date && item.release_date > todayString);
    const isToday = (item: WatchlistItem) =>
      Boolean(item.release_date && item.release_date === todayString);

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
    const watched = items.filter(isWatched).sort(sortByLatestWatchedDateDesc);
    const unwatchedGroup = [...today, ...unwatched];
    return { kind: "movie", unwatched: unwatchedGroup, upcoming, watched };
  }, [
    episodeProgressMap,
    filter,
    items,
    latestWatchedDateMap,
    mediaType,
    todayString,
    watchedDateMap,
  ]);

  const displayedCount =
    mediaType === "tv" && filter === "upcoming"
      ? upcomingEpisodes.length
      : filteredItems.length;

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
    if (!session) {
      return;
    }

    let query = supabase
      .from("watchlist_items")
      .select(
        "id, tmdb_id, title, year, release_date, tmdb_cached_at, poster_path, media_type, is_anime, created_at",
      )
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", mediaType)
      .order("created_at", { ascending: false });

    if (mediaType === "tv") {
      query = query.eq("is_anime", Boolean(isAnime));
    }

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setLoading(true);
      setError("");
    });

    const loadItems = async () => {
      try {
        const { data, error: queryError } = await query;
        if (!isMounted) return;
        if (queryError) {
          setError("讀取清單失敗，請稍後再試。");
          setItems([]);
          return;
        }
        setItems((data as WatchlistItem[]) ?? []);
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    };

    loadItems();

    return () => {
      isMounted = false;
    };
  }, [session, mediaType, isAnime]);

  useEffect(() => {
    if (!session) return;
    if (items.length === 0) return;

    const staleThreshold = Date.now() - 1000 * 60 * 60 * 24 * 180;
    const staleItems = items.filter((item) => {
      if (!item.tmdb_cached_at) return true;
      return new Date(item.tmdb_cached_at).getTime() < staleThreshold;
    });

    if (staleItems.length === 0) return;

    staleItems.forEach((item) => {
      if (refreshingRef.current.has(item.tmdb_id)) return;
      refreshingRef.current.add(item.tmdb_id);

      fetch(`/api/tmdb/detail?type=${item.media_type}&id=${item.tmdb_id}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("detail failed");
          return response.json();
        })
        .then((detail: DetailData) => {
          const releaseDate =
            detail.media_type === "movie"
              ? (detail.release_date ?? null)
              : null;
          const cachedAt = new Date().toISOString();

          setItems((prev) =>
            prev.map((current) =>
              current.tmdb_id === item.tmdb_id
                ? {
                    ...current,
                    title: detail.title || current.title,
                    year: detail.year ?? current.year,
                    release_date: releaseDate ?? current.release_date,
                    poster_path: detail.poster_path ?? current.poster_path,
                    is_anime: detail.is_anime,
                    tmdb_cached_at: cachedAt,
                  }
                : current,
            ),
          );

          return supabase
            .from("watchlist_items")
            .update({
              title: detail.title,
              year: detail.year,
              release_date: releaseDate,
              poster_path: detail.poster_path,
              is_anime: detail.is_anime,
              tmdb_cached_at: cachedAt,
            })
            .eq("user_id", session.user.id)
            .eq("project_id", PROJECT_ID)
            .eq("media_type", item.media_type)
            .eq("tmdb_id", item.tmdb_id);
        })
        .catch(() => undefined)
        .finally(() => {
          refreshingRef.current.delete(item.tmdb_id);
        });
    });
  }, [items, session]);

  useEffect(() => {
    if (mediaType !== "movie") {
      queueMicrotask(() => {
        setWatchedDateMap({});
        setWatchedCountMap({});
        setWatchedFriendIdsMap({});
        setSharedOwnerIdMap({});
        setFriendFallbackMap({});
        setWatchHistoryLoading(false);
      });
      return;
    }
    if (!session || items.length === 0) {
      queueMicrotask(() => {
        setWatchedDateMap({});
        setWatchedCountMap({});
        setWatchedFriendIdsMap({});
        setSharedOwnerIdMap({});
        setFriendFallbackMap({});
        setWatchHistoryLoading(false);
      });
      return;
    }

    const ids = items.map((item) => item.tmdb_id);
    let isMounted = true;

    const loadWatchHistory = async () => {
      setWatchHistoryLoading(true);
      try {
        const { data, error } = await supabase.rpc(
          "get_watch_history_latest_participants_bulk",
          {
            target_project: PROJECT_ID,
            target_media: "movie",
            target_tmdb_ids: ids,
            target_season: 0,
            target_episode: 0,
          },
        );

        if (!isMounted) return;
        if (error) {
          setWatchedDateMap({});
          setWatchedCountMap({});
          setWatchedFriendIdsMap({});
          setSharedOwnerIdMap({});
          setFriendFallbackMap({});
          return;
        }

        const nextDates: Record<number, string> = {};
        const nextCounts: Record<number, number> = {};
        const nextFriends: Record<
          number,
          Array<{ id: string; isOwner: boolean }>
        > = {};
        const nextSharedOwner: Record<number, string> = {};
        const nextFallbacks: Record<string, string | null> = {};
        const rows = (data ?? []) as Array<{
          tmdb_id: number;
          watched_at: string | null;
          owner_id: string | null;
          watch_count?: number | null;
          friend_id: string | null;
          friend_nickname: string | null;
          is_owner: boolean | null;
        }>;

        rows.forEach((row) => {
          if (row.watched_at && nextDates[row.tmdb_id] === undefined) {
            nextDates[row.tmdb_id] = row.watched_at;
          }
          if (
            typeof row.watch_count === "number" &&
            nextCounts[row.tmdb_id] === undefined
          ) {
            nextCounts[row.tmdb_id] = row.watch_count;
          }
          if (row.owner_id && row.owner_id !== session.user.id) {
            nextSharedOwner[row.tmdb_id] = row.owner_id;
          }
          if (!row.friend_id) return;
          nextFallbacks[row.friend_id] = row.friend_nickname ?? null;
          const current = nextFriends[row.tmdb_id] ?? [];
          if (!current.some((entry) => entry.id === row.friend_id)) {
            nextFriends[row.tmdb_id] = [
              ...current,
              {
                id: row.friend_id,
                isOwner: Boolean(row.is_owner),
              },
            ];
          }
        });

        Object.entries(nextSharedOwner).forEach(([key, ownerId]) => {
          const tmdbId = Number(key);
          const current = nextFriends[tmdbId];
          if (!current || current.length === 0) return;
          const withoutOwner = current.filter((entry) => entry.id !== ownerId);
          nextFriends[tmdbId] = [
            { id: ownerId, isOwner: true },
            ...withoutOwner,
          ];
        });

        setWatchedDateMap(nextDates);
        setWatchedCountMap(nextCounts);
        setWatchedFriendIdsMap(nextFriends);
        setSharedOwnerIdMap(nextSharedOwner);
        setFriendFallbackMap(nextFallbacks);
      } finally {
        if (isMounted) {
          setWatchHistoryLoading(false);
        }
      }
    };

    loadWatchHistory();

    return () => {
      isMounted = false;
    };
  }, [mediaType, items, session, watchHistoryVersion]);

  useEffect(() => {
    if (mediaType !== "tv") {
      setLatestEpisodeMap({});
      setEpisodeStatusMap({});
      setEpisodeProgressMap({});
      setWatchedEpisodeCountMap({});
      setLatestWatchedDateMap({});
      setEpisodeHistoryLoading(false);
      setEpisodeStatusLoading(false);
      return;
    }
    if (!session || items.length === 0) {
      setLatestEpisodeMap({});
      setEpisodeStatusMap({});
      setEpisodeProgressMap({});
      setWatchedEpisodeCountMap({});
      setLatestWatchedDateMap({});
      setEpisodeHistoryLoading(false);
      setEpisodeStatusLoading(false);
      return;
    }

    let isMounted = true;
    const ids = items.map((item) => item.tmdb_id);

    const loadLatestEpisodes = async () => {
      const { data, error } = await supabase.rpc(
        "get_watch_history_latest_episode_bulk",
        {
          target_project: PROJECT_ID,
          target_media: "tv",
          target_tmdb_ids: ids,
        },
      );
      if (!isMounted) return;
      if (error) {
        setLatestEpisodeMap({});
        setEpisodeStatusMap({});
        return;
      }
      const nextMap: Record<number, { season: number; episode: number } | null> =
        {};
      const rows = (data ?? []) as Array<{
        tmdb_id: number;
        season_number: number | null;
        episode_number: number | null;
      }>;
      rows.forEach((row) => {
        if (!row.tmdb_id) return;
        if (row.season_number && row.episode_number) {
          nextMap[row.tmdb_id] = {
            season: row.season_number,
            episode: row.episode_number,
          };
        }
      });
      setLatestEpisodeMap(nextMap);
    };

    const loadWatchedCounts = async () => {
      const { data, error } = await supabase.rpc(
        "get_watch_history_episode_counts_bulk",
        {
          target_project: PROJECT_ID,
          target_media: "tv",
          target_tmdb_ids: ids,
        },
      );
      if (!isMounted) return;
      if (error) {
        setWatchedEpisodeCountMap({});
        return;
      }
      const nextCounts: Record<number, number> = {};
      const rows = (data ?? []) as Array<{
        tmdb_id: number;
        watched_count: number | null;
      }>;
      rows.forEach((row) => {
        if (!row.tmdb_id) return;
        if (typeof row.watched_count === "number") {
          nextCounts[row.tmdb_id] = row.watched_count;
        }
      });
      setWatchedEpisodeCountMap(nextCounts);
    };

    const loadLatestWatchedDates = async () => {
      const { data, error } = await supabase.rpc(
        "get_watch_history_latest_watched_at_bulk",
        {
          target_project: PROJECT_ID,
          target_media: "tv",
          target_tmdb_ids: ids,
        },
      );
      if (!isMounted) return;
      if (error) {
        setLatestWatchedDateMap({});
        return;
      }
      const nextDates: Record<number, string> = {};
      const rows = (data ?? []) as Array<{
        tmdb_id: number;
        watched_at: string | null;
      }>;
      rows.forEach((row) => {
        if (!row.tmdb_id || !row.watched_at) return;
        if (nextDates[row.tmdb_id] === undefined) {
          nextDates[row.tmdb_id] = row.watched_at;
        }
      });
      setLatestWatchedDateMap(nextDates);
    };

    setEpisodeHistoryLoading(true);
    Promise.all([
      loadLatestEpisodes(),
      loadWatchedCounts(),
      loadLatestWatchedDates(),
    ])
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setEpisodeHistoryLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [mediaType, items, session, watchHistoryVersion]);

  useEffect(() => {
    if (mediaType !== "tv") return;
    if (!session || items.length === 0) return;
    if (episodeHistoryLoading) {
      setEpisodeStatusLoading(false);
      return;
    }
    const requestId = ++episodeStatusRequestIdRef.current;

    const fetchDetail = async (tmdbId: number) => {
      const cacheKey = `tv:${tmdbId}`;
      const cached = getDetailCache<DetailData>(cacheKey);
      if (cached) return cached;
      const response = await fetch(
        `/api/tmdb/detail?type=tv&id=${tmdbId}`,
      );
      if (!response.ok) return null;
      const detail = (await response.json()) as DetailData;
      setDetailCache(cacheKey, detail);
      return detail;
    };

    const fetchSeasonEpisodes = async (tmdbId: number, season: number) => {
      const cacheKey = `tv:${tmdbId}:season:${season}`;
      const cached = getDetailCache<EpisodeInfo[]>(cacheKey);
      if (cached) return cached;
      const response = await fetch(
        `/api/tmdb/season?type=tv&id=${tmdbId}&season=${season}`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      const episodes = (data.episodes ?? []) as EpisodeInfo[];
      setDetailCache(cacheKey, episodes);
      return episodes;
    };

    const buildStatus = async () => {
      const nextMap: Record<number, string> = {};
      const nextProgress: Record<number, "unwatched" | "watching" | "completed"> =
        {};
      const today = new Date().toLocaleDateString("sv-SE");

      setEpisodeStatusLoading(true);
      for (const item of items) {
        const latest = latestEpisodeMap[item.tmdb_id];
        const watchedCount = watchedEpisodeCountMap[item.tmdb_id] ?? 0;
        if (!latest || watchedCount === 0) {
          nextMap[item.tmdb_id] = "尚未觀看任何集數";
          nextProgress[item.tmdb_id] = "unwatched";
          continue;
        }

        const detail = await fetchDetail(item.tmdb_id);
        const status = detail?.status?.toLowerCase() ?? "";
        const isEnded = status === "ended" || status === "canceled";
        const seasonsInfo = detail?.seasons_info ?? [];
        let totalAired = 0;

        for (const seasonInfo of seasonsInfo) {
          const seasonNumber = seasonInfo.season_number;
          const episodes = await fetchSeasonEpisodes(
            item.tmdb_id,
            seasonNumber,
          );
          if (!episodes) continue;
          episodes.forEach((episode) => {
            if (episode.air_date && episode.air_date <= today) {
              totalAired += 1;
            }
          });
        }

        if (totalAired > 0 && watchedCount >= totalAired) {
          nextMap[item.tmdb_id] = isEnded
            ? "已看完"
            : "已看完目前已播出集數";
          nextProgress[item.tmdb_id] = "completed";
          continue;
        }
        nextProgress[item.tmdb_id] = "watching";

        let targetSeason = latest.season;
        let targetEpisode = latest.episode + 1;
        const seasonInfo = seasonsInfo.find(
          (season) => season.season_number === latest.season,
        );
        const seasonCount = seasonInfo?.episode_count ?? null;
        if (seasonCount && latest.episode >= seasonCount) {
          const nextSeasonInfo = seasonsInfo.find(
            (season) => season.season_number > latest.season,
          );
          if (!nextSeasonInfo) {
            nextMap[item.tmdb_id] = isEnded
              ? "已看完"
              : "已看完目前已播出集數";
            nextProgress[item.tmdb_id] = "completed";
            continue;
          }
          targetSeason = nextSeasonInfo.season_number;
          targetEpisode = 1;
        }

        const episodes = await fetchSeasonEpisodes(
          item.tmdb_id,
          targetSeason,
        );
        const nextEpisode = episodes?.find(
          (episode) => episode.episode_number === targetEpisode,
        );
        const airDate = nextEpisode?.air_date ?? null;
        if (!airDate || airDate > today) {
          nextMap[item.tmdb_id] = isEnded
            ? "已看完"
            : "已看完目前已播出集數";
          nextProgress[item.tmdb_id] = "completed";
          continue;
        }
        const name = nextEpisode?.name;
        nextMap[item.tmdb_id] = name
          ? `下一集：S${targetSeason}E${targetEpisode} - ${name}`
          : `下一集：S${targetSeason}E${targetEpisode}`;
      }

      if (episodeStatusRequestIdRef.current === requestId) {
        setEpisodeStatusMap(nextMap);
        setEpisodeProgressMap(nextProgress);
        setEpisodeStatusLoading(false);
      }
    };

    buildStatus();
  }, [
    items,
    latestEpisodeMap,
    mediaType,
    episodeHistoryLoading,
    session,
    watchHistoryVersion,
    watchedEpisodeCountMap,
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
    setUpcomingLoading(true);
    const today = todayString;

    const fetchDetail = async (tmdbId: number) => {
      const cacheKey = `tv:${tmdbId}`;
      const cached = getDetailCache<DetailData>(cacheKey);
      if (cached) return cached;
      const response = await fetch(`/api/tmdb/detail?type=tv&id=${tmdbId}`);
      if (!response.ok) return null;
      const detail = (await response.json()) as DetailData;
      setDetailCache(cacheKey, detail);
      return detail;
    };

    const fetchSeasonEpisodes = async (tmdbId: number, season: number) => {
      const cacheKey = `tv:${tmdbId}:season:${season}`;
      const cached = getDetailCache<EpisodeInfo[]>(cacheKey);
      if (cached) return cached;
      const response = await fetch(
        `/api/tmdb/season?type=tv&id=${tmdbId}&season=${season}`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      const episodes = (data.episodes ?? []) as EpisodeInfo[];
      setDetailCache(cacheKey, episodes);
      return episodes;
    };

    const buildUpcoming = async () => {
      const nextList: UpcomingEpisodeItem[] = [];

      for (const item of items) {
        const detail = await fetchDetail(item.tmdb_id);
        const seasonsInfo = detail?.seasons_info ?? [];
        for (const seasonInfo of seasonsInfo) {
          if (!seasonInfo.season_number || seasonInfo.season_number <= 0) {
            continue;
          }
          const episodes = await fetchSeasonEpisodes(
            item.tmdb_id,
            seasonInfo.season_number,
          );
          if (!episodes) continue;
          episodes.forEach((episode) => {
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
      }
    };

    buildUpcoming();
  }, [filter, items, mediaType, session, todayString]);

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

  const handleWatchlistChange = (inWatchlist: boolean, detail: DetailData) => {
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
          release_date:
            detail.media_type === "movie"
              ? (detail.release_date ?? null)
              : null,
          poster_path: detail.poster_path,
          media_type: detail.media_type,
          is_anime: detail.is_anime,
          created_at: new Date().toISOString(),
          tmdb_cached_at: new Date().toISOString(),
        },
        ...prev,
      ];
    });
  };

  const handleWatchDateChange = () => {
    setWatchHistoryVersion((prev) => prev + 1);
  };

  return (
    <>
      <section>
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <span className="text-xs text-white/50">
              {filteredItems.length ? `${filteredItems.length} 筆` : ""}
            </span>
          </div>
        )}
        {sessionLoading && <p className="text-sm text-white/60">載入中...</p>}
        {!sessionLoading && !session && (
          <p className="text-sm text-red-300">請先登入以查看清單。</p>
        )}
        {!sessionLoading && session && loading && (
          <p className="text-sm text-white/60">載入中...</p>
        )}
        {!sessionLoading && session && error && (
          <p className="text-sm text-red-300">{error}</p>
        )}
        {!sessionLoading &&
          session &&
          !loading &&
          !error &&
          items.length === 0 && (
            <p className="text-sm text-white/60">目前尚未加入任何內容。</p>
          )}
        {!sessionLoading &&
          session &&
          !loading &&
          !error &&
          items.length > 0 &&
          (!isUpcomingTab && filteredItems.length === 0) && (
            <p className="text-sm text-white/60">目前沒有符合的內容。</p>
          )}
        {isUpcomingTab &&
          !sessionLoading &&
          session &&
          !loading &&
          !error && (
            <>
              {upcomingLoading && (
                <p className="text-sm text-white/60">載入中...</p>
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
                            watchedFriends={(
                              watchedFriendIdsMap[item.tmdb_id] ?? []
                            ).map((friend) => ({
                              id: friend.id,
                              name: resolveName(friend.id),
                              avatarUrl: resolveAvatarUrl(friend.id),
                              isOwner: friend.isOwner,
                            }))}
                            episodeStatus={
                              episodeStatusMap[item.tmdb_id] ?? null
                            }
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
                            watchedFriends={(
                              watchedFriendIdsMap[item.tmdb_id] ?? []
                            ).map((friend) => ({
                              id: friend.id,
                              name: resolveName(friend.id),
                              avatarUrl: resolveAvatarUrl(friend.id),
                              isOwner: friend.isOwner,
                            }))}
                            episodeStatus={
                              episodeStatusMap[item.tmdb_id] ?? null
                            }
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
                        allTabGroups.completed.length > 0 && (
                          <div className="h-px bg-white/10" />
                        )}
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.completed.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
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
                            watchedFriends={(
                              watchedFriendIdsMap[item.tmdb_id] ?? []
                            ).map((friend) => ({
                              id: friend.id,
                              name: resolveName(friend.id),
                              avatarUrl: resolveAvatarUrl(friend.id),
                              isOwner: friend.isOwner,
                            }))}
                            episodeStatus={
                              episodeStatusMap[item.tmdb_id] ?? null
                            }
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
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {allTabGroups.unwatched.map((item) => (
                          <WatchlistCard
                            key={item.id}
                            title={item.title}
                            posterPath={item.poster_path}
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
                            watchedFriends={(
                              watchedFriendIdsMap[item.tmdb_id] ?? []
                            ).map((friend) => ({
                              id: friend.id,
                              name: resolveName(friend.id),
                              avatarUrl: resolveAvatarUrl(friend.id),
                              isOwner: friend.isOwner,
                            }))}
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
                            watchedFriends={(
                              watchedFriendIdsMap[item.tmdb_id] ?? []
                            ).map((friend) => ({
                              id: friend.id,
                              name: resolveName(friend.id),
                              avatarUrl: resolveAvatarUrl(friend.id),
                              isOwner: friend.isOwner,
                            }))}
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
                            watchedFriends={(
                              watchedFriendIdsMap[item.tmdb_id] ?? []
                            ).map((friend) => ({
                              id: friend.id,
                              name: resolveName(friend.id),
                              avatarUrl: resolveAvatarUrl(friend.id),
                              isOwner: friend.isOwner,
                            }))}
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
                      watchedFriends={(watchedFriendIdsMap[item.tmdb_id] ?? []).map(
                        (friend) => ({
                          id: friend.id,
                          name: resolveName(friend.id),
                          avatarUrl: resolveAvatarUrl(friend.id),
                          isOwner: friend.isOwner,
                        }),
                      )}
                      episodeStatus={
                        mediaType === "tv"
                          ? episodeStatusMap[item.tmdb_id] ?? null
                          : null
                      }
                      statusLoading={statusLoading}
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
            setWatchHistoryVersion((prev) => prev + 1)
          }
        />
      )}
    </>
  );
}
