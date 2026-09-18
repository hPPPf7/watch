"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import HomeCarousel from "@/components/HomeCarousel";
import styles from "./page.module.css";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import MediaCard from "@/components/MediaCard";
import DetailModal from "@/components/DetailModal";
import useAccountFetch from "@/hooks/useAccountFetch";
import { fetchTmdbClient } from "@/lib/fetchTmdbClient";
import useAuth from "@/hooks/useAuth";
import usePageActivityState from "@/hooks/usePageActivityState";
import useHomeWatchStatus from "@/features/home/useHomeWatchStatus";
import { markWatchlistDirty } from "@/lib/watchlistMutationEvents";

type MovieItem = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
};

type MovieList = {
  key: string;
  title: string;
  data: MovieItem[];
};

type TvItem = {
  id: number;
  name: string;
  first_air_date?: string;
  poster_path?: string | null;
};

type TvList = {
  key: string;
  title: string;
  data: TvItem[];
};

type RecommendationCategory = "movie" | "tv" | "anime";

const getRecommendationSectionId = (category: RecommendationCategory, key: string) =>
  `home-recommendations-${category}-${key}`;

const formatUpdatedAt = (value: string, compact = false) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: compact ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(compact ? { hourCycle: "h23" as const } : {}),
  }).format(new Date(value));

function RecommendationHeading({
  category,
  title,
  updatedAt,
  lists,
  loadingMessage,
}: {
  category: RecommendationCategory;
  title: string;
  updatedAt: string | null;
  lists: { key: string; title: string }[];
  loadingMessage: string | null;
}) {
  return (
    <div className={`${styles.textInset} mb-6 flex flex-wrap items-start justify-between gap-3`}>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="shrink-0 text-[23px] font-semibold leading-8 tracking-[0.3px]">{title}</h2>
          {loadingMessage && (
            <span role="status" title={loadingMessage} className="watch-loading min-w-0 text-xs">
              <span className="watch-spinner" aria-hidden="true" />
              <span className="sr-only md:not-sr-only md:truncate">{loadingMessage}</span>
            </span>
          )}
        </div>
        {lists.length > 0 && (
          <nav className="mt-3.5 flex flex-wrap gap-2" aria-label={`跳到${title}區塊`}>
            {lists.map((list) => (
              <a
                key={list.key}
                href={`#${getRecommendationSectionId(category, list.key)}`}
                className="rounded-md border border-watch-border-subtle px-2.5 py-1.5 text-xs text-watch-text-secondary transition-colors hover:bg-watch-hover hover:text-watch-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-watch-focus"
              >
                {list.title}
              </a>
            ))}
          </nav>
        )}
      </div>
      {updatedAt && (
        <time
          dateTime={updatedAt}
          title={`最後更新時間：${formatUpdatedAt(updatedAt)}`}
          className="shrink-0 text-[11px] leading-4 text-watch-text-muted sm:pt-2"
        >
          更新於 {formatUpdatedAt(updatedAt, true)}
        </time>
      )}
    </div>
  );
}

