"use client";

import { useEffect, useRef, useState } from "react";
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
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({});

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


  const scrollList = (key: string, direction: number) => {
    const node = listRefs.current[key];
    if (!node) return;
    node.scrollBy({ left: direction * 360, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader
        homeCategory={category}
        onHomeCategoryChange={(next) => setCategory(next)}
      />

      <main className="min-h-screen px-8 pb-16 pt-28">
        <div className="mx-auto h-full w-full pt-10">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            {category === "movie" && (
              <div>
                <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">電影推薦</h2>
                    <p className="mt-2 text-sm text-white/60">
                      目前只顯示上映中清單。
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
                    {movieLists.map((list) => (
                      <section key={list.key}>
                        <div className="mb-4 flex items-center justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold">
                              {list.title}
                            </h3>
                            <span className="text-xs text-white/40">
                              {list.data.length} 筆
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => scrollList(list.key, -1)}
                              className="h-8 w-8 rounded-full border border-white/15 text-sm text-white/70 hover:border-white/40"
                              aria-label="Scroll left"
                            >
                              ‹
                            </button>
                            <button
                              type="button"
                              onClick={() => scrollList(list.key, 1)}
                              className="h-8 w-8 rounded-full border border-white/15 text-sm text-white/70 hover:border-white/40"
                              aria-label="Scroll right"
                            >
                              ›
                            </button>
                          </div>
                        </div>
                        <div
                          className="max-w-full overflow-x-auto overscroll-x-contain"
                          ref={(node) => {
                            listRefs.current[list.key] = node;
                          }}
                        >
                          <ul className="flex w-max gap-3 pb-2">
                          {list.data.map((item) => (
                            <li
                              key={item.id}
                              className="flex w-48 flex-shrink-0 flex-col items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-2"
                            >
                              <div className="aspect-[2/3] w-full overflow-hidden rounded-lg border border-white/10 bg-white/5">
                                {item.poster_path ? (
                                  <img
                                    src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
                                    alt={item.title}
                                    className="h-full w-full object-cover"
                                  />
                                ) : null}
                              </div>
                              <p className="text-sm font-semibold text-white/90">
                                {item.title}
                              </p>
                              <p className="text-xs text-white/50">
                                {getYear(item.release_date)}
                              </p>
                            </li>
                          ))}
                          </ul>
                        </div>
                      </section>
                    ))}
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
