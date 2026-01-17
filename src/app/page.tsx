/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import type { Swiper as SwiperType } from "swiper/types";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import MediaCard from "@/components/MediaCard";
import { getDetailCache, setDetailCache } from "@/lib/tmdbDetailCache";

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

type DetailData = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
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
};

type EpisodeInfo = {
  episode_number: number;
  name: string | null;
};


export default function Home() {
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "history">("details");
  const [detailHeight, setDetailHeight] = useState<number | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [seasonEpisodes, setSeasonEpisodes] = useState<EpisodeInfo[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState("");
  const detailModalRef = useRef<HTMLDivElement | null>(null);
  const baseGap = 8;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("homeCategory");
    if (stored === "movie" || stored === "tv" || stored === "anime") {
      setCategory((prev) => (stored === prev ? prev : stored));
    }
  }, []);

  const handleHomeCategoryChange = (next: "movie" | "tv" | "anime") => {
    setCategory(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("homeCategory", next);
    }
  };

  useEffect(() => {
    if (category !== "movie") return;
    if (movieLists.length) return;

    let isMounted = true;
    setMovieLoading(true);
    setMovieError("");

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
    setTvLoading(true);
    setTvError("");

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
    setAnimeLoading(true);
    setAnimeError("");

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

  const handleSelectMovie = async (item: MovieItem) => {
    setDetailOpen(true);
    setDetailTab("details");
    setSelectedSeason(null);
    setDetailLoading(true);
    setDetailError("");
    setDetailData(null);

    try {
      const cacheKey = `movie:${item.id}`;
      const cached = getDetailCache<DetailData>(cacheKey);
      if (cached) {
        setDetailData(cached);
        setDetailLoading(false);
        return;
      }

      const response = await fetch(
        `/api/tmdb/detail?type=movie&id=${item.id}`
      );

      if (!response.ok) {
        throw new Error("detail failed");
      }

      const data = (await response.json()) as DetailData;
      setDetailCache(cacheKey, data);
      setDetailData(data);
    } catch {
      setDetailError("載入詳細資料失敗，請稍後再試。");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSelectTv = async (item: TvItem) => {
    setDetailOpen(true);
    setDetailTab("details");
    setSelectedSeason(null);
    setDetailLoading(true);
    setDetailError("");
    setDetailData(null);

    try {
      const cacheKey = `tv:${item.id}`;
      const cached = getDetailCache<DetailData>(cacheKey);
      if (cached) {
        setDetailData(cached);
        setDetailLoading(false);
        return;
      }

      const response = await fetch(`/api/tmdb/detail?type=tv&id=${item.id}`);

      if (!response.ok) {
        throw new Error("detail failed");
      }

      const data = (await response.json()) as DetailData;
      setDetailCache(cacheKey, data);
      setDetailData(data);
    } catch {
      setDetailError("載入詳細資料失敗，請稍後再試。");
    } finally {
      setDetailLoading(false);
    }
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

  useLayoutEffect(() => {
    if (!detailOpen) return;
    if (detailTab !== "details") return;
    if (!detailModalRef.current) return;
    const nextHeight = detailModalRef.current.offsetHeight;
    if (nextHeight > 0) {
      setDetailHeight(nextHeight);
    }
  }, [detailOpen, detailTab, detailLoading, detailData]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    if (detailOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    }
    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [detailOpen]);

  useEffect(() => {
    if (!detailData || detailData.media_type !== "tv") {
      setSelectedSeason(null);
      setSeasonEpisodes([]);
      setSeasonLoading(false);
      setSeasonError("");
      return;
    }
    const firstSeason = detailData.seasons_info?.[0]?.season_number ?? null;
    setSelectedSeason(firstSeason);
  }, [detailData]);

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

    fetch(
      `/api/tmdb/season?type=tv&id=${detailData.id}&season=${selectedSeason}`
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("season failed");
        return response.json();
      })
      .then((data) => {
        if (!isMounted) return;
        const episodes = (data.episodes ?? []) as EpisodeInfo[];
        setSeasonEpisodes(episodes);
        setDetailCache(cacheKey, episodes);
      })
      .catch(() => {
        if (!isMounted) return;
        setSeasonError("載入集數失敗，請稍後再試。");
        setSeasonEpisodes([]);
      })
      .finally(() => {
        if (!isMounted) return;
        setSeasonLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [detailData, selectedSeason]);


  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader
        homeCategory={category}
        onHomeCategoryChange={handleHomeCategoryChange}
      />

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
                  <p className="text-sm text-white/60">載入中...</p>
                )}
                {!movieLoading && movieError && (
                  <p className="text-sm text-red-300">{movieError}</p>
                )}

                {!movieLoading && !movieError && (
                  <div className="grid gap-10">
                    {movieLists.length === 0 ? (
                      <p className="text-sm text-white/60">目前沒有資料。</p>
                    ) : (
                      movieLists.map((list) => {
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
                                  className="!w-48"
                                >
                                  <MediaCard
                                    title={item.title}
                                    subtitle={getYear(item.release_date)}
                                    posterPath={item.poster_path ?? null}
                                    onClick={() => handleSelectMovie(item)}
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
                  <p className="text-sm text-white/60">載入中...</p>
                )}
                {!tvLoading && tvError && (
                  <p className="text-sm text-red-300">{tvError}</p>
                )}

                {!tvLoading && !tvError && (
                  <div className="grid gap-10">
                    {tvLists.length === 0 ? (
                      <p className="text-sm text-white/60">目前沒有資料。</p>
                    ) : (
                      tvLists.map((list) => {
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
                                  className="!w-48"
                                >
                                  <MediaCard
                                    title={item.name}
                                    subtitle={getYear(item.first_air_date)}
                                    posterPath={item.poster_path ?? null}
                                    onClick={() => handleSelectTv(item)}
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
                  <p className="text-sm text-white/60">載入中...</p>
                )}
                {!animeLoading && animeError && (
                  <p className="text-sm text-red-300">{animeError}</p>
                )}

                {!animeLoading && !animeError && (
                  <div className="grid gap-10">
                    {animeLists.length === 0 ? (
                      <p className="text-sm text-white/60">目前沒有資料。</p>
                    ) : (
                      animeLists.map((list) => {
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
                                    className="!w-48"
                                  >
                                    <MediaCard
                                      title={item.name}
                                      subtitle={getYear(item.first_air_date)}
                                      posterPath={item.poster_path ?? null}
                                      onClick={() => handleSelectTv(item)}
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

      {detailOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-8"
          onClick={() => setDetailOpen(false)}
        >
          <div
            ref={detailModalRef}
            className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
            style={detailHeight ? { height: `${detailHeight}px` } : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-4 top-4 h-8 w-8 rounded-full border border-white/15 text-sm text-white/70 hover:border-white/40"
              onClick={() => setDetailOpen(false)}
              aria-label="Close detail"
            >
              ×
            </button>
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-white/10 pb-3 pr-10">
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
              <div className="mt-4 flex-1 h-full min-h-0 overflow-hidden pr-2">
                {detailLoading && (
                  <div className="flex flex-col gap-6 md:flex-row">
                    <div className="h-[360px] w-60 animate-pulse rounded-xl bg-white/5" />
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
                {!detailLoading && detailError && (
                  <p className="text-sm text-red-300">{detailError}</p>
                )}
                {!detailLoading && !detailError && detailData && (
                  <>
                    {detailTab === "details" && (
                      <div className="flex flex-col gap-6 md:flex-row">
                        <div className="h-[360px] w-60 overflow-hidden rounded-xl bg-white/5">
                          {detailData.poster_path ? (
                            <img
                              src={`https://image.tmdb.org/t/p/w342${detailData.poster_path}`}
                              alt={detailData.title}
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="flex h-80 flex-1 flex-col">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <h2 className="text-2xl font-semibold">
                              {detailData.title}
                            </h2>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-white/70">
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
                                : detailData.year ?? "未提供"}
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
                            </p>
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
                            </p>
                            <div className="flex flex-col gap-2 text-white/60">
                              <p>{detailData.overview || "未提供簡介。"}</p>
                              {detailData.homepage && (
                                <a
                                  href={detailData.homepage}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm text-sky-300 hover:text-sky-200"
                                >
                                  官方網站
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {detailTab === "history" && (
                      <div className="grid h-full min-h-0 flex-1 grid-rows-[auto,1fr] gap-4">
                        {detailData.media_type !== "tv" && (
                          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                            此內容沒有季數。
                          </div>
                        )}
                        {detailData.media_type === "tv" && (
                          <>
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-white/60">
                                選擇季數
                              </span>
                              <select
                                className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-white/80 outline-none focus:border-white/40"
                                value={selectedSeason ?? ""}
                                onChange={(event) =>
                                  setSelectedSeason(
                                    event.target.value
                                      ? Number(event.target.value)
                                      : null
                                  )
                                }
                              >
                                {detailData.seasons_info?.map((season) => (
                                  <option
                                    key={season.season_number}
                                    value={season.season_number}
                                  >
                                    第{season.season_number}季 · 共{" "}
                                    {season.episode_count ?? "未知"} 集
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="h-full min-h-0 overflow-y-scroll overscroll-contain pr-1">
                              <div className="grid gap-2 text-sm text-white/70">
                                {!selectedSeason && (
                                  <p className="text-white/50">
                                    尚未選擇季數。
                                  </p>
                                )}
                                {selectedSeason && seasonLoading && (
                                  <>
                                    {Array.from({ length: 6 }, (_, index) => (
                                      <div
                                        key={`season-skeleton-${index}`}
                                        className="h-10 animate-pulse rounded-lg border border-white/10 bg-white/5"
                                      />
                                    ))}
                                  </>
                                )}
                                {selectedSeason && !seasonLoading && seasonError && (
                                  <p className="text-red-300">{seasonError}</p>
                                )}
                                {selectedSeason &&
                                  !seasonLoading &&
                                  !seasonError &&
                                  seasonEpisodes.length === 0 && (
                                    <p className="text-white/50">
                                      尚未取得集數資料。
                                    </p>
                                  )}
                                {selectedSeason &&
                                  !seasonLoading &&
                                  !seasonError &&
                                  seasonEpisodes.length > 0 &&
                                  seasonEpisodes.map((episode) => (
                                    <div
                                      key={`${selectedSeason}-${episode.episode_number}`}
                                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                                    >
                                      S{selectedSeason}E{episode.episode_number}
                                      {episode.name
                                        ? ` - ${episode.name}`
                                        : ""}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}

