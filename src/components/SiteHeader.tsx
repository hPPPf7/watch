"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import useAuth from "@/hooks/useAuth";
import MediaCard from "@/components/MediaCard";
import DetailModal from "@/components/DetailModal";

const PROJECT_ID = "watch";

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
  release_date: string | null;
  is_anime: boolean;
  poster_path: string | null;
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
  const { session, loading: sessionLoading } = useAuth();
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  const [searchInputOpen, setSearchInputOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [pendingFriendCount, setPendingFriendCount] = useState(0);
  const [friendNoticeNew, setFriendNoticeNew] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{
    id: number;
    type: "movie" | "tv";
  } | null>(null);
  const [searchWatchlistMap, setSearchWatchlistMap] = useState<
    Record<string, boolean>
  >({});
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchPanelRef = useRef<HTMLDivElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const friendSeenRef = useRef(0);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setProfileAvatarUrl(null);
      return;
    }

    let isMounted = true;
    const loadProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!isMounted) return;
      const fallbackAvatar =
        session.user.user_metadata?.avatar_url ||
        session.user.user_metadata?.picture ||
        session.user.user_metadata?.avatar ||
        null;
      setProfileAvatarUrl(data?.avatar_url ?? fallbackAvatar);
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [session, sessionLoading]);

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
    if (!noticeOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!noticeRef.current) return;
      if (!noticeRef.current.contains(event.target as Node)) {
        setNoticeOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [noticeOpen]);

  useEffect(() => {
    if (!session || sessionLoading) {
      queueMicrotask(() => {
        setPendingFriendCount(0);
        setFriendNoticeNew(false);
      });
      friendSeenRef.current = 0;
      return;
    }

    const storageKey = `watch:friendNoticeSeen:${session.user.id}`;
    const stored = typeof window !== "undefined"
      ? Number(window.localStorage.getItem(storageKey) ?? 0)
      : 0;
    friendSeenRef.current = Number.isFinite(stored) ? stored : 0;

  }, [session, sessionLoading]);

  useEffect(() => {
    if (!session || sessionLoading) return;

    let isMounted = true;

    const fetchPendingFriends = async () => {
      const { count, error } = await supabase
        .from("friend_requests")
        .select("id", { count: "exact", head: true })
        .eq("to_user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("status", "pending");

      if (!isMounted) return;
      if (error) return;

      const nextCount = count ?? 0;
      setPendingFriendCount(nextCount);
      setFriendNoticeNew(nextCount > friendSeenRef.current);
    };

    fetchPendingFriends();

    const requestsChannel = supabase
      .channel("friend-notice-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `to_user_id=eq.${session.user.id}`,
        },
        () => {
          fetchPendingFriends();
        }
      )
      .subscribe();

    const friendsChannel = supabase
      .channel("friend-notice-friends")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friends",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          fetchPendingFriends();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(requestsChannel);
      supabase.removeChannel(friendsChannel);
    };
  }, [session, sessionLoading]);

  useEffect(() => {
    if (!noticeOpen) return;
    if (!session) return;
    if (pendingFriendCount === 0) return;

    const storageKey = `watch:friendNoticeSeen:${session.user.id}`;
    const nextSeen = pendingFriendCount;
    friendSeenRef.current = nextSeen;
    setFriendNoticeNew(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, String(nextSeen));
    }

  }, [noticeOpen, pendingFriendCount, session]);

  useEffect(() => {
    setSearchSlot(document.getElementById("search-results-slot"));
  }, []);

  useEffect(() => {
    if (!searchInputOpen) return;
    searchInputRef.current?.focus();
  }, [searchInputOpen, query]);

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
  }, [searchInputOpen, query]);

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
    setSearchWatchlistMap({});
  };

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
    anchorEl?: HTMLElement | null,
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
    isAnime: boolean,
  ) => `${type}:${isAnime ? "anime" : "series"}:${id}`;

  const handleDetailWatchlistChange = (
    inWatchlist: boolean,
    detail: { id: number; media_type: "movie" | "tv"; is_anime: boolean },
  ) => {
    const key = buildWatchlistKey(detail.media_type, detail.id, detail.is_anime);
    setSearchWatchlistMap((prev) => ({ ...prev, [key]: inWatchlist }));
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
    setDetailTarget({ id: item.id, type: item.media_type });
  };

  const handleToggleWatchlist = async (
    item: SearchResult,
    anchorEl?: HTMLButtonElement | null,
  ) => {
    if (anchorEl) {
      toastAnchorRef.current = anchorEl;
    }
    if (sessionLoading) return;
    if (!session) {
      showToast("請先登入以加入清單。", "error", anchorEl);
      return;
    }

    const key = buildWatchlistKey(
      item.media_type,
      item.id,
      item.media_type === "tv" && item.is_anime,
    );
    const isActive = searchWatchlistMap[key];

    if (isActive) {
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", item.media_type)
        .eq("tmdb_id", item.id);

      if (error) {
        showToast(
          error.message?.includes("watch_history_exists")
            ? "已有觀看紀錄，無法移除清單。"
            : "移除失敗，請稍後再試。",
          "error",
          anchorEl,
        );
        return;
      }

      setSearchWatchlistMap((prev) => ({ ...prev, [key]: false }));
      showToast("已從清單移除。", "success", anchorEl);
      return;
    }

    const { error } = await supabase.from("watchlist_items").insert({
      user_id: session.user.id,
      project_id: PROJECT_ID,
      media_type: item.media_type,
      tmdb_id: item.id,
      title: item.title,
      year: item.year,
      release_date: item.media_type === "movie" ? item.release_date : null,
      poster_path: item.poster_path,
      is_anime: item.is_anime,
      tmdb_cached_at: new Date().toISOString(),
    });

    if (error) {
      showToast("加入失敗，請稍後再試。", "error", anchorEl);
      return;
    }

    setSearchWatchlistMap((prev) => ({ ...prev, [key]: true }));
    showToast("已加入清單。", "success", anchorEl);
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
          { signal: controller.signal },
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

  useEffect(() => {
    if (sessionLoading) return;
    if (!session || results.length === 0) {
      setSearchWatchlistMap({});
      return;
    }

    const movieIds: number[] = [];
    const tvIds: number[] = [];
    const animeIds: number[] = [];

    results.forEach((item) => {
      if (item.media_type === "movie") {
        movieIds.push(item.id);
      } else if (item.is_anime) {
        animeIds.push(item.id);
      } else {
        tvIds.push(item.id);
      }
    });

    let isMounted = true;
    const tasks: Promise<void>[] = [];

    const loadWatchlist = async (
      ids: number[],
      type: "movie" | "tv",
      isAnime: boolean,
    ) => {
      if (ids.length === 0) return;
      const { data } = await supabase
        .from("watchlist_items")
        .select("tmdb_id")
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", type)
        .eq("is_anime", isAnime)
        .in("tmdb_id", ids);

      if (!isMounted) return;
      const idSet = new Set((data ?? []).map((entry) => entry.tmdb_id));
      setSearchWatchlistMap((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[buildWatchlistKey(type, id, isAnime)] = idSet.has(id);
        });
        return next;
      });
    };

    tasks.push(loadWatchlist(movieIds, "movie", false));
    tasks.push(loadWatchlist(tvIds, "tv", false));
    tasks.push(loadWatchlist(animeIds, "tv", true));

    Promise.all(tasks).catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [sessionLoading, session, results]);

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

  const handleSignOut = async (anchorEl?: HTMLButtonElement | null) => {
    if (anchorEl) {
      toastAnchorRef.current = anchorEl;
    }
    setMenuOpen(false);
    setNoticeOpen(false);
    setSignOutLoading(true);

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        showToast("登出失敗，請稍後再試。", "error", anchorEl);
      }

      if (typeof window !== "undefined") {
        const storageKeys = [
          ...Object.keys(window.localStorage),
          ...Object.keys(window.sessionStorage),
        ];
        storageKeys.forEach((key) => {
          if (key.startsWith("supabase.auth.") || key.includes("auth-token")) {
            window.localStorage.removeItem(key);
            window.sessionStorage.removeItem(key);
          }
        });
      }
    } catch {
      showToast("登出失敗，請稍後再試。", "error", anchorEl);
    } finally {
      setProfileAvatarUrl(null);
      setSignOutLoading(false);
      setSignOutOpen(false);
    }
  };

  const userInitial =
    session?.user?.email?.trim().charAt(0).toUpperCase() ?? "U";
  const showHomeSubnav = pathname === "/" && onHomeCategoryChange;
  const activeNavLabel =
    navItems.find((item) => item.href === activePath)?.label ?? "選單";
  const friendNoticeText =
    pendingFriendCount === 0
      ? "目前沒有通知。"
      : friendNoticeNew
      ? `你有新的好友邀請（${pendingFriendCount} 筆）`
      : `有未處理的好友邀請（${pendingFriendCount} 筆）`;

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
        <ul className="grid select-none justify-between gap-x-2 gap-y-3 grid-cols-[repeat(auto-fill,192px)]">
          {results.map((item) => (
            <li key={`${item.media_type}:${item.id}`} className="flex w-full">
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
                showWatchlistToggle
                watchlistActive={
                  searchWatchlistMap[
                    buildWatchlistKey(
                      item.media_type,
                      item.id,
                      item.media_type === "tv" && item.is_anime,
                    )
                  ]
                }
                onToggleWatchlist={(anchorEl) =>
                  handleToggleWatchlist(item, anchorEl)
                }
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
            <div className="relative hidden max-[820px]:flex" ref={navMenuRef}>
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
            <nav className="flex min-w-0 items-center gap-8 text-sm tracking-wide text-[#cfcfcf] max-[820px]:hidden">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={resetSearch}
                  className={`rounded-full px-3 py-1 transition hover:bg-white/10 hover:text-white ${
                    activePath === item.href ? "text-white font-semibold" : ""
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
                    ? "w-[clamp(190px,22vw,240px)] rounded-full border border-white/15 bg-white/5 px-3"
                    : "w-9"
                }`}
                aria-label="搜尋"
                aria-expanded={searchInputOpen}
              >
                <svg
                  aria-hidden="true"
                  className="h-7.5 w-7.5 shrink-0"
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
            {!sessionLoading && session && (
              <div className="relative" ref={noticeRef}>
                <button
                  type="button"
                  onClick={() => setNoticeOpen((value) => !value)}
                  className="relative flex h-9 w-9 items-center justify-center text-white/70 transition hover:text-white"
                  aria-label="通知"
                  aria-expanded={noticeOpen}
                  aria-haspopup="menu"
                >
                  <svg
                    aria-hidden="true"
                    className="h-7.5 w-7.5"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path
                      d="M12 4a5 5 0 0 0-5 5v2.6c0 .6-.2 1.2-.6 1.7L5 15.2v.8h14v-.8l-1.4-1.9c-.4-.5-.6-1.1-.6-1.7V9a5 5 0 0 0-5-5z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9.5 18a2.5 2.5 0 0 0 5 0"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  {friendNoticeNew && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
                  )}
                </button>
                {noticeOpen && (
                  <div
                    className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-[#0b0b0c] p-3 text-xs text-white/60 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    role="menu"
                  >
                    {pendingFriendCount === 0 ? (
                      <span>目前沒有通知。</span>
                    ) : (
                      <div className="grid gap-1">
                        {pendingFriendCount > 0 && (
                          <Link
                            href="/friends"
                            className="block rounded-lg px-2 py-2 text-white/80 transition hover:bg-white/10 hover:text-white"
                            onClick={() => setNoticeOpen(false)}
                          >
                            {friendNoticeText}
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
                  className="relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/20 text-xs font-semibold text-white/80 transition hover:border-white/40 hover:text-white"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  {profileAvatarUrl ? (
                    <Image
                      src={profileAvatarUrl}
                      alt="使用者頭像"
                      fill
                      sizes="36px"
                      className="rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    userInitial
                  )}
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
                      onClick={() => {
                        setMenuOpen(false);
                        setSignOutOpen(true);
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

      {detailTarget && (
        <DetailModal
          open
          onClose={() => setDetailTarget(null)}
          mediaType={detailTarget.type}
          tmdbId={detailTarget.id}
          defaultTab="details"
          onWatchlistChange={handleDetailWatchlistChange}
        />
      )}
      {signOutLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 text-white">
          <div className="rounded-2xl border border-white/10 bg-[#0b0b0c] px-6 py-4 text-sm text-white/80">
            登出中...
          </div>
        </div>
      )}
      {signOutOpen && !signOutLoading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          onClick={() => setSignOutOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 text-left"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">確認登出</h3>
            <p className="mt-2 text-sm text-white/60">確定要登出嗎？</p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40"
                onClick={() => setSignOutOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                onClick={(event) =>
                  handleSignOut(event.currentTarget)
                }
              >
                確認登出
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
