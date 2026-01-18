"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import WatchlistCard from "@/components/WatchlistCard";
import DetailModal from "@/components/DetailModal";

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
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailTarget, setDetailTarget] = useState<{
    id: number;
    type: "movie" | "tv";
  } | null>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setSessionLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setSessionLoading(false);
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

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

    query
      .then(({ data, error: queryError }) => {
        if (!isMounted) return;
        if (queryError) {
          setError("讀取清單失敗，請稍後再試。");
          setItems([]);
          return;
        }
        setItems((data as WatchlistItem[]) ?? []);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [session, mediaType, isAnime]);

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
                year={item.year}
                posterPath={item.poster_path}
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
        />
      )}
    </>
  );
}
