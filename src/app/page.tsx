"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import type { Swiper as SwiperType } from "swiper/types";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import MediaCard from "@/components/MediaCard";
import DetailModal from "@/components/DetailModal";
import useAuth from "@/hooks/useAuth";
import usePageActivityState from "@/hooks/usePageActivityState";
import useHomeWatchStatus from "@/features/home/useHomeWatchStatus";

const DEFAULT_CAROUSEL_STATE = { offset: 32, mask: true };
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


export default function Home() {
  const { session, loading: sessionLoading } = useAuth();
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
  const [movieCarouselState, setMovieCarouselState] = useState<
    Record<string, { offset: number; mask: boolean }>
  >({});
  const [tvCarouselState, setTvCarouselState] = useState<
    Record<string, { offset: number; mask: boolean }>
  >({});
  const [animeCarouselState, setAnimeCarouselState] = useState<
    Record<string, { offset: number; mask: boolean }>
  >({});
  const movieSwiperRefs = useRef<Record<string, SwiperType | null>>({});
  const tvSwiperRefs = useRef<Record<string, SwiperType | null>>({});
  const animeSwiperRefs = useRef<Record<string, SwiperType | null>>({});
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
  const baseGap = 8;
  const homePageInactive = usePageActivityState({
    enabled: Boolean(session) && !sessionLoading,
  });
  const { watchStatusMap, refreshWatchStatus } = useHomeWatchStatus({
    session,
    sessionLoading,
    movieLists,
    tvLists,
    animeLists,
    enabled: !homePageInactive,
  });

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    detail: { id: number; media_type: "movie" | "tv"; is_anime: boolean }
  ) => {
    const key = buildWatchlistKey(detail.media_type, detail.id, detail.is_anime);
    setWatchlistMap((prev) => ({ ...prev, [key]: inWatchlist }));
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
        if (!response.ok) return { activeIds: [] as number[] };
        return (await response.json()) as { activeIds?: number[] };
      })
      .then((payload) => {
        if (!isMounted) return;
        const idSet = new Set(payload.activeIds ?? []);
        setWatchlistMap((prev) => {
          const next = { ...prev };
          ids.forEach((id) => {
            next[buildWatchlistKey(mediaType, id, isAnimeFilter)] = idSet.has(id);
          });
          return next;
        });
      });

    return () => {
      isMounted = false;
    };
  }, [sessionLoading, session, category, movieLists, tvLists, animeLists]);

  useEffect(() => {
    if (category !== "movie") return;
    if (movieLists.length) return;

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setMovieLoading(true);
      setMovieError("");
    });

    fetch("/api/tmdb/movies/recommendations")
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
  }, [category, movieLists.length]);

  useEffect(() => {
    if (category !== "tv") return;
    if (tvLists.length) return;

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setTvLoading(true);
      setTvError("");
    });

    fetch("/api/tmdb/tv/recommendations")
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
  }, [category, tvLists.length]);

  useEffect(() => {
    if (category !== "anime") return;
    if (animeLists.length) return;

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setAnimeLoading(true);
      setAnimeError("");
    });

    fetch("/api/tmdb/anime/recommendations")
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
  }, [category, animeLists.length]);

  useEffect(() => {
    const resetMovie = () => {
      if (!movieLists.length) return;
      const keys = new Set(movieLists.map((list) => list.key));
      Object.keys(movieSwiperRefs.current).forEach((key) => {
        if (!keys.has(key)) {
          delete movieSwiperRefs.current[key];
        }
      });
      setMovieCarouselState(
        Object.fromEntries(
          movieLists.map((list) => [list.key, DEFAULT_CAROUSEL_STATE])
        )
      );
      Object.values(movieSwiperRefs.current).forEach((swiper) => {
        swiper?.slideToLoop?.(0, 0);
        swiper?.slideTo?.(0, 0);
      });
    };

    const resetTv = () => {
      if (!tvLists.length) return;
      const keys = new Set(tvLists.map((list) => list.key));
      Object.keys(tvSwiperRefs.current).forEach((key) => {
        if (!keys.has(key)) {
          delete tvSwiperRefs.current[key];
        }
      });
      setTvCarouselState(
        Object.fromEntries(
          tvLists.map((list) => [list.key, DEFAULT_CAROUSEL_STATE])
        )
      );
      Object.values(tvSwiperRefs.current).forEach((swiper) => {
        swiper?.slideToLoop?.(0, 0);
        swiper?.slideTo?.(0, 0);
      });
    };

    const resetAnime = () => {
      if (!animeLists.length) return;
      const keys = new Set(animeLists.map((list) => list.key));
      Object.keys(animeSwiperRefs.current).forEach((key) => {
        if (!keys.has(key)) {
          delete animeSwiperRefs.current[key];
        }
      });
      setAnimeCarouselState(
        Object.fromEntries(
          animeLists.map((list) => [list.key, DEFAULT_CAROUSEL_STATE])
        )
      );
      Object.values(animeSwiperRefs.current).forEach((swiper) => {
        swiper?.slideToLoop?.(0, 0);
        swiper?.slideTo?.(0, 0);
      });
    };

    if (category === "movie") {
      resetMovie();
    } else if (category === "tv") {
      resetTv();
    } else if (category === "anime") {
      resetAnime();
    }
  }, [category, movieLists, tvLists, animeLists]);

  const formatUpdatedAt = (value: string | null) => {
    if (!value) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  };

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
    const isActive = watchlistMap[key];

    if (isActive) {
      const response = await fetch("/api/home/watchlist-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          item: {
            type,
            id,
            title,
            year,
            releaseDate,
            posterPath,
            isAnime,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      const error = response.ok
        ? null
        : { message: payload?.message ?? "remove failed" };

      if (error) {
        showToast(
          error.message?.includes("watch_history_exists")
            ? "已有觀看紀錄，無法移除清單。"
            : "移除失敗，請稍後再試。",
          "error",
          anchorEl
        );
        return;
      }

      setWatchlistMap((prev) => ({ ...prev, [key]: false }));
      showToast("已從清單移除。", "success", anchorEl);
      return;
    }

    const response = await fetch("/api/home/watchlist-toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        item: {
          type,
          id,
          title,
          year,
          releaseDate: type === "movie" ? releaseDate : null,
          posterPath,
          isAnime,
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    const error = response.ok ? null : { message: payload?.message ?? "add failed" };

    if (error) {
      showToast("加入失敗，請稍後再試。", "error", anchorEl);
      return;
    }

    setWatchlistMap((prev) => ({ ...prev, [key]: true }));
    showToast("已加入清單。", "success", anchorEl);
  };

  const handleSelectMovie = async (item: MovieItem) => {
    setDetailTarget({ id: item.id, type: "movie" });
  };

  const handleSelectTv = async (item: TvItem) => {
    setDetailTarget({ id: item.id, type: "tv" });
  };

  const clearMovieInitialOffset = (listKey: string) => {
    setMovieCarouselState((prev) => {
      const current = prev[listKey] ?? { offset: 32, mask: true };
      if (current.offset === 0 && !current.mask) return prev;
      return {
        ...prev,
        [listKey]: { offset: 0, mask: false },
      };
    });
  };

  const clearTvInitialOffset = (listKey: string) => {
    setTvCarouselState((prev) => {
      const current = prev[listKey] ?? { offset: 32, mask: true };
      if (current.offset === 0 && !current.mask) return prev;
      return {
        ...prev,
        [listKey]: { offset: 0, mask: false },
      };
    });
  };

  const clearAnimeInitialOffset = (listKey: string) => {
    setAnimeCarouselState((prev) => {
      const current = prev[listKey] ?? { offset: 32, mask: true };
      if (current.offset === 0 && !current.mask) return prev;
      return {
        ...prev,
        [listKey]: { offset: 0, mask: false },
      };
    });
  };



  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader
        homeCategory={category}
        onHomeCategoryChange={handleHomeCategoryChange}
      />
      {toast && (
        <div
          ref={toastRef}
          className={`fixed z-50 whitespace-nowrap rounded-full border border-white/15 bg-black/80 px-3 py-1.5 text-xs ${
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
              toast.tone === "error" ? "text-red-300" : "text-emerald-300"
            }
          >
            {toast.message}
          </span>
        </div>
      )}

      <main className="home-main min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto h-full w-full pt-2">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            {category === "movie" && (
              <div>
                <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">電影推薦</h2>
                    <p className="mt-2 text-sm text-white/60">
                      依 TMDB 分類顯示四種推薦清單。
                    </p>
                  </div>
                  {movieUpdatedAt && (
                    <p className="text-xs text-white/50">
                      最後更新時間：{formatUpdatedAt(movieUpdatedAt)}
                    </p>
                  )}
                </div>

                {movieLoading && (
                  <p className="flex items-center gap-2 text-sm text-white/60">
                    <span
                      className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
                      aria-hidden="true"
                    />
                    載入中...
                  </p>
                )}
                {!movieLoading && movieError && (
                  <p className="text-sm text-red-300">{movieError}</p>
                )}

                {!movieLoading && !movieError && (
                  <div className="grid gap-10">
                    {movieLists.length === 0 ? (
                      <p className="text-sm text-white/60">目前沒有資料。</p>
                    ) : (
                      movieLists.map((list, listIndex) => {
                        const carouselState =
                          movieCarouselState[list.key] ??
                          DEFAULT_CAROUSEL_STATE;

                        return (
                        <section key={list.key}>
                          <div className="mb-4 flex items-center gap-3">
                            <h3 className="text-lg font-semibold">
                              {list.title}
                            </h3>
                            <span className="text-xs text-white/40">
                              {list.data.length} 筆
                            </span>
                          </div>
                          <div className="carousel-shell">
                            <Swiper
                              loop
                              slidesPerView="auto"
                              spaceBetween={baseGap}
                              slidesOffsetBefore={carouselState.offset}
                              grabCursor
                              className="carousel-track"
                              onSliderFirstMove={() =>
                                clearMovieInitialOffset(list.key)
                              }
                              onSwiper={(swiper) => {
                                movieSwiperRefs.current[list.key] = swiper;
                              }}
                            >
                              {list.data.map((item, index) => (
                                <SwiperSlide
                                  key={`${list.key}-${item.id}-${index}`}
                                  className="w-48!"
                                >
                                  <MediaCard
                                    title={item.title}
                                    subtitle={getYear(item.release_date)}
                                    posterPath={item.poster_path ?? null}
                                    priority={
                                      category === "movie" &&
                                      listIndex < 2 &&
                                      index < 6
                                    }
                                    onClick={() => handleSelectMovie(item)}
                                    showWatchlistToggle
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
                                </SwiperSlide>
                              ))}
                            </Swiper>
                            {carouselState.mask && (
                              <div
                                className="pointer-events-none absolute left-0 top-0 z-10 h-full bg-[#0b0b0c]"
                                style={{ width: `${carouselState.offset}px` }}
                              />
                            )}
                          </div>
                        </section>
                      )})
                    )}
                  </div>
                )}
              </div>
            )}

            {category === "tv" && (
              <div>
                <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">影集推薦</h2>
                    <p className="mt-2 text-sm text-white/60">
                      依 TMDB 分類顯示三種推薦清單。
                    </p>
                  </div>
                  {tvUpdatedAt && (
                    <p className="text-xs text-white/50">
                      最後更新時間：{formatUpdatedAt(tvUpdatedAt)}
                    </p>
                  )}
                </div>

                {tvLoading && (
                  <p className="flex items-center gap-2 text-sm text-white/60">
                    <span
                      className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
                      aria-hidden="true"
                    />
                    載入中...
                  </p>
                )}
                {!tvLoading && tvError && (
                  <p className="text-sm text-red-300">{tvError}</p>
                )}

                {!tvLoading && !tvError && (
                  <div className="grid gap-10">
                    {tvLists.length === 0 ? (
                      <p className="text-sm text-white/60">目前沒有資料。</p>
                    ) : (
                      tvLists.map((list, listIndex) => {
                        const carouselState =
                          tvCarouselState[list.key] ?? DEFAULT_CAROUSEL_STATE;

                        return (
                        <section key={list.key}>
                          <div className="mb-4 flex items-center gap-3">
                            <h3 className="text-lg font-semibold">
                              {list.title}
                            </h3>
                            <span className="text-xs text-white/40">
                              {list.data.length} 筆
                            </span>
                          </div>
                          <div className="carousel-shell">
                            <Swiper
                              loop
                              slidesPerView="auto"
                              spaceBetween={baseGap}
                              slidesOffsetBefore={carouselState.offset}
                              grabCursor
                              className="carousel-track"
                              onSliderFirstMove={() =>
                                clearTvInitialOffset(list.key)
                              }
                              onSwiper={(swiper) => {
                                tvSwiperRefs.current[list.key] = swiper;
                              }}
                            >
                              {list.data.map((item, index) => (
                                <SwiperSlide
                                  key={`${list.key}-${item.id}-${index}`}
                                  className="w-48!"
                                >
                                  <MediaCard
                                    title={item.name}
                                    subtitle={getYear(item.first_air_date)}
                                    posterPath={item.poster_path ?? null}
                                    priority={
                                      category === "tv" && listIndex < 2 && index < 6
                                    }
                                    onClick={() => handleSelectTv(item)}
                                    showWatchlistToggle
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
                                </SwiperSlide>
                              ))}
                            </Swiper>
                            {carouselState.mask && (
                              <div
                                className="pointer-events-none absolute left-0 top-0 z-10 h-full bg-[#0b0b0c]"
                                style={{ width: `${carouselState.offset}px` }}
                              />
                            )}
                          </div>
                        </section>
                      )})
                    )}
                  </div>
                )}
              </div>
            )}

            {category === "anime" && (
              <div>
                <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">動畫推薦</h2>
                    <p className="mt-2 text-sm text-white/60">
                      依 TMDB 分類顯示三種推薦清單。
                    </p>
                  </div>
                  {animeUpdatedAt && (
                    <p className="text-xs text-white/50">
                      最後更新時間：{formatUpdatedAt(animeUpdatedAt)}
                    </p>
                  )}
                </div>

                {animeLoading && (
                  <p className="flex items-center gap-2 text-sm text-white/60">
                    <span
                      className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
                      aria-hidden="true"
                    />
                    載入中...
                  </p>
                )}
                {!animeLoading && animeError && (
                  <p className="text-sm text-red-300">{animeError}</p>
                )}

                {!animeLoading && !animeError && (
                  <div className="grid gap-10">
                    {animeLists.length === 0 ? (
                      <p className="text-sm text-white/60">目前沒有資料。</p>
                    ) : (
                      animeLists.map((list, listIndex) => {
                        const carouselState =
                          animeCarouselState[list.key] ??
                          DEFAULT_CAROUSEL_STATE;

                        return (
                          <section key={list.key}>
                            <div className="mb-4 flex items-center gap-3">
                              <h3 className="text-lg font-semibold">
                                {list.title}
                              </h3>
                              <span className="text-xs text-white/40">
                                {list.data.length} 筆
                              </span>
                            </div>
                            <div className="carousel-shell">
                              <Swiper
                                loop
                                slidesPerView="auto"
                                spaceBetween={baseGap}
                                slidesOffsetBefore={carouselState.offset}
                                grabCursor
                                className="carousel-track"
                                onSliderFirstMove={() =>
                                  clearAnimeInitialOffset(list.key)
                                }
                                onSwiper={(swiper) => {
                                  animeSwiperRefs.current[list.key] = swiper;
                                }}
                              >
                                {list.data.map((item, index) => (
                                  <SwiperSlide
                                    key={`${list.key}-${item.id}-${index}`}
                                    className="w-48!"
                                  >
                                    <MediaCard
                                      title={item.name}
                                      subtitle={getYear(item.first_air_date)}
                                      posterPath={item.poster_path ?? null}
                                      priority={
                                        category === "anime" &&
                                        listIndex < 2 &&
                                        index < 6
                                      }
                                      onClick={() => handleSelectTv(item)}
                                      showWatchlistToggle
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
                                  </SwiperSlide>
                                ))}
                              </Swiper>
                              {carouselState.mask && (
                                <div
                                  className="pointer-events-none absolute left-0 top-0 z-10 h-full bg-[#0b0b0c]"
                                  style={{
                                    width: `${carouselState.offset}px`,
                                  }}
                                />
                              )}
                            </div>
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

