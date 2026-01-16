"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  DEFAULT_DETAIL_TTL_MS,
  getDetailCache,
  setDetailCache,
} from "@/lib/tmdbDetailCache";

const navItems = [
  { label: "首頁", href: "/" },
  { label: "電影", href: "/movies" },
  { label: "影集", href: "/tv" },
  { label: "動畫", href: "/anime" },
  { label: "行事曆", href: "/calendar" },
];

type SiteHeaderProps = {
  showLoginLink?: boolean;
  homeCategory?: "movie" | "tv" | "anime";
  onHomeCategoryChange?: (category: "movie" | "tv" | "anime") => void;
};

type SearchResult = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
  is_anime: boolean;
  poster_path: string | null;
};

type DetailData = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
  start_year: string | null;
  end_year: string | null;
  is_anime: boolean;
  runtime: number | null;
  countries: string[];
  languages: string[];
  overview: string | null;
  poster_path: string | null;
  homepage: string | null;
};

type CachedSearch = {
  results: SearchResult[];
  expiresAt: number;
};

const searchCache = new Map<string, CachedSearch>();
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;

export default function SiteHeader({
  showLoginLink = true,
  homeCategory,
  onHomeCategoryChange,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailData, setDetailData] = useState<DetailData | null>(null);

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
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  useEffect(() => {
    setSearchSlot(document.getElementById("search-results-slot"));
  }, []);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setSearchError("");
    setSearchOpen(false);
  }, [pathname]);

  const resetSearch = () => {
    setQuery("");
    setResults([]);
    setSearchError("");
    setSearchOpen(false);
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (searchOpen) {
      document.body.dataset.searchOpen = "true";
    } else {
      delete document.body.dataset.searchOpen;
    }
  }, [searchOpen]);

  const handleSelectResult = async (item: SearchResult) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError("");
    setDetailData(null);

    try {
      const detailKey = `${item.media_type}:${item.id}`;
      const cached = getDetailCache<DetailData>(detailKey);
      if (cached) {
        setDetailData(cached);
        setDetailLoading(false);
        return;
      }

      const response = await fetch(
        `/api/tmdb/detail?type=${item.media_type}&id=${item.id}`
      );

      if (!response.ok) {
        throw new Error("detail failed");
      }

      const data = (await response.json()) as DetailData;
      setDetailData(data);
      setDetailCache(detailKey, data, DEFAULT_DETAIL_TTL_MS);
    } catch {
      setDetailError("載入詳細資料失敗，請稍後再試。");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setSearchError("");
      setSearchOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      setSearchOpen(true);

      try {
        const cached = searchCache.get(trimmed);
        if (cached && cached.expiresAt > Date.now()) {
          setResults(cached.results);
          setSearchLoading(false);
          return;
        }

        const response = await fetch(
          `/api/tmdb/search?query=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("search failed");
        }

        const data = await response.json();
        const nextResults = data.results ?? [];
        setResults(nextResults);
        searchCache.set(trimmed, {
          results: nextResults,
          expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setSearchError("搜尋失敗，請稍後再試。");
        setResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const userInitial =
    session?.user?.email?.trim().charAt(0).toUpperCase() ?? "U";
  const showHomeSubnav = pathname === "/" && onHomeCategoryChange;

  const searchResultsPanel = searchOpen ? (
    <section className="text-white/70">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-white">搜尋結果</h1>
        <span className="text-xs text-white/50">
          {results.length ? `${results.length} 筆` : ""}
        </span>
      </div>
      {searchLoading && <p className="text-sm text-white/60">搜尋中...</p>}
      {!searchLoading && searchError && (
        <p className="text-sm text-red-300">{searchError}</p>
      )}
      {!searchLoading && !searchError && results.length === 0 && (
        <p className="text-sm text-white/60">沒有找到結果。</p>
      )}
      {!searchLoading && !searchError && results.length > 0 && (
        <ul className="grid select-none gap-x-2 gap-y-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
          {results.map((item) => (
            <li
              key={`${item.media_type}:${item.id}`}
              className="flex w-full cursor-pointer select-none flex-col items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-2 hover:bg-white/10"
              onClick={() => handleSelectResult(item)}
            >
              <div className="aspect-[2/3] w-full overflow-hidden rounded-lg border border-white/10 bg-white/5">
                {item.poster_path ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
                    alt={item.title}
                    className="h-full w-full select-none object-cover"
                    draggable={false}
                  />
                ) : null}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white/90">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {item.media_type === "movie"
                    ? "電影"
                    : item.is_anime
                    ? "動畫"
                    : "影集"}
                  {item.year ? ` · ${item.year}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  ) : null;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-20 border-b border-white/10 bg-[#0b0b0c]">
        <div className="relative flex h-16 w-full items-center px-8">
          <nav className="flex items-center gap-8 text-sm tracking-wide text-[#cfcfcf]">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} onClick={resetSearch}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="absolute left-1/2 w-[520px] max-w-[40vw] -translate-x-1/2">
            <input
              type="search"
              placeholder="搜尋"
              className="h-9 w-full rounded-full border border-white/10 bg-white/5 px-8 text-sm text-white/80 outline-none placeholder:text-white/40 focus:border-white/30"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => {
                if (query.trim().length >= 1) setSearchOpen(true);
              }}
            />
          </div>
          <div className="ml-auto flex items-center">
            {sessionLoading && (
              <div
                className="h-9 w-9 rounded-full border border-white/10 bg-white/5"
                aria-hidden="true"
              />
            )}
            {!sessionLoading && !session && showLoginLink && (
              <Link
                href="/login"
                className="rounded-full border border-white/15 px-8 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
              >
                登入
              </Link>
            )}
            {!sessionLoading && session && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-white/80"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  {userInitial}
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-36 rounded-xl border border-white/10 bg-[#0b0b0c] p-2 text-xs text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    role="menu"
                  >
                    <Link
                      href="/account"
                      className="block rounded-lg px-3 py-2 hover:bg-white/10"
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      帳戶
                    </Link>
                    <Link
                      href="/friends"
                      className="mt-1 block rounded-lg px-3 py-2 hover:bg-white/10"
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      好友
                    </Link>
                    <Link
                      href="/settings"
                      className="mt-1 block rounded-lg px-3 py-2 hover:bg-white/10"
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      設定
                    </Link>
                    <button
                      type="button"
                      className="mt-1 w-full rounded-lg px-3 py-2 text-left text-red-300 hover:bg-red-500/10"
                      onClick={async () => {
                        setMenuOpen(false);
                        await handleSignOut();
                      }}
                      role="menuitem"
                    >
                      登出
                    </button>
                  </div>
                )}
              </div>
            )}
            {!sessionLoading && !session && !showLoginLink && (
              <span className="rounded-full border border-white/15 px-8 py-2 text-xs uppercase tracking-[0.2em] text-white/80">
                登入
              </span>
            )}
          </div>
        </div>
      </header>

      {showHomeSubnav && (
        <div className="fixed inset-x-0 top-16 z-10 border-b border-white/10 bg-[#0b0b0c]">
          <div className="flex h-11 w-full items-center justify-center gap-3 px-8 text-xs text-white/70">
            <button
              type="button"
              onClick={() => {
                resetSearch();
                onHomeCategoryChange?.("movie");
              }}
              className={`rounded-full border px-8 py-2 text-[11px] uppercase tracking-[0.2em] ${
                homeCategory === "movie"
                  ? "border-white/40 text-white"
                  : "border-white/10 text-white/70 hover:border-white/30"
              }`}
            >
              電影
            </button>
            <button
              type="button"
              onClick={() => {
                resetSearch();
                onHomeCategoryChange?.("tv");
              }}
              className={`rounded-full border px-8 py-2 text-[11px] uppercase tracking-[0.2em] ${
                homeCategory === "tv"
                  ? "border-white/40 text-white"
                  : "border-white/10 text-white/70 hover:border-white/30"
              }`}
            >
              影集
            </button>
            <button
              type="button"
              onClick={() => {
                resetSearch();
                onHomeCategoryChange?.("anime");
              }}
              className={`rounded-full border px-8 py-2 text-[11px] uppercase tracking-[0.2em] ${
                homeCategory === "anime"
                  ? "border-white/40 text-white"
                  : "border-white/10 text-white/70 hover:border-white/30"
              }`}
            >
              動畫
            </button>
          </div>
        </div>
      )}

      {searchSlot && searchResultsPanel
        ? createPortal(searchResultsPanel, searchSlot)
        : null}

      {detailOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-8"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
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
            {detailLoading && (
              <p className="text-sm text-white/60">載入中...</p>
            )}
            {!detailLoading && detailError && (
              <p className="text-sm text-red-300">{detailError}</p>
            )}
            {!detailLoading && !detailError && detailData && (
              <div className="flex flex-col gap-6 md:flex-row">
                <div className="h-64 w-44 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  {detailData.poster_path ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w342${detailData.poster_path}`}
                      alt={detailData.title}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="flex-1">
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
                        ? `${detailData.start_year}-${detailData.end_year}`
                        : detailData.year ?? "未提供"}
                    </p>
                    <p>
                      <span className="text-white/50">時長：</span>
                      {detailData.runtime
                        ? detailData.media_type === "movie"
                          ? `${detailData.runtime} 分鐘`
                          : `每集約 ${detailData.runtime} 分鐘`
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
                    <p className="text-white/80">
                      {detailData.overview ?? "未提供"}
                    </p>
                    {detailData.homepage && (
                      <a
                        href={detailData.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-blue-300 underline decoration-blue-300/40 underline-offset-4 hover:text-blue-200"
                      >
                        官方網站
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
