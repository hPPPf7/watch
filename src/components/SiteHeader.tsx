"use client";

import useAccountFetch from "@/hooks/useAccountFetch";
import useMediaSearch, { type SearchResult } from "@/features/site-header/useMediaSearch";
import SearchResultsPanel from "@/features/site-header/SearchResultsPanel";
import { clearWatchUserCache } from "@/lib/clearWatchUserCache";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import useAuth from "@/hooks/useAuth";
import useWatchRealtimeRefresh from "@/hooks/useWatchRealtimeRefresh";
import usePageActivityState from "@/hooks/usePageActivityState";
import usePendingFriendCount from "@/features/site-header/usePendingFriendCount";
import { WATCH_STATUS_REFRESH_EVENT } from "@/lib/watchStatusEvents";
import { markWatchlistDirty } from "@/lib/watchlistMutationEvents";
import MediaCard from "@/components/MediaCard";
import DetailModal from "@/components/DetailModal";

const navItems = [
  { label: "首頁", href: "/" },
  { label: "電影", href: "/movies" },
  { label: "影集", href: "/tv" },
  { label: "動畫", href: "/anime" },
  { label: "行事曆", href: "/calendar" },
];

const PRIVATE_BATCH_SIZE = 50;

type SiteHeaderProps = {
  showLoginLink?: boolean;
  homeCategory?: "movie" | "tv" | "anime";
  onHomeCategoryChange?: (category: "movie" | "tv" | "anime") => void;
};