export default function Home() {
  const { session, loading: sessionLoading } = useAuth();
  const fetch = useAccountFetch();
  const [publicRetryToken, setPublicRetryToken] = useState(0);
  const [watchlistRetryToken, setWatchlistRetryToken] = useState(0);
  const [watchlistRequest, setWatchlistRequest] = useState<{
    scope: string;
    loading: boolean;
    error: string;
  } | null>(null);
  const [pendingWatchlist, setPendingWatchlist] = useState<Set<string>>(new Set());
  const pendingWatchlistRef = useRef(new Set<string>());
  const watchlistVersionsRef = useRef(new Map<string, number>());
  const [category, setCategory] = useState<"movie" | "tv" | "anime">("movie");
  const [movieLists, setMovieLists] = useState<MovieList[]>([]);
  const [movieUpdatedAt, setMovieUpdatedAt] = useState<string | null>(null);
  const [movieLoading, setMovieLoading] = useState(false);
  const [movieError, setMovieError] = useState("");
  const [tvLists, setTvLists] = useState<TvList[]>([]);
  const [tvUpdatedAt, setTvUpdatedAt] = useState<string | null>(null);
  const [tvLoading, setTvLoading] = useState(false);
  const [tvError, setTvError] = useState("");
  const [animeLists, setAnimeLists] = useState<TvList[]>([]);
  const [animeUpdatedAt, setAnimeUpdatedAt] = useState<string | null>(null);
  const [animeLoading, setAnimeLoading] = useState(false);
  const [animeError, setAnimeError] = useState("");
  const [detailTarget, setDetailTarget] = useState<{
    id: number;
    type: "movie" | "tv";
  } | null>(null);
  const [watchlistMap, setWatchlistMap] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{
    message: string;
    tone: "error" | "success";
    anchor?: { left: number; top: number } | null;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastAnchorRef = useRef<HTMLElement | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const [toastPosition, setToastPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const homePageInactive = usePageActivityState({
    enabled: Boolean(session) && !sessionLoading,
  });
  const { watchStatusMap, watchStatusError, watchStatusLoading, refreshWatchStatus } = useHomeWatchStatus({
    session,
    sessionLoading,
    movieLists,
    tvLists,
    animeLists,
    enabled: !homePageInactive,
  });

  const visibleLists = category === "movie" ? movieLists : category === "tv" ? tvLists : animeLists;
  const visibleIds = visibleLists.flatMap((list) => list.data.map((item) => item.id));
  const watchlistScope = JSON.stringify([session?.user.id ?? null, category, visibleIds, watchlistRetryToken]);
  const currentWatchlistRequest = watchlistRequest?.scope === watchlistScope ? watchlistRequest : null;
  // New results are awaiting their first check even before the effect starts.
  const watchlistLoading = Boolean(session) && !sessionLoading && visibleIds.length > 0 &&
    (!currentWatchlistRequest || currentWatchlistRequest.loading);
  const watchlistError = currentWatchlistRequest?.error ?? "";

  const handleHomeCategoryChange = (next: "movie" | "tv" | "anime") => {
    setCategory(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("homeCategory", next);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("homeCategory");
    if (stored === "movie" || stored === "tv" || stored === "anime") {
      queueMicrotask(() => {
        setCategory(stored);
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!toast?.anchor || !toastRef.current) {
      setToastPosition(null);
      return;
    }
    const width = toastRef.current.offsetWidth;
    const padding = 12;
    const minLeft = padding + width / 2;
    const maxLeft = window.innerWidth - padding - width / 2;
    const clampedLeft = Math.min(Math.max(toast.anchor.left, minLeft), maxLeft);
    setToastPosition({ left: clampedLeft, top: toast.anchor.top });
  }, [toast?.anchor, toast?.message]);

  const getToastAnchor = (el?: HTMLElement | null) => {
    const fallback =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const target = el ?? toastAnchorRef.current ?? fallback;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    };
  };

  const showToast = (
    message: string,
    tone: "error" | "success",
    anchorEl?: HTMLElement | null
  ) => {
    const anchor = getToastAnchor(anchorEl);
    setToast({ message, tone, anchor });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2000);
  };

  const buildWatchlistKey = (
    type: "movie" | "tv",
    id: number,
    isAnime: boolean
  ) => `${type}:${isAnime ? "anime" : "series"}:${id}`;

  const handleDetailWatchlistChange = (
    inWatchlist: boolean,
    detail: { id: number; media_type: "movie" | "tv"; is_anime: boolean },
    affectedIsAnime?: boolean[],
  ) => {
    const mutationKey = `${detail.media_type}:${detail.id}`;
    watchlistVersionsRef.current.set(mutationKey, (watchlistVersionsRef.current.get(mutationKey) ?? 0) + 1);
    const key = buildWatchlistKey(detail.media_type, detail.id, detail.is_anime);
    setWatchlistMap((previous) => {
      const next = { ...previous, [key]: inWatchlist };
      for (const affected of affectedIsAnime ?? []) {
        next[buildWatchlistKey(detail.media_type, detail.id, affected)] = inWatchlist && (detail.media_type === "movie" || affected === detail.is_anime);
      }
      return next;
    });
    if (session?.user?.id) {
      markWatchlistDirty({
        userId: session.user.id,
        mediaType: detail.media_type,
        isAnime: detail.media_type === "tv" && detail.is_anime,
      }, affectedIsAnime);
    }
  };

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      queueMicrotask(() => {
        setWatchlistMap({});
      });
      return;
    }

    let ids: number[] = [];
    let mediaType: "movie" | "tv" = "movie";
    let isAnimeFilter = false;

    if (category === "movie") {
      ids = movieLists.flatMap((list) => list.data.map((item) => item.id));
      mediaType = "movie";
    } else if (category === "tv") {
      ids = tvLists.flatMap((list) => list.data.map((item) => item.id));
      mediaType = "tv";
      isAnimeFilter = false;
    } else {
      ids = animeLists.flatMap((list) => list.data.map((item) => item.id));
      mediaType = "tv";
      isAnimeFilter = true;
    }

    if (ids.length === 0) return;

    let isMounted = true;
    const versions = new Map(watchlistVersionsRef.current);
    queueMicrotask(() => {
      if (isMounted) setWatchlistRequest({ scope: watchlistScope, loading: true, error: "" });
    });
    fetch("/api/home/watchlist-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaType,
        isAnime: isAnimeFilter,
        ids,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Watchlist unavailable");
        return (await response.json()) as { activeIds?: number[] };
      })
      .then((payload) => {
        if (!isMounted) return;
        if (!Array.isArray(payload.activeIds)) throw new Error("Watchlist invalid");
        const idSet = new Set(payload.activeIds);
        setWatchlistMap((prev) => {
          const next = { ...prev };
          ids.forEach((id) => {
            const mutationKey = `${mediaType}:${id}`;
            if (pendingWatchlistRef.current.has(mutationKey) || versions.get(mutationKey) !== watchlistVersionsRef.current.get(mutationKey)) return;
            next[buildWatchlistKey(mediaType, id, isAnimeFilter)] = idSet.has(id);
          });
          return next;
        });
      }).catch((error) => {
        if (isMounted && error.name !== "AbortError") {
          setWatchlistRequest({ scope: watchlistScope, loading: true, error: "清單狀態讀取失敗，已有資料會先保留。" });
        }
      }).finally(() => {
        if (isMounted) setWatchlistRequest((previous) => ({
          scope: watchlistScope,
          loading: false,
          error: previous?.scope === watchlistScope ? previous.error : "",
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [fetch, watchlistRetryToken, watchlistScope, sessionLoading, session, category, movieLists, tvLists, animeLists]);

  useEffect(() => {
    if (category !== "movie") return;
    if (movieLists.length) return;

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setMovieLoading(true);
      setMovieError("");
    });

    fetchTmdbClient("/api/tmdb/movies/recommendations")
      .then(async (response) => {
        if (!response.ok) throw new Error("fetch failed");
        return response.json();
      })
      .then((data) => {
        if (!isMounted) return;
        setMovieLists(data.lists ?? []);
        setMovieUpdatedAt(data.updated_at ?? null);
      })
      .catch(() => {
        if (!isMounted) return;
        setMovieError("目前無法取得資料，請稍後再試。");
      })
      .finally(() => {
        if (!isMounted) return;
        setMovieLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [category, movieLists.length, publicRetryToken]);

  useEffect(() => {
    if (category !== "tv") return;
    if (tvLists.length) return;

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setTvLoading(true);
      setTvError("");
    });

    fetchTmdbClient("/api/tmdb/tv/recommendations")
      .then(async (response) => {
        if (!response.ok) throw new Error("fetch failed");
        return response.json();
      })
      .then((data) => {
        if (!isMounted) return;
        setTvLists(data.lists ?? []);
        setTvUpdatedAt(data.updated_at ?? null);
      })
      .catch(() => {
        if (!isMounted) return;
        setTvError("目前無法取得資料，請稍後再試。");
      })
      .finally(() => {
        if (!isMounted) return;
        setTvLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [category, tvLists.length, publicRetryToken]);

  useEffect(() => {
    if (category !== "anime") return;
    if (animeLists.length) return;

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setAnimeLoading(true);
      setAnimeError("");
    });

    fetchTmdbClient("/api/tmdb/anime/recommendations")
      .then(async (response) => {
        if (!response.ok) throw new Error("fetch failed");
        return response.json();
      })
      .then((data) => {
        if (!isMounted) return;
        setAnimeLists(data.lists ?? []);
        setAnimeUpdatedAt(data.updated_at ?? null);
      })
      .catch(() => {
        if (!isMounted) return;
        setAnimeError("目前無法取得資料，請稍後再試。");
      })
      .finally(() => {
        if (!isMounted) return;
        setAnimeLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [category, animeLists.length, publicRetryToken]);

  const getYear = (dateValue?: string) =>
    dateValue ? dateValue.slice(0, 4) : "未提供";

  const handleToggleWatchlist = async (
    {
    type,
    id,
    title,
    year,
    releaseDate,
    posterPath,
    isAnime,
  }: {
    type: "movie" | "tv";
    id: number;
    title: string;
    year: string | null;
    releaseDate: string | null;
    posterPath: string | null;
    isAnime: boolean;
  },
    anchorEl?: HTMLButtonElement | null
  ) => {
    if (anchorEl) {
      toastAnchorRef.current = anchorEl;
    }
    if (sessionLoading) return;
    if (!session) {
      showToast("請先登入以加入清單。", "error", anchorEl);
      return;
    }

    const key = buildWatchlistKey(type, id, isAnime);
    const mutationKey = `${type}:${id}`;
    if (pendingWatchlistRef.current.has(mutationKey) || watchlistMap[key] === undefined) return;
    const isActive = watchlistMap[key];
    pendingWatchlistRef.current.add(mutationKey);
    setPendingWatchlist(new Set(pendingWatchlistRef.current));
    watchlistVersionsRef.current.set(mutationKey, (watchlistVersionsRef.current.get(mutationKey) ?? 0) + 1);
    try {
      const response = await fetch("/api/home/watchlist-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isActive ? "remove" : "add",
          item: { type, id, title, year, releaseDate: type === "movie" ? releaseDate : null, posterPath, isAnime },
        }),
      });
      const payload = (await response.json()) as { message?: string; affectedIsAnime?: boolean[] };
      if (!response.ok) {
        showToast(payload.message?.includes("watch_history_exists") ? "已有觀看紀錄，無法移除清單。" : isActive ? "移除失敗，請稍後再試。" : "加入失敗，請稍後再試。", "error", anchorEl);
        return;
      }
      watchlistVersionsRef.current.set(mutationKey, (watchlistVersionsRef.current.get(mutationKey) ?? 0) + 1);
      setWatchlistMap((previous) => {
        const next = { ...previous, [key]: !isActive };
        // Adding can reclassify TV; affected scopes include the old category.
        for (const affected of payload.affectedIsAnime ?? []) {
          next[buildWatchlistKey(type, id, affected)] = !isActive && (type === "movie" || affected === isAnime);
        }
        return next;
      });
      markWatchlistDirty({ userId: session.user.id, mediaType: type, isAnime: type === "tv" && isAnime }, payload.affectedIsAnime);
      showToast(isActive ? "已從清單移除。" : "已加入清單。", "success", anchorEl);
    } catch (error) {
      if ((error as Error).name !== "AbortError") showToast("清單更新失敗，請稍後再試。", "error", anchorEl);
    } finally {
      pendingWatchlistRef.current.delete(mutationKey);
      setPendingWatchlist(new Set(pendingWatchlistRef.current));
    }
  };

  const handleSelectMovie = async (item: MovieItem) => {
    setDetailTarget({ id: item.id, type: "movie" });
  };

  const handleSelectTv = async (item: TvItem) => {
    setDetailTarget({ id: item.id, type: "tv" });
  };

  const hasUnknownWatchlist = Boolean(session) && visibleLists.some((list) => list.data.some((item) =>
    watchlistMap[buildWatchlistKey(category === "movie" ? "movie" : "tv", item.id, category === "anime")] === undefined,
  ));
  const showUnknownWatchlist = hasUnknownWatchlist && currentWatchlistRequest !== null &&
    !currentWatchlistRequest.loading && !sessionLoading && pendingWatchlist.size === 0;
  const recommendationLoading = category === "movie" ? movieLoading : category === "tv" ? tvLoading : animeLoading;
  // Keep the two existing request phases in one visual status slot.
  const loadingMessage = recommendationLoading
    ? "正在載入推薦作品…"
    : session && !watchlistError && !watchStatusError && (watchlistLoading || watchStatusLoading)
      ? "正在確認清單與觀看狀態…"
      : null;

  return (
    <div className="min-h-screen bg-watch-bg text-watch-text">
      <SiteHeader
        homeCategory={category}
        onHomeCategoryChange={handleHomeCategoryChange}
      />
      {toast && (
        <div
          ref={toastRef}
          className={`fixed z-50 whitespace-nowrap rounded-full border border-watch-border bg-watch-popover px-3 py-1.5 text-xs ${
            toast.anchor
              ? "-translate-x-1/2 -translate-y-full"
              : "right-6 top-24"
          }`}
          style={
            toast.anchor
              ? {
                  left: toastPosition?.left ?? toast.anchor.left,
                  top: toastPosition?.top ?? toast.anchor.top,
                }
              : undefined
          }
        >
          <span
            className={
              toast.tone === "error" ? "text-watch-error" : "text-watch-complete"
            }
          >
            {toast.message}
          </span>
        </div>
      )}

      <main className="home-main min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto h-full w-full pt-2">
          <div id="search-results-slot" className="mb-6" />
          <div className={`page-content ${styles.content}`}>
            {session && (watchlistError || watchStatusError || showUnknownWatchlist) && (
              <div role="alert" className={`${styles.textInset} mb-4 flex items-center gap-3 text-sm ${watchlistError || watchStatusError ? "text-watch-error" : "text-watch-warning"}`}>
                <span>{watchlistError || watchStatusError || "清單狀態待確認，請重試。"}</span>
                <button type="button" className="watch-button" disabled={watchlistLoading || watchStatusLoading} onClick={() => { setWatchlistRetryToken((value) => value + 1); void refreshWatchStatus(); }}>重試</button>
              </div>
            )}
            {category === "movie" && (
              <div>
                <RecommendationHeading
                  category="movie"
                  title="電影推薦"
                  updatedAt={movieUpdatedAt}
                  lists={!movieLoading && !movieError ? movieLists : []}
                  loadingMessage={loadingMessage}
                />

                {!movieLoading && movieError && (
                  <div role="alert" className={`${styles.textInset} flex items-center gap-3 text-sm text-watch-error`}><span>{movieError}</span><button type="button" className="watch-button" disabled={movieLoading} onClick={() => setPublicRetryToken((value) => value + 1)}>重試</button></div>
                )}

                {!movieLoading && !movieError && (
                  <div className="grid min-w-0 grid-cols-1 gap-10">
                    {movieLists.length === 0 ? (
                      <p className={`${styles.textInset} text-sm text-watch-text-muted`}>目前沒有資料。</p>
                    ) : (
                      movieLists.map((list, listIndex) => {
                        return (
                          <section key={list.key} id={getRecommendationSectionId("movie", list.key)} tabIndex={-1} className="min-w-0 scroll-mt-32">
                            <div className={`${styles.textInset} mb-4 flex items-center gap-3`}>
                              <h3 className="text-base font-semibold">
                                {list.title}
                              </h3>
                              <span className="text-xs text-watch-text-muted">
                                {list.data.length} 筆
                              </span>
                            </div>
                            <HomeCarousel
                              label={list.title}
                              itemCount={list.data.length}
                              resetKey={list.data.map((item) => item.id).join(",")}
                              renderItem={(index, copy) => {
                                const item = list.data[index];
                                return (
                                  <MediaCard
                                    presentation="home"
                                    title={item.title}
                                    subtitle={getYear(item.release_date)}
                                    posterPath={item.poster_path ?? null}
                                    priority={
                                      copy === 0 && category === "movie" && listIndex < 2 && index < 6
                                    }
                                    onClick={() => handleSelectMovie(item)}
                                    showWatchlistToggle
                                    watchlistPending={pendingWatchlist.has(`movie:${item.id}`)}
                                    watchlistUnknown={sessionLoading || (Boolean(session) && watchlistMap[buildWatchlistKey("movie", item.id, false)] === undefined)}
                                    watchlistActive={
                                      watchlistMap[
                                        buildWatchlistKey("movie", item.id, false)
                                      ]
                                    }
                                    statusBadge={
                                      watchStatusMap[
                                        buildWatchlistKey("movie", item.id, false)
                                      ] === "completed"
                                        ? { label: "已看完", tone: "green" }
                                        : null
                                    }
                                    onToggleWatchlist={(anchorEl) =>
                                      handleToggleWatchlist(
                                        {
                                          type: "movie",
                                          id: item.id,
                                          title: item.title,
                                          year: getYear(item.release_date),
                                          releaseDate: item.release_date ?? null,
                                          posterPath: item.poster_path ?? null,
                                          isAnime: false,
                                        },
                                        anchorEl
                                      )
                                    }
                                  />
                                );
                              }}
                            />
                          </section>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {category === "tv" && (
              <div>
                <RecommendationHeading
                  category="tv"
                  title="影集推薦"
                  updatedAt={tvUpdatedAt}
                  lists={!tvLoading && !tvError ? tvLists : []}
                  loadingMessage={loadingMessage}
                />

                {!tvLoading && tvError && (
                  <div role="alert" className={`${styles.textInset} flex items-center gap-3 text-sm text-watch-error`}><span>{tvError}</span><button type="button" className="watch-button" disabled={tvLoading} onClick={() => setPublicRetryToken((value) => value + 1)}>重試</button></div>
                )}

                {!tvLoading && !tvError && (
                  <div className="grid min-w-0 grid-cols-1 gap-10">
                    {tvLists.length === 0 ? (
                      <p className={`${styles.textInset} text-sm text-watch-text-muted`}>目前沒有資料。</p>
                    ) : (
                      tvLists.map((list, listIndex) => {
                        return (
                          <section key={list.key} id={getRecommendationSectionId("tv", list.key)} tabIndex={-1} className="min-w-0 scroll-mt-32">
                            <div className={`${styles.textInset} mb-4 flex items-center gap-3`}>
                              <h3 className="text-base font-semibold">
                                {list.title}
                              </h3>
                              <span className="text-xs text-watch-text-muted">
                                {list.data.length} 筆
                              </span>
                            </div>
                            <HomeCarousel
                              label={list.title}
                              itemCount={list.data.length}
                              resetKey={list.data.map((item) => item.id).join(",")}
                              renderItem={(index, copy) => {
                                const item = list.data[index];
                                return (
                                  <MediaCard
                                    presentation="home"
                                    title={item.name}
                                    subtitle={getYear(item.first_air_date)}
                                    posterPath={item.poster_path ?? null}
                                    priority={
                                      copy === 0 && category === "tv" && listIndex < 2 && index < 6
                                    }
                                    onClick={() => handleSelectTv(item)}
                                    showWatchlistToggle
                                    watchlistPending={pendingWatchlist.has(`tv:${item.id}`)}
                                    watchlistUnknown={sessionLoading || (Boolean(session) && watchlistMap[buildWatchlistKey("tv", item.id, false)] === undefined)}
                                    watchlistActive={
                                      watchlistMap[
                                        buildWatchlistKey("tv", item.id, false)
                                      ]
                                    }
                                    statusBadge={(() => {
                                      const status =
                                        watchStatusMap[
                                            buildWatchlistKey("tv", item.id, false)
                                        ];
                                      if (!status) return null;
                                      return status === "completed"
                                        ? { label: "已看完", tone: "green" }
                                        : { label: "未看完", tone: "blue" };
                                    })()}
                                    onToggleWatchlist={(anchorEl) =>
                                      handleToggleWatchlist(
                                        {
                                          type: "tv",
                                          id: item.id,
                                          title: item.name,
                                          year: getYear(item.first_air_date),
                                          releaseDate: null,
                                          posterPath: item.poster_path ?? null,
                                          isAnime: false,
                                        },
                                        anchorEl
                                      )
                                    }
                                  />
                                );
                              }}
                            />
                          </section>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {category === "anime" && (
              <div>
                <RecommendationHeading
                  category="anime"
                  title="動畫推薦"
                  updatedAt={animeUpdatedAt}
                  lists={!animeLoading && !animeError ? animeLists : []}
                  loadingMessage={loadingMessage}
                />

                {!animeLoading && animeError && (
                  <div role="alert" className={`${styles.textInset} flex items-center gap-3 text-sm text-watch-error`}><span>{animeError}</span><button type="button" className="watch-button" disabled={animeLoading} onClick={() => setPublicRetryToken((value) => value + 1)}>重試</button></div>
                )}

                {!animeLoading && !animeError && (
                  <div className="grid min-w-0 grid-cols-1 gap-10">
                    {animeLists.length === 0 ? (
                      <p className={`${styles.textInset} text-sm text-watch-text-muted`}>目前沒有資料。</p>
                    ) : (
                      animeLists.map((list, listIndex) => {
                        return (
                          <section key={list.key} id={getRecommendationSectionId("anime", list.key)} tabIndex={-1} className="min-w-0 scroll-mt-32">
                            <div className={`${styles.textInset} mb-4 flex items-center gap-3`}>
                              <h3 className="text-base font-semibold">
                                {list.title}
                              </h3>
                              <span className="text-xs text-watch-text-muted">
                                {list.data.length} 筆
                              </span>
                            </div>
                            <HomeCarousel
                              label={list.title}
                              itemCount={list.data.length}
                              resetKey={list.data.map((item) => item.id).join(",")}
                              renderItem={(index, copy) => {
                                const item = list.data[index];
                                return (
                                  <MediaCard
                                    presentation="home"
                                    title={item.name}
                                    subtitle={getYear(item.first_air_date)}
                                    posterPath={item.poster_path ?? null}
                                    priority={
                                      copy === 0 && category === "anime" && listIndex < 2 && index < 6
                                    }
                                    onClick={() => handleSelectTv(item)}
                                    showWatchlistToggle
                                    watchlistPending={pendingWatchlist.has(`tv:${item.id}`)}
                                    watchlistUnknown={sessionLoading || (Boolean(session) && watchlistMap[buildWatchlistKey("tv", item.id, true)] === undefined)}
                                    watchlistActive={
                                      watchlistMap[
                                        buildWatchlistKey("tv", item.id, true)
                                      ]
                                    }
                                    statusBadge={(() => {
                                      const status =
                                        watchStatusMap[
                                          buildWatchlistKey("tv", item.id, true)
                                        ];
                                      if (!status) return null;
                                      return status === "completed"
                                        ? { label: "已看完", tone: "green" }
                                        : { label: "未看完", tone: "blue" };
                                    })()}
                                    onToggleWatchlist={(anchorEl) =>
                                      handleToggleWatchlist(
                                        {
                                          type: "tv",
                                          id: item.id,
                                          title: item.name,
                                          year: getYear(item.first_air_date),
                                          releaseDate: null,
                                          posterPath: item.poster_path ?? null,
                                          isAnime: true,
                                        },
                                        anchorEl
                                      )
                                    }
                                  />
                                );
                              }}
                            />
                          </section>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {detailTarget && (
        <DetailModal
          open
          onClose={() => setDetailTarget(null)}
          mediaType={detailTarget.type}
          tmdbId={detailTarget.id}
          defaultTab="details"
          onWatchlistChange={handleDetailWatchlistChange}
          onWatchDateChange={() => {
            refreshWatchStatus().catch(() => undefined);
          }}
          onEpisodeHistoryChange={() => {
            refreshWatchStatus().catch(() => undefined);
          }}
        />
      )}

      <SiteFooter />
    </div>
  );
}

