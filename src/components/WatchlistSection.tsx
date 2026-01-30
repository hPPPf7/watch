"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import WatchlistCard from "@/components/WatchlistCard";
import DetailModal from "@/components/DetailModal";
import useAuth from "@/hooks/useAuth";
import useProfileNames from "@/hooks/useProfileNames";

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
};

type WatchlistSectionProps = {
  title: string;
  mediaType: "movie" | "tv";
  isAnime?: boolean;
};

export default function WatchlistSection({
  title,
  mediaType,
  isAnime,
}: WatchlistSectionProps) {
  const { session, loading: sessionLoading } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailTarget, setDetailTarget] = useState<{
    id: number;
    type: "movie" | "tv";
  } | null>(null);
  const [watchedDateMap, setWatchedDateMap] = useState<
    Record<number, string>
  >({});
  const [watchedCountMap, setWatchedCountMap] = useState<
    Record<number, number>
  >({});
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
  const resolveAvatarUrl = (id: string) =>
    profileNames[id]?.avatarUrl || null;

  useEffect(() => {
    if (!session) {
      return;
    }

    let query = supabase
      .from("watchlist_items")
      .select(
        "id, tmdb_id, title, year, release_date, tmdb_cached_at, poster_path, media_type, is_anime, created_at"
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
            detail.media_type === "movie" ? detail.release_date ?? null : null;
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
                : current
            )
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
      });
      return;
    }

    const ids = items.map((item) => item.tmdb_id);
    let isMounted = true;

    const loadWatchHistory = async () => {
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
    };

    loadWatchHistory();

    return () => {
      isMounted = false;
    };
  }, [mediaType, items, session, watchHistoryVersion]);

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
    if (detail.media_type === "tv" && Boolean(detail.is_anime) !== Boolean(isAnime)) {
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
            detail.media_type === "movie" ? detail.release_date ?? null : null,
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-xs text-white/50">
            {items.length ? `${items.length} 筆` : ""}
          </span>
        </div>
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
        {!sessionLoading && session && !loading && !error && items.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <WatchlistCard
                key={item.id}
                title={item.title}
                posterPath={item.poster_path}
                releaseDate={item.media_type === "movie" ? item.release_date : null}
                watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                watchedCount={watchedCountMap[item.tmdb_id] ?? null}
                watchedFriends={(watchedFriendIdsMap[item.tmdb_id] ?? []).map(
                  (friend) => ({
                    id: friend.id,
                    name: resolveName(friend.id),
                    avatarUrl: resolveAvatarUrl(friend.id),
                    isOwner: friend.isOwner,
                  })
                )}
                onClick={() =>
                  setDetailTarget({ id: item.tmdb_id, type: item.media_type })
                }
              />
            ))}
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
        />
      )}
    </>
  );
}