export default function SiteHeader({
  showLoginLink = true,
  homeCategory,
  onHomeCategoryChange,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const activePath = pathname === "/login" ? "/" : pathname;
  const realtimeNoticePositionClass =
    pathname === "/calendar" ? "bottom-10 right-4" : "right-4 top-18";
  const menuActiveMap: Record<string, string> = {
    "/account": "帳戶",
    "/friends": "好友",
  };
  const activeMenuLabel = menuActiveMap[activePath];
  const fetch = useAccountFetch();
  const { session, loading: sessionLoading } = useAuth();
  const pageInactive = usePageActivityState({
    enabled: Boolean(session),
  });
  const [showRealtimeResumedNotice, setShowRealtimeResumedNotice] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [privateRetryToken, setPrivateRetryToken] = useState(0);
  const [watchlistError, setWatchlistError] = useState("");
  const [watchStatusError, setWatchStatusError] = useState("");
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [checkedWatchlistKeys, setCheckedWatchlistKeys] = useState<Set<string>>(new Set());
  const [watchStatusLoading, setWatchStatusLoading] = useState(false);
  const [pendingWatchlist, setPendingWatchlist] = useState<Set<string>>(new Set());
  const pendingWatchlistRef = useRef(new Set<string>());
  const watchlistVersionsRef = useRef(new Map<string, number>());
  const statusRequestRef = useRef(0);
  const watchlistRequestRef = useRef(0);
  const statusPendingRef = useRef(0);
  const watchlistPendingRef = useRef(0);
  const privateResultKeysRef = useRef(new Set<string>());
  const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  const [searchInputOpen, setSearchInputOpen] = useState(false);
  const searchOpen = searchInputOpen && query.trim().length > 0;
  const mediaSearch = useMediaSearch(query, searchInputOpen, isComposing);
  const { results, loading: searchLoading } = mediaSearch;
  const [noticeOpen, setNoticeOpen] = useState(false);
  const pendingFriendCount = usePendingFriendCount({ session, sessionLoading });
  const friendNoticeActive = pendingFriendCount > 0;
  const [detailTarget, setDetailTarget] = useState<{
    id: number;
    type: "movie" | "tv";
  } | null>(null);
  const [searchWatchlistMap, setSearchWatchlistMap] = useState<
    Record<string, boolean>
  >({});
  const [searchWatchStatusMap, setSearchWatchStatusMap] = useState<
    Record<string, "completed" | "watching">
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
  const previousPageInactiveRef = useRef(pageInactive);
  const resumedNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setProfileAvatarUrl(null);
      return;
    }

    let isMounted = true;
    const loadProfile = async () => {
      const response = await fetch("/api/profile/me", { cache: "no-store" });
      const fallbackAvatar =
        session.user.user_metadata?.avatar_url ||
        session.user.user_metadata?.picture ||
        session.user.user_metadata?.avatar ||
        null;
      if (!isMounted) return;
      if (!response.ok) {
        setProfileAvatarUrl(fallbackAvatar);
        return;
      }
      const data = (await response.json()) as { avatarUrl?: string | null };
      setProfileAvatarUrl(data.avatarUrl ?? fallbackAvatar);
    };

    loadProfile().catch(() => {
      if (!isMounted) return;
      const fallbackAvatar =
        session.user.user_metadata?.avatar_url ||
        session.user.user_metadata?.picture ||
        session.user.user_metadata?.avatar ||
        null;
      setProfileAvatarUrl(fallbackAvatar);
    });

    return () => {
      isMounted = false;
    };
  }, [fetch, session, sessionLoading]);

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
    if (!session) {
      if (resumedNoticeTimerRef.current) {
        window.clearTimeout(resumedNoticeTimerRef.current);
        resumedNoticeTimerRef.current = null;
      }
      setShowRealtimeResumedNotice(false);
      previousPageInactiveRef.current = pageInactive;
      return;
    }

    const wasInactive = previousPageInactiveRef.current;
    previousPageInactiveRef.current = pageInactive;

    if (!wasInactive || pageInactive) {
      return;
    }

    setShowRealtimeResumedNotice(true);
    if (resumedNoticeTimerRef.current) {
      window.clearTimeout(resumedNoticeTimerRef.current);
    }
    resumedNoticeTimerRef.current = window.setTimeout(() => {
      setShowRealtimeResumedNotice(false);
      resumedNoticeTimerRef.current = null;
    }, 2500);
  }, [pageInactive, session]);

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

  useEffect(
    () => () => {
      if (resumedNoticeTimerRef.current) {
        window.clearTimeout(resumedNoticeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setSearchSlot(document.getElementById("search-results-slot"));
  }, []);

  useEffect(() => {
    if (!searchInputOpen) return;
    searchInputRef.current?.focus();
  }, [searchInputOpen, query]);

  useEffect(() => {
    if (!searchInputOpen) return;
    setNavMenuOpen(false);
    setMenuOpen(false);
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
  }, [searchInputOpen, query]);

  useEffect(() => {
    setQuery("");
    setIsComposing(false);
    setSearchInputOpen(false);
  }, [pathname]);

  const resetSearch = () => {
    setQuery("");
    setIsComposing(false);
    setSearchInputOpen(false);
  };

  const closeSearch = useCallback(() => {
    setSearchInputOpen(false);
    setIsComposing(false);
    searchButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!searchInputOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229 || detailTarget || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      event.preventDefault();
      closeSearch();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, detailTarget, searchInputOpen]);

  const privateQuery = query.trim();
  const hasSearchResults = results.length > 0;
  useLayoutEffect(() => {
    const resultKeys = privateResultKeysRef.current;
    resultKeys.clear();
    statusPendingRef.current = 0;
    watchlistPendingRef.current = 0;
    setWatchStatusLoading(false);
    setWatchlistLoading(false);
    setCheckedWatchlistKeys(new Set());
    setWatchStatusError("");
    setWatchlistError("");
    return () => {
      statusRequestRef.current += 1;
      watchlistRequestRef.current += 1;
      resultKeys.clear();
    };
  }, [privateQuery, searchOpen, hasSearchResults, session?.user.id, privateRetryToken]);

  const getToastAnchor = useCallback((el?: HTMLElement | null) => {
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
  }, []);

  const showToast = useCallback((
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
  }, [getToastAnchor]);

  const buildWatchlistKey = (
    type: "movie" | "tv",
    id: number,
    isAnime: boolean,
  ) => `${type}:${isAnime ? "anime" : "series"}:${id}`;

  const handleDetailWatchlistChange = (
    inWatchlist: boolean,
    detail: { id: number; media_type: "movie" | "tv"; is_anime: boolean },
    affectedIsAnime?: boolean[],
  ) => {
    const mutationKey = `${detail.media_type}:${detail.id}`;
    watchlistVersionsRef.current.set(mutationKey, (watchlistVersionsRef.current.get(mutationKey) ?? 0) + 1);
    const key = buildWatchlistKey(detail.media_type, detail.id, detail.is_anime);
    setSearchWatchlistMap((previous) => {
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
    if (typeof document === "undefined") return;
    if (searchOpen) {
      document.body.dataset.searchOpen = "true";
    } else {
      delete document.body.dataset.searchOpen;
    }
    return () => { delete document.body.dataset.searchOpen; };
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

    const key = buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime);
    const mutationKey = `${item.media_type}:${item.id}`;
    if (pendingWatchlistRef.current.has(mutationKey) || searchWatchlistMap[key] === undefined) return;
    const isActive = searchWatchlistMap[key];
    pendingWatchlistRef.current.add(mutationKey);
    setPendingWatchlist(new Set(pendingWatchlistRef.current));
    watchlistVersionsRef.current.set(mutationKey, (watchlistVersionsRef.current.get(mutationKey) ?? 0) + 1);
    try {
      const response = await fetch("/api/home/watchlist-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isActive ? "remove" : "add", item: {
          type: item.media_type, id: item.id, title: item.title, year: item.year,
          releaseDate: item.media_type === "movie" ? item.release_date : null,
          posterPath: item.poster_path, isAnime: item.is_anime,
        } }),
      });
      const payload = (await response.json()) as { message?: string; affectedIsAnime?: boolean[] };
      if (!response.ok) {
        showToast(payload.message?.includes("watch_history_exists") ? "已有觀看紀錄，無法移除清單。" : isActive ? "移除失敗，請稍後再試。" : "加入失敗，請稍後再試。", "error", anchorEl);
        return;
      }
      watchlistVersionsRef.current.set(mutationKey, (watchlistVersionsRef.current.get(mutationKey) ?? 0) + 1);
      setSearchWatchlistMap((previous) => {
        const next = { ...previous, [key]: !isActive };
        // Adding can reclassify TV; affected scopes include the old category.
        for (const affected of payload.affectedIsAnime ?? []) {
          next[buildWatchlistKey(item.media_type, item.id, affected)] = !isActive && (item.media_type === "movie" || affected === item.is_anime);
        }
        return next;
      });
      markWatchlistDirty({ userId: session.user.id, mediaType: item.media_type, isAnime: item.media_type === "tv" && item.is_anime }, payload.affectedIsAnime);
      showToast(isActive ? "已從清單移除。" : "已加入清單。", "success", anchorEl);
    } catch (error) {
      if ((error as Error).name !== "AbortError") showToast("清單更新失敗，請稍後再試。", "error", anchorEl);
    } finally {
      pendingWatchlistRef.current.delete(mutationKey);
      setPendingWatchlist(new Set(pendingWatchlistRef.current));
    }
  };

  const loadWatchStatusTargets = useCallback(async (targets: SearchResult[], fullRefresh: boolean) => {
    if (!session || targets.length === 0) return;
    if (fullRefresh) {
      statusRequestRef.current += 1;
      statusPendingRef.current = 0;
      setWatchStatusError("");
    }
    const request = statusRequestRef.current;
    statusPendingRef.current += 1;
    setWatchStatusLoading(true);
    try {
      for (let offset = 0; offset < targets.length; offset += PRIVATE_BATCH_SIZE) {
        if (request !== statusRequestRef.current) return;
        const batch = targets.slice(offset, offset + PRIVATE_BATCH_SIZE);
        const movieIds: number[] = [];
        const tvIds: number[] = [];
        const animeIds: number[] = [];
        for (const item of batch) {
          if (item.media_type === "movie") movieIds.push(item.id);
          else if (item.is_anime) animeIds.push(item.id);
          else tvIds.push(item.id);
        }
        try {
          const response = await fetch("/api/home/watch-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ movieIds, tvIds, animeIds }),
          });
          if (!response.ok) throw new Error("Watch status unavailable");
          const payload = (await response.json()) as {
            statusMap?: Record<string, "completed" | "watching">;
          };
          if (!payload.statusMap || typeof payload.statusMap !== "object" || Array.isArray(payload.statusMap)) {
            throw new Error("Watch status invalid");
          }
          if (request !== statusRequestRef.current) return;
          setSearchWatchStatusMap((previous) => {
            if (request !== statusRequestRef.current) return previous;
            const next = { ...previous };
            for (const item of batch) {
              const key = buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime);
              delete next[key];
              const status = payload.statusMap![key];
              if (status === "completed" || status === "watching") next[key] = status;
            }
            return next;
          });
        } catch (error) {
          if (request === statusRequestRef.current && (error as Error).name !== "AbortError") {
            setWatchStatusError("觀看狀態讀取失敗，已有資料會先保留。");
          }
        }
      }
    } finally {
      if (request === statusRequestRef.current) {
        statusPendingRef.current -= 1;
        setWatchStatusLoading(statusPendingRef.current > 0);
      }
    }
  }, [fetch, session]);

  const loadWatchStatus = useCallback(async () => {
    if (!searchOpen) return;
    await loadWatchStatusTargets(results, true);
  }, [loadWatchStatusTargets, results, searchOpen]);

  useEffect(() => {
    if (sessionLoading || !session || !searchOpen || results.length === 0) return;
    const fullRefresh = privateResultKeysRef.current.size === 0;
    const targets = results.filter((item) => {
      const key = buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime);
      if (privateResultKeysRef.current.has(key)) return false;
      privateResultKeysRef.current.add(key);
      return true;
    });
    if (targets.length === 0) return;

    // Appends share a generation: an earlier page may still be loading. Only a
    // scope change or full refresh supersedes requests for already loaded pages.
    if (fullRefresh) {
      watchlistRequestRef.current += 1;
      watchlistPendingRef.current = 0;
      setWatchlistError("");
    }
    const request = watchlistRequestRef.current;
    const versions = new Map(watchlistVersionsRef.current);
    watchlistPendingRef.current += 1;
    setWatchlistLoading(true);

    const loadWatchlist = async (ids: number[], type: "movie" | "tv", isAnime: boolean) => {
      if (ids.length === 0) return;
      const response = await fetch("/api/home/watchlist-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaType: type, isAnime, ids }),
      });
      if (!response.ok) throw new Error("Watchlist unavailable");
      const payload = (await response.json()) as { activeIds?: number[] };
      if (!Array.isArray(payload.activeIds)) throw new Error("Watchlist invalid");
      if (request !== watchlistRequestRef.current) return;
      const idSet = new Set(payload.activeIds);
      setSearchWatchlistMap((previous) => {
        if (request !== watchlistRequestRef.current) return previous;
        const next = { ...previous };
        for (const id of ids) {
          const mutationKey = `${type}:${id}`;
          if (pendingWatchlistRef.current.has(mutationKey) || versions.get(mutationKey) !== watchlistVersionsRef.current.get(mutationKey)) continue;
          next[buildWatchlistKey(type, id, isAnime)] = idSet.has(id);
        }
        return next;
      });
    };

    void (async () => {
      try {
        for (let offset = 0; offset < targets.length; offset += PRIVATE_BATCH_SIZE) {
          if (request !== watchlistRequestRef.current) return;
          const batch = targets.slice(offset, offset + PRIVATE_BATCH_SIZE);
          const outcomes = await Promise.allSettled([
            loadWatchlist(batch.filter((item) => item.media_type === "movie").map((item) => item.id), "movie", false),
            loadWatchlist(batch.filter((item) => item.media_type === "tv" && !item.is_anime).map((item) => item.id), "tv", false),
            loadWatchlist(batch.filter((item) => item.media_type === "tv" && item.is_anime).map((item) => item.id), "tv", true),
          ]);
          if (request === watchlistRequestRef.current && outcomes.some((outcome) => outcome.status === "rejected" && outcome.reason?.name !== "AbortError")) {
            setWatchlistError("清單狀態讀取失敗，已有資料會先保留。");
          }
        }
      } finally {
        if (request === watchlistRequestRef.current) {
          watchlistPendingRef.current -= 1;
          setCheckedWatchlistKeys((previous) => {
            if (request !== watchlistRequestRef.current) return previous;
            const next = new Set(previous);
            for (const item of targets) {
              next.add(buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime));
            }
            return next;
          });
          setWatchlistLoading(watchlistPendingRef.current > 0);
        }
      }
    })();
    void loadWatchStatusTargets(targets, fullRefresh);
  }, [sessionLoading, session, searchOpen, results, loadWatchStatusTargets, fetch, privateRetryToken, privateQuery]);

  useEffect(() => {
    if (!session) return;
    if (!searchOpen) return;
    const handleRefresh = () => {
      void loadWatchStatus();
    };
    window.addEventListener(WATCH_STATUS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(WATCH_STATUS_REFRESH_EVENT, handleRefresh);
    };
  }, [loadWatchStatus, searchOpen, session]);

  useWatchRealtimeRefresh(loadWatchStatus, {
    enabled: Boolean(session) && searchOpen && results.length > 0,
    runOnMount: false,
    fallbackIntervalMs: 60 * 1000,
    connectedIntervalMs: null,
    pauseWhenHidden: true,
  });

  const handleSignOut = async (anchorEl?: HTMLButtonElement | null) => {
    if (anchorEl) {
      toastAnchorRef.current = anchorEl;
    }
    setMenuOpen(false);
    setSignOutLoading(true);
    const currentUserId = session?.user?.id ?? "";

    try {
      await signOut({ redirect: false });

      if (typeof window !== "undefined") {
        clearWatchUserCache(currentUserId);
        const storageKeys = [
          ...Object.keys(window.localStorage),
          ...Object.keys(window.sessionStorage),
        ];
        storageKeys.forEach((key) => {
          const isAuthKey =
            key.includes("auth-token") || key.includes("next-auth");
          if (isAuthKey) {
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
      : `有未處理的好友邀請（${pendingFriendCount} 筆）`;

  const hasUnknownWatchlist = Boolean(session) && results.some((item) =>
    searchWatchlistMap[buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime)] === undefined,
  );
  const currentWatchlistChecked = results.every((item) =>
    checkedWatchlistKeys.has(buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime)),
  );
  const privateStatusLoading = watchlistLoading || watchStatusLoading || !currentWatchlistChecked;
  const showUnknownWatchlist = hasUnknownWatchlist && currentWatchlistChecked && !watchlistLoading && pendingWatchlist.size === 0;
  const searchResultsPanel = searchOpen ? (
    <SearchResultsPanel
      query={query.trim()}
      results={results}
      loading={searchLoading}
      loadingStatus={!searchLoading && session && results.length > 0 && !watchlistError && !watchStatusError && privateStatusLoading ? "正在確認清單與觀看狀態…" : null}
      error={mediaSearch.error}
      onRetry={mediaSearch.retry}
      hasMore={mediaSearch.hasMore}
      loadingMore={mediaSearch.loadingMore}
      moreError={mediaSearch.moreError}
      onLoadMore={mediaSearch.loadMore}
      renderCard={(item) => (
        <MediaCard
          presentation="search"
          title={item.title}
          subtitle={`${item.media_type === "movie" ? "電影" : item.is_anime ? "動畫" : "影集"}${item.year ? ` · ${item.year}` : ""}`}
          posterPath={item.poster_path}
          onClick={() => handleSelectResult(item)}
          showWatchlistToggle
          watchlistPending={pendingWatchlist.has(`${item.media_type}:${item.id}`)}
          watchlistUnknown={sessionLoading || (Boolean(session) && searchWatchlistMap[buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime)] === undefined)}
          watchlistActive={searchWatchlistMap[buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime)]}
          statusBadge={(() => {
            const status = searchWatchStatusMap[buildWatchlistKey(item.media_type, item.id, item.media_type === "tv" && item.is_anime)];
            return status ? { label: status === "completed" ? "已看完" : "未看完", tone: status === "completed" ? "green" : "blue" } : null;
          })()}
          onToggleWatchlist={(anchorEl) => handleToggleWatchlist(item, anchorEl)}
        />
      )}
    >
      {!searchLoading && session && results.length > 0 && (watchlistError || watchStatusError || showUnknownWatchlist) && (
        <div role="alert" className={`mb-4 flex flex-wrap items-center gap-3 text-sm ${watchlistError || watchStatusError ? "text-watch-error" : "text-watch-warning"}`}>
          <span>{watchlistError || watchStatusError || "清單狀態待確認，請重試。"}</span>
          <button type="button" className="watch-button watch-button--small" disabled={privateStatusLoading} aria-busy={privateStatusLoading} onClick={() => setPrivateRetryToken((value) => value + 1)}><span className="watch-spinner-slot" aria-hidden="true">{privateStatusLoading && <span className="watch-spinner" />}</span>重試</button>
        </div>
      )}
    </SearchResultsPanel>
  ) : null;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-watch-border-subtle bg-watch-bg">
        <div className="flex h-16 w-full items-center gap-6 px-8 max-[820px]:px-4">
          <div
            className={`flex min-w-0 flex-1 items-center gap-4 pl-2 max-[820px]:pl-0 ${
              searchInputOpen ? "max-[820px]:hidden" : ""
            }`}
          >
            <div className="relative hidden max-[640px]:flex" ref={navMenuRef}>
              <button
                type="button"
                onClick={() => setNavMenuOpen((value) => !value)}
                className="watch-button gap-2.5 whitespace-nowrap"
                aria-expanded={navMenuOpen}
                aria-haspopup="menu"
              >
                {activeNavLabel}
                <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
                {navMenuOpen && (
                  <div
                    className="absolute left-0 top-full mt-2 w-40 rounded-xl border border-watch-border-subtle bg-watch-popover p-2 text-xs text-watch-text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    role="menu"
                  >
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      onClick={() => {
                        resetSearch();
                        setNavMenuOpen(false);
                      }}
                      className={`flex min-h-8 items-center rounded-md px-3 py-1.5 hover:bg-watch-hover ${
                        activePath === item.href
                          ? "bg-watch-selected text-watch-text font-semibold"
                          : ""
                      }`}
                      role="menuitem"
                      aria-current={activePath === item.href ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <nav aria-label="主要導覽" className="flex min-w-0 items-center gap-2 text-sm max-[820px]:gap-0.5 max-[640px]:hidden">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={resetSearch}
                  aria-current={activePath === item.href ? "page" : undefined}
                  className={`relative flex h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.25 py-3 leading-5 transition-colors hover:bg-watch-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-watch-focus after:pointer-events-none after:absolute after:inset-x-3.25 after:bottom-0.75 after:h-0.5 after:rounded-full after:content-[''] max-[820px]:px-2.5 max-[820px]:after:inset-x-2.5 ${
                    activePath === item.href
                      ? "font-semibold text-watch-text after:bg-watch-progress"
                      : "text-watch-text-muted after:bg-transparent"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div
            className={`ml-auto flex items-center gap-3 ${
              searchInputOpen ? "max-[820px]:w-full max-[820px]:gap-0" : ""
            }`}
          >
            <div
              className={`relative ${searchInputOpen ? "max-[820px]:flex-1" : ""}`}
              ref={searchPanelRef}
            >
              <div className={`flex h-9 items-center text-watch-text-secondary ${searchInputOpen ? "watch-input-group w-[clamp(230px,25vw,280px)] rounded-full border border-watch-border bg-watch-field px-3 max-[820px]:w-full" : "w-9"}`}>
                <button
                  type="button"
                  ref={searchButtonRef}
                  onClick={() => { if (searchInputOpen) closeSearch(); else setSearchInputOpen(true); }}
                  className="flex h-9 w-8 shrink-0 items-center justify-center transition enabled:hover:text-watch-text"
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
                </button>
                {searchInputOpen && (
                  <>
                    <input
                      ref={searchInputRef}
                      type="search"
                      id="site-search"
                      name="site-search"
                      aria-label="搜尋作品"
                      placeholder="搜尋"
                      className="ml-2 h-8 min-w-0 flex-1 bg-transparent text-sm text-watch-text outline-none placeholder:text-watch-text-muted"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onCompositionStart={() => setIsComposing(true)}
                      onCompositionEnd={(event) => {
                        setQuery(event.currentTarget.value);
                        setIsComposing(false);
                      }}
                    />
                    <button type="button" onClick={closeSearch} className="ml-2 shrink-0 text-xs text-watch-text-secondary enabled:hover:text-watch-text">取消</button>
                  </>
                )}
              </div>
            </div>
            {false && !sessionLoading && session && (
              <div
                className={`relative ${
                  searchInputOpen ? "max-[820px]:hidden" : ""
                }`}
                ref={noticeRef}
              >
                <button
                  type="button"
                  onClick={() => setNoticeOpen((value) => !value)}
                  className="relative flex h-9 w-9 items-center justify-center text-watch-text-secondary transition enabled:hover:text-watch-text"
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
                  {friendNoticeActive && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-watch-warning" />
                  )}
                </button>
                {noticeOpen && (
                  <div
                    className="absolute right-0 mt-2 w-56 rounded-xl border border-watch-border-subtle bg-watch-popover p-3 text-xs text-watch-text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    role="menu"
                  >
                    {pendingFriendCount === 0 ? (
                      <span>目前沒有通知。</span>
                    ) : (
                      <div className="grid gap-1">
                        {pendingFriendCount > 0 && (
                          <Link
                            href="/friends"
                            prefetch={false}
                            className="block rounded-lg px-2 py-2 text-watch-text transition hover:bg-watch-hover hover:text-watch-text"
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
                className={`flex h-9 w-9 items-center justify-center rounded-full border border-watch-border-subtle bg-watch-surface ${
                  searchInputOpen ? "max-[820px]:hidden" : ""
                }`}
                role="status"
                aria-label="確認登入狀態中"
              >
                <span className="watch-spinner" aria-hidden="true" />
              </div>
            )}
            {!sessionLoading && !session && showLoginLink && (
              <Link
                href="/login"
                prefetch={false}
                className={`watch-button ${
                  searchInputOpen ? "max-[820px]:hidden" : ""
                }`}
              >
                登入
              </Link>
            )}
            {!sessionLoading && session && (
              <div
                className={`relative ${
                  searchInputOpen ? "max-[820px]:hidden" : ""
                }`}
                ref={menuRef}
              >
                <button
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-watch-border text-xs font-semibold text-watch-text transition enabled:hover:border-watch-text-muted enabled:hover:text-watch-text"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  {pendingFriendCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 z-10 h-2.5 w-2.5 rounded-full bg-watch-warning" />
                  )}
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
                    className="absolute right-0 z-60 mt-2 w-24 rounded-xl border border-watch-border-subtle bg-watch-popover p-2 text-xs text-watch-text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    role="menu"
                  >
                    <Link
                      href="/account"
                      prefetch={false}
                      className={`flex min-h-8 items-center rounded-md px-3 py-1.5 hover:bg-watch-hover ${
                        activeMenuLabel === "帳戶"
                          ? "bg-watch-selected text-watch-text font-semibold"
                          : ""
                      }`}
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      帳戶
                    </Link>
                    <div className="my-1 h-px bg-white/10" aria-hidden="true" />
                    <Link
                      href="/friends"
                      prefetch={false}
                      className={`mt-1 flex min-h-8 items-center justify-between rounded-md px-3 py-1.5 hover:bg-watch-hover ${
                        activeMenuLabel === "好友"
                          ? "bg-watch-selected text-watch-text font-semibold"
                          : ""
                      }`}
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                    >
                      好友
                      {pendingFriendCount > 0 && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-watch-warning"
                          aria-hidden="true"
                        />
                      )}
                    </Link>
                    <div className="my-1 h-px bg-white/10" aria-hidden="true" />
                    <button
                      type="button"
                      className="mt-1 flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-watch-text-secondary enabled:hover:bg-watch-hover"
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
              <span
                className={`inline-flex min-h-9 items-center rounded-lg border border-watch-border px-3 text-xs text-watch-text-muted ${
                  searchInputOpen ? "max-[820px]:hidden" : ""
                }`}
              >
                登入
              </span>
            )}
          </div>
        </div>
      </header>

      {session && pageInactive ? (
        <div
          className={`fixed z-30 rounded-full border border-watch-warning/30 bg-watch-popover px-3 py-1.5 text-xs text-watch-warning shadow-[0_8px_24px_rgba(0,0,0,0.35)] ${realtimeNoticePositionClass}`}
        >
          已暫停即時同步，重新操作後會恢復接收更新
        </div>
      ) : null}

      {session && !pageInactive && showRealtimeResumedNotice ? (
        <div
          className={`fixed z-30 rounded-full border border-watch-complete/30 bg-watch-popover px-3 py-1.5 text-xs text-watch-complete shadow-[0_8px_24px_rgba(0,0,0,0.35)] ${realtimeNoticePositionClass}`}
        >
          已恢復即時同步，有更新時會自動通知
        </div>
      ) : null}

      {showHomeSubnav && !searchOpen && (
        <div className="home-subnav fixed inset-x-0 top-16 z-10 border-b border-watch-border-subtle bg-watch-bg">
            <div className="flex h-11 w-full items-center justify-center gap-3 px-8 text-xs text-watch-text-secondary max-sm:gap-2 max-sm:px-4">
              <button
                type="button"
                onClick={() => {
                  resetSearch();
                  onHomeCategoryChange?.("movie");
                }}
                aria-pressed={homeCategory === "movie"}
                className={`watch-button watch-button--small watch-button--quiet min-w-22 ${
                  homeCategory === "movie"
                    ? "border-transparent bg-watch-selected text-watch-text"
                    : "border-transparent text-watch-text-muted enabled:hover:bg-watch-hover enabled:hover:text-watch-text"
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
                aria-pressed={homeCategory === "tv"}
                className={`watch-button watch-button--small watch-button--quiet min-w-22 ${
                  homeCategory === "tv"
                    ? "border-transparent bg-watch-selected text-watch-text"
                    : "border-transparent text-watch-text-muted enabled:hover:bg-watch-hover enabled:hover:text-watch-text"
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
                aria-pressed={homeCategory === "anime"}
                className={`watch-button watch-button--small watch-button--quiet min-w-22 ${
                  homeCategory === "anime"
                    ? "border-transparent bg-watch-selected text-watch-text"
                    : "border-transparent text-watch-text-muted enabled:hover:bg-watch-hover enabled:hover:text-watch-text"
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

      {detailTarget && (
        <DetailModal
          open
          onClose={() => setDetailTarget(null)}
          mediaType={detailTarget.type}
          tmdbId={detailTarget.id}
          defaultTab="details"
          onWatchlistChange={handleDetailWatchlistChange}
          onWatchDateChange={() => {
            loadWatchStatus().catch(() => undefined);
          }}
          onEpisodeHistoryChange={() => {
            loadWatchStatus().catch(() => undefined);
          }}
        />
      )}
      {signOutLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 text-watch-text">
          <div className="watch-loading rounded-2xl border border-watch-border-subtle bg-watch-popover px-6 py-4 text-sm" role="status">
            <span className="watch-spinner" aria-hidden="true" />
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
            className="w-full max-w-md rounded-2xl border border-watch-border-subtle bg-watch-popover p-6 text-left"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-watch-text">確認登出</h3>
            <p className="mt-2 text-sm text-watch-text-secondary">確定要登出嗎？</p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="watch-button"
                onClick={() => setSignOutOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="watch-button watch-button--primary"
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
