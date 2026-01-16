"use client";

import { useEffect, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

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

export default function Home() {
  const [category, setCategory] = useState<"movie" | "tv" | "anime">("movie");
  const [movieLists, setMovieLists] = useState<MovieList[]>([]);
  const [movieUpdatedAt, setMovieUpdatedAt] = useState<string | null>(null);
  const [movieLoading, setMovieLoading] = useState(false);
  const [movieError, setMovieError] = useState("");
  const [initialOffset, setInitialOffset] = useState(32);
  const [maskEnabled, setMaskEnabled] = useState(true);
  const baseGap = 8;

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

  const clearInitialOffset = () => {
    if (initialOffset !== 0) {
      setInitialOffset(0);
    }
    if (maskEnabled) {
      setMaskEnabled(false);
    }
  };


  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader
        homeCategory={category}
        onHomeCategoryChange={(next) => setCategory(next)}
      />

      <main className="min-h-screen px-8 pb-16 pt-28">
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
                      movieLists.map((list) => (
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
                              slidesOffsetBefore={initialOffset}
                              grabCursor
                              className="carousel-track"
                              onSliderFirstMove={clearInitialOffset}
                            >
                              {list.data.map((item) => (
                                <SwiperSlide key={item.id} className="!w-48">
                                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-white/10 bg-white/10">
                                      {item.poster_path ? (
                                        <img
                                          src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
                                          alt={item.title}
                                          className="h-full w-full select-none object-cover"
                                          draggable={false}
                                        />
                                      ) : null}
                                    </div>
                                    <p className="mt-2 text-sm font-semibold text-white/90">
                                      {item.title}
                                    </p>
                                    <p className="text-xs text-white/50">
                                      {getYear(item.release_date)}
                                    </p>
                                  </div>
                                </SwiperSlide>
                              ))}
                            </Swiper>
                            {maskEnabled && (
                              <div
                                className="pointer-events-none absolute left-0 top-0 z-10 h-full bg-[#0b0b0c]"
                                style={{ width: `${initialOffset}px` }}
                              />
                            )}
                          </div>
                        </section>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {category === "tv" && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-lg font-semibold">影集推薦</h2>
                <p className="mt-2 text-sm text-white/50">尚未有資料。</p>
              </div>
            )}

            {category === "anime" && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-lg font-semibold">動畫推薦</h2>
                <p className="mt-2 text-sm text-white/50">尚未有資料。</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

