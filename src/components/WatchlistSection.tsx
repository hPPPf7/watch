"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [watchedFriendIdsMap, setWatchedFriendIdsMap] = useState<
    Record<number, string[]>
  >({});
  const [sharedOwnerIdMap, setSharedOwnerIdMap] = useState<
    Record<number, string>
  >({});
  const [friendFallbackMap, setFriendFallbackMap] = useState<
    Record<string, string | null>
  >({});
  const [watchHistoryVersion, setWatchHistoryVersion] = useState(0);
  const profileNameIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(watchedFriendIdsMap).forEach((list) => {
      list.forEach((id) => ids.add(id));
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
        "id, tmdb_id, title, year, poster_path, media_type, is_anime, created_at"
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
    if (mediaType !== "movie") {
      queueMicrotask(() => {
        setWatchedDateMap({});
        setWatchedFriendIdsMap({});
        setSharedOwnerIdMap({});
        setFriendFallbackMap({});
      });
      return;
    }
    if (!session || items.length === 0) {
      queueMicrotask(() => {
        setWatchedDateMap({});
        setWatchedFriendIdsMap({});
        setSharedOwnerIdMap({});
        setFriendFallbackMap({});
      });
      return;
    }

    const ids = items.map((item) => item.tmdb_id);
    let isMounted = true;

    const loadWatchHistory = async () => {
      const [ownResult, shareResult, participantsResult] =
        await Promise.all([
          supabase
            .from("watch_history")
            .select("tmdb_id, watched_at")
            .eq("user_id", session.user.id)
            .eq("project_id", PROJECT_ID)
            .eq("media_type", "movie")
            .in("tmdb_id", ids)
            .eq("season_number", 0)
            .eq("episode_number", 0),
          supabase
            .from("watch_history_shares")
            .select("tmdb_id, watched_at, created_at, owner_id")
            .eq("target_user_id", session.user.id)
            .eq("project_id", PROJECT_ID)
            .eq("media_type", "movie")
            .in("tmdb_id", ids)
            .eq("season_number", 0)
            .eq("episode_number", 0)
            .order("created_at", { ascending: false }),
          supabase.rpc("get_watch_history_participants_bulk", {
            target_project: PROJECT_ID,
            target_media: "movie",
            target_tmdb_ids: ids,
            target_season: 0,
            target_episode: 0,
          }),
        ]);

      if (!isMounted) return;

      const next: Record<number, string> = {};
      (ownResult.data ?? []).forEach((entry) => {
        next[entry.tmdb_id] = entry.watched_at;
      });
      (shareResult.data ?? []).forEach((entry) => {
        if (!next[entry.tmdb_id]) {
          next[entry.tmdb_id] = entry.watched_at;
        }
      });
      setWatchedDateMap(next);

      const nextFriends: Record<number, string[]> = {};
      const nextSharedOwner: Record<number, string> = {};
      const nextFallbacks: Record<string, string | null> = {};
      const participants = (participantsResult.data ?? []) as Array<{
        tmdb_id: number;
        friend_id: string;
        friend_nickname: string | null;
        is_owner: boolean;
      }>;
      participants.forEach((entry) => {
        nextFallbacks[entry.friend_id] = entry.friend_nickname ?? null;
        const current = nextFriends[entry.tmdb_id] ?? [];
        if (!current.includes(entry.friend_id)) {
          nextFriends[entry.tmdb_id] = [...current, entry.friend_id];
        }
        if (entry.is_owner) {
          nextSharedOwner[entry.tmdb_id] = entry.friend_id;
        }
      });
      Object.entries(nextSharedOwner).forEach(([key, ownerId]) => {
        const tmdbId = Number(key);
        const current = nextFriends[tmdbId];
        if (!current || current.length === 0) return;
        const withoutOwner = current.filter((id) => id !== ownerId);
        nextFriends[tmdbId] = [ownerId, ...withoutOwner];
      });

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
          poster_path: detail.poster_path,
          media_type: detail.media_type,
          is_anime: detail.is_anime,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ];
    });
  };

  const handleWatchDateChange = (tmdbId: number, watchedDate: string | null) => {
    if (watchedDate) {
      setWatchedDateMap((prev) => ({ ...prev, [tmdbId]: watchedDate }));
    } else {
      setWatchedDateMap((prev) => {
        const next = { ...prev };
        delete next[tmdbId];
        return next;
      });
    }
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
          <p className="text-sm text-white/60">請先登入以查看清單。</p>
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
          <div className="grid gap-3">
            {items.map((item) => (
              <WatchlistCard
                key={item.id}
                title={item.title}
                posterPath={item.poster_path}
                watchedDate={watchedDateMap[item.tmdb_id] ?? null}
                watchedFriends={(watchedFriendIdsMap[item.tmdb_id] ?? []).map(
                  (friendId) => ({
                    id: friendId,
                    name: resolveName(friendId),
                    avatarUrl: resolveAvatarUrl(friendId),
                    isOwner: sharedOwnerIdMap[item.tmdb_id] === friendId,
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
