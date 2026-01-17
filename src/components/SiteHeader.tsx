/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import MediaCard from "@/components/MediaCard";

const navItems = [
  { label: "首頁", href: "/" },
  { label: "電影", href: "/movies" },
  { label: "影集", href: "/tv" },
  { label: "動畫", href: "/anime" },
  { label: "行事曆", href: "/calendar" },
];
const PROJECT_ID = "watch";

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

type CachedSearch = {
  results: SearchResult[];
  expiresAt: number;
};

const searchCache = new Map<string, CachedSearch>();
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_CACHE_MAX = 50;

export default function SiteHeader({
  showLoginLink = true,
  homeCategory,
  onHomeCategoryChange,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const activePath = pathname === "/login" ? "/" : pathname;
  const menuActiveMap: Record<string, string> = {
    "/account": "帳戶",
    "/friends": "好友",
    "/settings": "設定",
  };
  const activeMenuLabel = menuActiveMap[activePath];
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  const [searchInputOpen, setSearchInputOpen] = useState(false);
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
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState("");
  const detailModalRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchPanelRef = useRef<HTMLDivElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);

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
    if (!navMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!navMenuRef.current) return;
      if (!navMenuRef.current.contains(event.target as Node)) {
        setNavMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [navMenuOpen]);

  useEffect(() => {
    setSearchSlot(document.getElementById("search-results-slot"));
  }, []);

  useEffect(() => {
    if (!searchInputOpen) return;
    searchInputRef.current?.focus();
  }, [searchInputOpen]);

  useEffect(() => {
    if (!searchInputOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (query.trim().length > 0) return;
      const target = event.target as Node;
      if (searchPanelRef.current?.contains(target)) return;
      if (searchButtonRef.current?.contains(target)) return;
      setSearchInputOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchInputOpen]);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setSearchError("");
    setSearchOpen(false);
    setSearchInputOpen(false);
  }, [pathname]);

  const resetSearch = () => {
    setQuery("");
    setResults([]);
    setSearchError("");
    setSearchOpen(false);
    setSearchInputOpen(false);
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (searchOpen) {
      document.body.dataset.searchOpen = "true";
    } else {
      delete document.body.dataset.searchOpen;
    }
  }, [searchOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!detailOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [detailOpen]);

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
    if (!detailOpen || !detailData || !session) {
      setIsInWatchlist(false);
      return;
    }

    let isMounted = true;
    setWatchlistLoading(true);
    setWatchlistNotice("");

    supabase
      .from("watchlist_items")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setIsInWatchlist(false);
          return;
        }
        setIsInWatchlist(Boolean(data));
      })
      .finally(() => {
        if (!isMounted) return;
        setWatchlistLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [detailOpen, detailData, session]);

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

  const handleToggleWatchlist = async () => {
    if (!detailData) return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以加入清單。");
      return;
    }
    if (watchlistLoading) return;

    setWatchlistLoading(true);
    setWatchlistNotice("");

    if (isInWatchlist) {
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", detailData.media_type)
        .eq("tmdb_id", detailData.id);
      if (error) {
        setWatchlistNotice("移除失敗，請稍後再試。");
      } else {
        setIsInWatchlist(false);
        setWatchlistNotice("已從清單移除。");
      }
      setWatchlistLoading(false);
      return;
    }

    const { error } = await supabase.from("watchlist_items").insert({
      user_id: session.user.id,
      project_id: PROJECT_ID,
      media_type: detailData.media_type,
      tmdb_id: detailData.id,
      title: detailData.title,
      year: getWatchlistYear(detailData),
      poster_path: detailData.poster_path,
      is_anime: detailData.is_anime,
    });

    if (error) {
      setWatchlistNotice("加入失敗，請稍後再試。");
    } else {
      setIsInWatchlist(true);
      setWatchlistNotice("已加入清單。");
    }
    setWatchlistLoading(false);
  };

  const handleSelectResult = async (item: SearchResult) => {
    setDetailOpen(true);
    setDetailTab("details");
    setSelectedSeason(null);
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
        pruneSearchCache();
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
        pruneSearchCache();
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

  const pruneSearchCache = () => {
    const now = Date.now();
    for (const [key, entry] of searchCache.entries()) {
      if (entry.expiresAt <= now) {
        searchCache.delete(key);
      }
    }
    while (searchCache.size > SEARCH_CACHE_MAX) {
      const oldestKey = searchCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      searchCache.delete(oldestKey);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const userInitial =
    session?.user?.email?.trim().charAt(0).toUpperCase() ?? "U";
  const showHomeSubnav = pathname === "/" && onHomeCategoryChange;
  const activeNavLabel =
    navItems.find((item) => item.href === activePath)?.label ?? "選單";

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
        <ul className="grid select-none justify-between gap-x-2 gap-y-3 [grid-template-columns:repeat(auto-fill,192px)]">
          {results.map((item) => (
            <li
              key={`${item.media_type}:${item.id}`}
              className="flex w-full"
            >
              <MediaCard
                title={item.title}
                subtitle={`${
                  item.media_type === "movie"
                    ? "電影"
                    : item.is_anime
                    ? "動畫"
                    : "影集"
                }${item.year ? ` · ${item.year}` : ""}`}
                posterPath={item.poster_path}
                onClick={() => handleSelectResult(item)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  ) : null;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-20 border-b border-white/10 bg-[#0b0b0c]">
        <div className="flex h-16 w-full items-center gap-6 px-8">
          <div className="flex flex-1 items-center gap-4">
            <div className="relative md:hidden" ref={navMenuRef}>
              <button
                type="button"
                onClick={() => setNavMenuOpen((value) => !value)}
                className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                aria-expanded={navMenuOpen}
                aria-haspopup="menu"
              >
                {activeNavLabel}
              </button>
              {navMenuOpen && (
                <div
                  className="absolute left-0 mt-2 w-40 rounded-xl border border-white/10 bg-[#0b0b0c] p-2 text-xs text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                  role="menu"
                >
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => {
                        resetSearch();
                        setNavMenuOpen(false);
                      }}
                      className={`block rounded-lg px-3 py-2 hover:bg-white/10 ${
                        activePath === item.href
                          ? "text-white font-semibold"
                          : ""
                      }`}
                      role="menuitem"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <nav className="hidden min-w-0 items-center gap-8 text-sm tracking-wide text-[#cfcfcf] md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={resetSearch}
                className={`rounded-full px-3 py-1 transition hover:bg-white/10 hover:text-white ${
                  activePath === item.href
                    ? "text-white font-semibold"
                    : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative" ref={searchPanelRef}>
              <button
                type="button"
                ref={searchButtonRef}
                onClick={() =>
                  setSearchInputOpen((value) => {
                    if (value && query.trim().length > 0) return value;
                    return !value;
                  })
                }
                className={`flex h-9 items-center justify-center text-white/70 transition hover:text-white ${
                  searchInputOpen
                    ? "w-60 rounded-full border border-white/15 bg-white/5 px-3"
                    : "w-9"
                }`}
                aria-label="搜尋"
                aria-expanded={searchInputOpen}
              >
                <svg
                  aria-hidden="true"
                  className="h-[30px] w-[30px] shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M16.2 16.2L20 20"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.6"
                  />
                </svg>
                {searchInputOpen && (
                  <input
                    ref={searchInputRef}
                    type="search"
                    id="site-search"
                    name="site-search"
                    placeholder="搜尋"
                    className="ml-2 h-8 w-full bg-transparent text-sm text-white/80 outline-none placeholder:text-white/40"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => {
                      if (query.trim().length >= 1) setSearchOpen(true);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
              </button>
            </div>
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
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-white/80 transition hover:border-white/40 hover:text-white"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  {userInitial}
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-24 rounded-xl border border-white/10 bg-[#0b0b0c] p-2 text-xs text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    role="menu"
                  >
                    <Link
                      href="/account"
                      className={`block rounded-lg px-3 py-2 hover:bg-white/10 ${
                        activeMenuLabel === "帳戶"
                          ? "text-white font-semibold"
                          : ""
                      }`}
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      帳戶
                    </Link>
                    <Link
                      href="/friends"
                      className={`mt-1 block rounded-lg px-3 py-2 hover:bg-white/10 ${
                        activeMenuLabel === "好友"
                          ? "text-white font-semibold"
                          : ""
                      }`}
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      好友
                    </Link>
                    <Link
                      href="/settings"
                      className={`mt-1 block rounded-lg px-3 py-2 hover:bg-white/10 ${
                        activeMenuLabel === "設定"
                          ? "text-white font-semibold"
                          : ""
                      }`}
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      設定
                    </Link>
                    <button
                      type="button"
                      className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-red-300 hover:bg-red-500/10"
                      onClick={async () => {
                        setMenuOpen(false);
                        await handleSignOut();
                      }}
                      role="menuitem"
                    >
                      登出
                      <svg
                        aria-hidden="true"
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M10 6H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                        <path
                          d="M14 16l4-4-4-4"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                        <path
                          d="M18 12H10"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                      </svg>
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

      {showHomeSubnav && !searchOpen && (
        <div className="home-subnav fixed inset-x-0 top-16 z-10 border-b border-white/10 bg-[#0b0b0c]">
          <div className="flex h-11 w-full items-center justify-center gap-3 px-8 text-xs text-white/70">
            <button
              type="button"
              onClick={() => {
                resetSearch();
                onHomeCategoryChange?.("movie");
              }}
              className={`rounded-full border px-8 py-2 text-[11px] uppercase tracking-[0.2em] ${
                homeCategory === "movie"
                  ? "border-white/60 bg-white/10 text-white"
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
                  ? "border-white/60 bg-white/10 text-white"
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
                  ? "border-white/60 bg-white/10 text-white"
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
                  onClick={handleToggleWatchlist}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${
                    isInWatchlist
                      ? "border-yellow-400/60 text-yellow-300"
                      : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
                  }`}
                  aria-label={isInWatchlist ? "移除清單" : "加入清單"}
                  aria-pressed={isInWatchlist}
                >
                  {isInWatchlist ? "★" : "☆"}
                </button>
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
              {watchlistNotice && (
                <p className="mt-2 text-xs text-white/60">{watchlistNotice}</p>
              )}
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
                            <div className="flex flex-col gap-2 text-white/80">
                              <p>{detailData.overview ?? "未提供"}</p>
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
                                id="detail-season-select-header"
                                name="detail-season-select-header"
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
    </>
  );
}
