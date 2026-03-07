"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import useAuth from "@/hooks/useAuth";
import useProfileNames from "@/hooks/useProfileNames";

const WEEK_DAYS = ["日", "一", "二", "三", "四", "五", "六"];

type CalendarDay = {
  date: Date;
  inMonth: boolean;
};

type WatchHistoryEntry = {
  history_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  watched_at: string;
  owner_id: string;
  companion_id: string | null;
};

type WatchlistItem = {
  tmdb_id: number;
  title: string;
  media_type: "movie" | "tv";
  is_anime: boolean;
};

type FriendEntry = {
  friend_id: string;
  friend_nickname: string | null;
};

type CalendarCard = {
  id: string;
  label: string;
  tone: "movie" | "tv" | "anime";
  participants: Array<{
    friend_id: string;
    is_owner: boolean;
  }>;
};

const buildMonthGrid = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const totalCells = startOffset + totalDays;
  const weekCount = Math.ceil(totalCells / 7);
  const rows: CalendarDay[][] = [];
  let dayCounter = 1;
  let nextMonthDay = 1;

  for (let week = 0; week < weekCount; week += 1) {
    const row: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if (week === 0 && weekday < startOffset) {
        const date = new Date(year, month - 1, prevMonthDays - (startOffset - weekday - 1));
        row.push({ date, inMonth: false });
      } else if (dayCounter > totalDays) {
        const date = new Date(year, month + 1, nextMonthDay);
        nextMonthDay += 1;
        row.push({ date, inMonth: false });
      } else {
        const date = new Date(year, month, dayCounter);
        dayCounter += 1;
        row.push({ date, inMonth: true });
      }
    }
    rows.push(row);
  }

  return rows;
};

export default function CalendarPage() {
  const now = new Date();
  const MIN_CALENDAR_HEIGHT = 680;
  const COMPACT_CALENDAR_BREAKPOINT = 1024;
  const [monthCursor, setMonthCursor] = useState(() => {
    const start = new Date();
    start.setDate(1);
    return start;
  });
  const { session, loading: sessionLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [isViewportSmall, setIsViewportSmall] = useState(false);
  const [desktopViewMode, setDesktopViewMode] = useState<"calendar" | "list">(
    "calendar",
  );
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState("all");
  const [cardsByDate, setCardsByDate] = useState<Record<string, CalendarCard[]>>(
    {},
  );
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
  const [isMonthJumping, setIsMonthJumping] = useState(false);
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const monthLabel = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
  }).format(monthCursor);
  const todayKey = now.toDateString();
  const calendarRows = buildMonthGrid(year, month);
  const effectiveViewMode = isViewportSmall ? "list" : desktopViewMode;
  const profileNameIds = Array.from(
    new Set([
      ...(session?.user.id ? [session.user.id] : []),
      ...friends.map((friend) => friend.friend_id),
    ]),
  );
  const profileNames = useProfileNames(profileNameIds);
  const listDateEntries = (() => {
    const monthDays = calendarRows
      .flat()
      .filter((day) => day.inMonth)
      .map((day) => day.date);
    const entries = monthDays.filter((date) => {
      const key = date.toDateString();
      return (cardsByDate[key]?.length ?? 0) > 0 || key === todayKey;
    });
    entries.sort((a, b) => b.getTime() - a.getTime());
    return entries.map((date) => {
      const key = date.toDateString();
      return {
        key,
        date,
        cards: cardsByDate[key] ?? [],
        isToday: key === todayKey,
      };
    });
  })();

  const resolveFriendName = (friend: FriendEntry) =>
    profileNames[friend.friend_id]?.nickname ||
    friend.friend_nickname ||
    `使用者-${friend.friend_id.slice(0, 6)}`;

  const resolveCompanionName = (userId: string) =>
    profileNames[userId]?.nickname ||
    friends.find((friend) => friend.friend_id === userId)?.friend_nickname ||
    `Friend ${userId.slice(0, 6)}`;

  const resolveAvatarUrl = (userId: string) =>
    profileNames[userId]?.avatarUrl || null;

  const getFriendInitial = (userId: string) =>
    (resolveCompanionName(userId).trim().charAt(0) || userId.charAt(0) || "?")
      .toUpperCase();

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) return;

    let isMounted = true;
    const loadFriends = async () => {
      setFriendsLoading(true);
      const response = await fetch("/api/calendar/friends", {
        cache: "no-store",
      });
      const payload = response.ok
        ? ((await response.json()) as { rows?: FriendEntry[] })
        : null;

      if (!isMounted) return;
      if (!response.ok) {
        setFriends([]);
      } else {
        setFriends(payload?.rows ?? []);
      }
      setFriendsLoading(false);
    };

    void loadFriends();

    return () => {
      isMounted = false;
    };
  }, [session, sessionLoading]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) return;

    let isMounted = true;
    const loadHistory = async () => {
      setLoading(true);
      const response = await fetch("/api/calendar/month-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, selectedFriendId }),
      });
      const payload = response.ok
        ? ((await response.json()) as {
            rows?: WatchHistoryEntry[];
            movie_items?: WatchlistItem[];
            tv_items?: WatchlistItem[];
          })
        : null;

      if (!isMounted) return;
      if (!response.ok) {
        setCardsByDate({});
        setLoading(false);
        return;
      }

      const entries = payload?.rows ?? [];
      if (entries.length === 0) {
        setCardsByDate({});
        setLoading(false);
        return;
      }

      const movieRows = payload?.movie_items ?? [];
      const tvRows = payload?.tv_items ?? [];

      const titleMap = new Map<string, string>();
      const tvAnimeMap = new Map<number, boolean>();
      movieRows.forEach((item) => {
        const title = item.title?.trim();
        if (title) titleMap.set(`movie:${item.tmdb_id}`, title);
      });
      tvRows.forEach((item) => {
        const title = item.title?.trim();
        if (title) titleMap.set(`tv:${item.tmdb_id}`, title);
        tvAnimeMap.set(item.tmdb_id, item.is_anime);
      });

      const nextMap: Record<string, CalendarCard[]> = {};
      const byDate: Record<string, WatchHistoryEntry[]> = {};
      entries.forEach((entry) => {
        const dateKey = new Date(entry.watched_at).toDateString();
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push(entry);
      });

      const buildEpisodeLabel = (season: number, episode: number) =>
        `S${season}E${episode}`;

      Object.entries(byDate).forEach(([dateKey, dayEntries]) => {
        const cards: CalendarCard[] = [];
        const eventMap = new Map<
          string,
          {
            historyId: string;
            tmdbId: number;
            mediaType: "movie" | "tv";
            ownerId: string;
            watchedAt: string;
            participants: Map<string, { friend_id: string; is_owner: boolean }>;
            seasons: Array<{ season: number; episode: number }>;
            episodeKeys: Set<string>;
          }
        >();

        dayEntries.forEach((entry) => {
          if (!eventMap.has(entry.history_id)) {
            eventMap.set(entry.history_id, {
              historyId: entry.history_id,
              tmdbId: entry.tmdb_id,
              mediaType: entry.media_type,
              ownerId: entry.owner_id,
              watchedAt: entry.watched_at,
              participants: new Map(),
              seasons: [],
              episodeKeys: new Set(),
            });
          }
          const event = eventMap.get(entry.history_id);
          event?.participants.set(entry.owner_id, {
            friend_id: entry.owner_id,
            is_owner: true,
          });
          if (entry.companion_id) {
            event?.participants.set(entry.companion_id, {
              friend_id: entry.companion_id,
              is_owner: false,
            });
          }
          if (entry.media_type !== "tv") return;
          const season =
            entry.season_number === null ? null : entry.season_number;
          const episode =
            entry.episode_number === null ? null : entry.episode_number;
          if (season === null || episode === null) return;
          const episodeKey = `${season}:${episode}`;
          if (!event?.episodeKeys.has(episodeKey)) {
            event?.episodeKeys.add(episodeKey);
            event?.seasons.push({ season, episode });
          }
        });

        const movieEvents = Array.from(eventMap.values()).filter(
          (event) => event.mediaType === "movie",
        );

        movieEvents.forEach((event) => {
          const title = titleMap.get(`movie:${event.tmdbId}`) || `TMDB ${event.tmdbId}`;
          cards.push({
            id: `movie:${event.historyId}:${dateKey}`,
            label: title,
            tone: "movie",
            participants: Array.from(event.participants.values()),
          });
        });

        const buildRanges = (sorted: Array<{ season: number; episode: number }>) => {
          if (sorted.length === 0) return [];
          const ranges: Array<{ start: { season: number; episode: number }; end: { season: number; episode: number } }> = [];
          let currentStart = sorted[0];
          let currentEnd = sorted[0];
          for (let i = 1; i < sorted.length; i += 1) {
            const prev = currentEnd;
            const next = sorted[i];
            const isSameSeason = prev.season === next.season;
            const isNextEpisode = isSameSeason && next.episode === prev.episode + 1;
            if (isNextEpisode) {
              currentEnd = next;
            } else {
              ranges.push({ start: currentStart, end: currentEnd });
              currentStart = next;
              currentEnd = next;
            }
          }
          ranges.push({ start: currentStart, end: currentEnd });
          return ranges;
        };

        const formatRange = (
          start: { season: number; episode: number },
          end: { season: number; episode: number },
          omitSeason: boolean,
        ) => {
          const prefix = omitSeason ? "" : `S${start.season}`;
          if (start.season === end.season) {
            if (start.episode === end.episode) {
              return `${prefix}E${start.episode}`;
            }
            return `${prefix}E${start.episode}–E${end.episode}`;
          }
          return `${buildEpisodeLabel(start.season, start.episode)}-${buildEpisodeLabel(
            end.season,
            end.episode,
          )}`;
        };

        const tvGroups = new Map<
          string,
          {
            tmdbId: number;
            seasons: Array<{ season: number; episode: number }>;
            participants: Map<string, { friend_id: string; is_owner: boolean }>;
          }
        >();

        Array.from(eventMap.values())
          .filter((event) => event.mediaType === "tv")
          .forEach((event) => {
            const participantSignature = Array.from(event.participants.keys())
              .sort()
              .join("|");
            const tvKey = [
              event.ownerId,
              event.tmdbId,
              participantSignature,
            ].join(":");
            if (!tvGroups.has(tvKey)) {
              tvGroups.set(tvKey, {
                tmdbId: event.tmdbId,
                seasons: [],
                participants: new Map(event.participants),
              });
            }
            const group = tvGroups.get(tvKey);
            event.seasons.forEach((seasonEntry) => {
              group?.seasons.push(seasonEntry);
            });
          });

        tvGroups.forEach((group, tvKey) => {
          const title = titleMap.get(`tv:${group.tmdbId}`) || `TMDB ${group.tmdbId}`;
          const sorted = group.seasons
            .slice()
            .sort((a, b) =>
              a.season === b.season ? a.episode - b.episode : a.season - b.season,
            );
          const ranges = buildRanges(sorted);
          const rangeLabel =
            ranges.length === 0
              ? "S?E?"
              : ranges
                  .map((range, rangeIndex) =>
                    formatRange(
                      range.start,
                      range.end,
                      rangeIndex > 0 &&
                        range.start.season === ranges[0].start.season,
                    ),
                  )
                  .join("、");

          const tone = tvAnimeMap.get(group.tmdbId) ? "anime" : "tv";
          cards.push({
            id: `tv:${tvKey}:${dateKey}`,
            label: `${title} ${rangeLabel}`,
            tone,
            participants: Array.from(group.participants.values()),
          });
        });

        nextMap[dateKey] = cards;
      });

      setCardsByDate(nextMap);
      setLoading(false);
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [month, selectedFriendId, session, sessionLoading, year]);

  useEffect(() => {
    const checkViewport = () => {
      setIsViewportSmall(
        window.innerWidth < COMPACT_CALENDAR_BREAKPOINT ||
          window.innerHeight < MIN_CALENDAR_HEIGHT,
      );
    };
    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => {
      window.removeEventListener("resize", checkViewport);
    };
  }, [
    COMPACT_CALENDAR_BREAKPOINT,
    MIN_CALENDAR_HEIGHT,
  ]);

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

  const showToast = useCallback(
    (message: string, tone: "error" | "success", anchorEl?: HTMLElement | null) => {
      const anchor = getToastAnchor(anchorEl);
      setToast({ message, tone, anchor });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 2000);
    },
    [getToastAnchor],
  );

  const fetchEdgeRecord = useCallback(
    async (
      table: "watch_history" | "watch_history_shares",
      boundary: string,
      direction: -1 | 1,
    ) => {
      const friendScope = table === "watch_history" ? "self" : selectedFriendId;
      const response = await fetch("/api/calendar/edge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedFriendId: friendScope,
          boundary,
          direction,
        }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { edge?: string | null };
      return payload.edge ?? null;
    },
    [selectedFriendId],
  );

  const findNextMonthWithRecords = useCallback(
    async (direction: -1 | 1, boundary: string) => {
      if (!session) return null;

      if (selectedFriendId === "self") {
        return fetchEdgeRecord("watch_history", boundary, direction);
      }

      if (selectedFriendId === "all") {
        const [ownEdge, shareEdge] = await Promise.all([
          fetchEdgeRecord("watch_history", boundary, direction),
          fetchEdgeRecord("watch_history_shares", boundary, direction),
        ]);
        if (!ownEdge && !shareEdge) return null;
        if (!ownEdge) return shareEdge;
        if (!shareEdge) return ownEdge;
        return direction === 1
          ? ownEdge < shareEdge
            ? ownEdge
            : shareEdge
          : ownEdge > shareEdge
            ? ownEdge
            : shareEdge;
      }

      return fetchEdgeRecord("watch_history_shares", boundary, direction);
    },
    [fetchEdgeRecord, selectedFriendId, session],
  );

  const handleMonthJump = async (
    direction: -1 | 1,
    anchorEl?: HTMLElement | null,
  ) => {
    if (!session || sessionLoading) return;
    if (isMonthJumping) return;
    setIsMonthJumping(true);

    const startDate = new Date(year, month, 1).toLocaleDateString("sv-SE");
    const nextMonthStart = new Date(year, month + 1, 1).toLocaleDateString(
      "sv-SE",
    );
    const boundary = direction === 1 ? nextMonthStart : startDate;

    const edge = await findNextMonthWithRecords(direction, boundary);
    if (!edge) {
      showToast("沒有可切換的月份。", "error", anchorEl);
      setIsMonthJumping(false);
      return;
    }

    const targetDate = new Date(edge);
    targetDate.setDate(1);
    const diffMonths =
      Math.abs(
        (targetDate.getFullYear() - year) * 12 + (targetDate.getMonth() - month),
      );

    if (diffMonths > 1) {
      showToast("已跳過沒有紀錄的月份。", "success", anchorEl);
    }

    setMonthCursor(targetDate);
    setIsMonthJumping(false);
  };

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
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
            className={toast.tone === "error" ? "text-red-300" : "text-emerald-300"}
          >
            {toast.message}
          </span>
        </div>
      )}
      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto h-full w-full pt-2">
          <div id="search-results-slot" className="mb-6" />
          <RequireAuthGate>
            <div className="page-content space-y-3">
              <div className="hidden min-h-[60vh] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 py-12 text-center text-white/80">
                <div className="max-w-md">
                  <p className="text-base font-semibold text-white">
                    視窗尺寸過小
                  </p>
                  <p className="mt-3 text-sm text-white/60">
                    行事曆需要更大的空間顯示完整內容，請放大視窗後再使用。
                  </p>
                </div>
              </div>
            
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-3xl font-semibold">{monthLabel}</h1>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                        <button
                          type="button"
                          onClick={(event) =>
                            handleMonthJump(-1, event.currentTarget)
                          }
                          className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/40 hover:text-white"
                          disabled={isMonthJumping}
                        >
                          上個月
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const next = new Date();
                            next.setDate(1);
                            setMonthCursor(next);
                          }}
                          className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/40 hover:text-white"
                        >
                          本月
                        </button>
                        <button
                          type="button"
                          onClick={(event) =>
                            handleMonthJump(1, event.currentTarget)
                          }
                          className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/40 hover:text-white"
                          disabled={isMonthJumping}
                        >
                          下個月
                        </button>
                        <div className="relative">
                          <select
                            id="calendar-friend-filter"
                            name="calendar-friend-filter"
                            value={selectedFriendId}
                            onChange={(event) => setSelectedFriendId(event.target.value)}
                            className="w-32 appearance-none min-[768px]:w-36 rounded-full border border-white/15 bg-black/30 px-3 py-1 pr-8 text-xs text-white/80 transition hover:border-white/40"
                          >
                            <option value="all">{"\u6240\u6709\u7d00\u9304"}</option>
                            <option value="self">{"\u81ea\u5df1\u55ae\u7368\u770b"}</option>

                            {friendsLoading && (
                              <option value="" disabled>
                                載入好友中...
                              </option>
                            )}
                            {!friendsLoading &&
                              friends.map((friend) => (
                                <option key={friend.friend_id} value={friend.friend_id}>
                                  {resolveFriendName(friend)}
                                </option>
                              ))}
                          </select>
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/40">
                            ▾
                          </span>
                        </div>
                        {!isViewportSmall && (
                          <div className="ml-1 inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1 text-white/60">
                            <button
                              type="button"
                              onClick={() => setDesktopViewMode("calendar")}
                              className={[
                                "rounded-full px-3 py-1 transition",
                                effectiveViewMode === "calendar"
                                  ? "bg-white text-black"
                                  : "hover:text-white",
                              ].join(" ")}
                            >
                              {"\u6708\u66c6"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDesktopViewMode("list")}
                              className={[
                                "rounded-full px-3 py-1 transition",
                                effectiveViewMode === "list"
                                  ? "bg-white text-black"
                                  : "hover:text-white",
                              ].join(" ")}
                            >
                              {"\u689d\u5217"}
                            </button>
                          </div>
                        )}
                        </div>
                      </div>
                    </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-white/70">
                    <div className="flex items-center gap-2 rounded-full border border-white/10 px-2 py-1">
                      <span className="h-2 w-2 rounded-full bg-yellow-500/70" />
                      電影
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-white/10 px-2 py-1">
                      <span className="h-2 w-2 rounded-full bg-red-500/70" />
                      影集
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-white/10 px-2 py-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500/70" />
                      動畫
                    </div>
                  </div>
                </div>

                {loading ? (
                <section className="flex min-h-[48vh] items-center justify-center">
                  <div className="flex items-center gap-3 text-sm text-white/65">
                    <span
                      className="h-4 w-4 animate-spin rounded-full border border-white/30 border-t-white/80"
                      aria-hidden="true"
                    />
                    {"\u8f09\u5165\u4e2d..."}
                  </div>
                </section>
                ) : effectiveViewMode === "calendar" ? (
                <section className="rounded-3xl border border-white/10 overflow-hidden">
                  <div className="grid grid-cols-7 border-b border-white/10 text-xs text-white/50">
                    {WEEK_DAYS.map((label) => (
                      <div
                        key={label}
                        className="px-3 py-2 text-center uppercase tracking-[0.25em]"
                      >
                        {label}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {calendarRows.flat().map((day, index) => {
                      const isToday = day.date.toDateString() === todayKey;
                      const col = index % 7;
                      return (
                        <div
                          key={day.date.toISOString()}
                          className={[
                            "relative flex min-h-35 flex-col border-b border-r border-white/10 px-3 pb-3 pt-2 transition",
                            day.inMonth
                              ? "bg-white/3"
                              : "bg-white/1.5 text-white/35",
                            isToday
                              ? "bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.45)]"
                              : "",
                            col === 6 ? "border-r-0" : "",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">
                              {day.date.getDate()}
                            </span>
                            {isToday && (
                              <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                                Today
                              </span>
                            )}
                          </div>
                          <div className="mt-3 space-y-2">
                            {(cardsByDate[day.date.toDateString()] ?? []).map(
                              (card) => (
                                <div
                                  key={card.id}
                                  className={[
                                    "rounded-xl px-3 py-2 text-xs text-white",
                                    card.tone === "movie"
                                      ? "bg-yellow-500/30"
                                      : card.tone === "anime"
                                        ? "bg-emerald-500/30"
                                        : "bg-red-500/30",
                                  ].join(" ")}
                                >
                                  {card.label}
                                </div>
                              ),
                            )}
                            {cardsByDate[day.date.toDateString()]?.length
                              ? null
                              : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
                ) : (
                  <section className="space-y-3">
                    {listDateEntries.length === 0 ? (
                      <div className="rounded-3xl border border-white/10 bg-white/3 px-5 py-12 text-center text-sm text-white/60">
                        {"\u9019\u500b\u6708\u9084\u6c92\u6709\u89c0\u770b\u7d00\u9304"}
                      </div>
                    ) : (
                      listDateEntries.map((entry) => (
                        <article
                          key={entry.key}
                          className="rounded-3xl border border-white/10 bg-white/3 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-lg font-semibold text-white">
                                {new Intl.DateTimeFormat("zh-TW", {
                                  month: "long",
                                  day: "numeric",
                                  weekday: "long",
                                }).format(entry.date)}
                              </p>
                            </div>
                          {entry.isToday && (
                            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                              Today
                            </span>
                          )}
                        </div>
                        {entry.cards.length > 0 ? (
                          <div className="mt-4 space-y-2">
                              {entry.cards.map((card) => (
                                <div
                                  key={card.id}
                                  className={[
                                    "rounded-2xl px-4 py-3 text-sm text-white",
                                    card.tone === "movie"
                                      ? "bg-yellow-500/20"
                                      : card.tone === "anime"
                                        ? "bg-emerald-500/20"
                                        : "bg-red-500/20",
                                  ].join(" ")}
                                >
                                  {(() => {
                                    const displayParticipants = card.participants.filter(
                                      (item) => item.friend_id !== session?.user.id,
                                    );
                                    return (
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">{card.label}</div>
                                        {displayParticipants.length > 0 && (
                                          <>
                                            <div className="flex shrink-0 items-center text-white/75 min-[768px]:hidden">
                                              <svg
                                                viewBox="0 0 20 20"
                                                aria-hidden="true"
                                                className="h-5 w-5"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.7"
                                              >
                                                <path
                                                  d="M6.75 8.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm6.5 1.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM3.75 15a3 3 0 0 1 6 0m1.5 0a2.25 2.25 0 0 1 4.5 0"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                />
                                              </svg>
                                            </div>
                                            <div className="hidden shrink-0 items-center gap-2 text-white/80 min-[768px]:flex min-[1024px]:hidden">
                                              <span className="whitespace-nowrap text-white/60">
                                                {"\u548c"}
                                              </span>
                                              {displayParticipants.map((item) => (
                                                <span
                                                  key={item.friend_id}
                                                  className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-white/5 text-[10px] font-semibold ${
                                                    item.is_owner
                                                      ? "border-amber-300 border-2 text-white"
                                                      : "border-white/15 text-white"
                                                  }`}
                                                  aria-hidden="true"
                                                >
                                                  {resolveAvatarUrl(item.friend_id) ? (
                                                    <Image
                                                      src={resolveAvatarUrl(item.friend_id) as string}
                                                      alt=""
                                                      fill
                                                      sizes="24px"
                                                      className="object-cover"
                                                    />
                                                  ) : (
                                                    getFriendInitial(item.friend_id)
                                                  )}
                                                </span>
                                              ))}
                                              <span className="whitespace-nowrap text-white/60">
                                                {"\u4e00\u8d77\u770b"}
                                              </span>
                                            </div>
                                            <div className="hidden shrink-0 items-center gap-2 text-white/80 min-[1024px]:flex">
                                              <span className="whitespace-nowrap text-white/60">
                                                {"\u548c"}
                                              </span>
                                              {displayParticipants.map((item) => (
                                                <span
                                                  key={item.friend_id}
                                                  className="flex items-center gap-2 text-white/80"
                                                >
                                                  <span
                                                    className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-white/5 text-[10px] font-semibold ${
                                                      item.is_owner
                                                        ? "border-amber-300 border-2 text-white"
                                                        : "border-white/15 text-white"
                                                    }`}
                                                    aria-hidden="true"
                                                  >
                                                    {resolveAvatarUrl(item.friend_id) ? (
                                                      <Image
                                                        src={resolveAvatarUrl(item.friend_id) as string}
                                                        alt=""
                                                        fill
                                                        sizes="24px"
                                                        className="object-cover"
                                                      />
                                                    ) : (
                                                      getFriendInitial(item.friend_id)
                                                    )}
                                                  </span>
                                                  <span
                                                    className={`whitespace-nowrap font-semibold ${
                                                      item.is_owner
                                                        ? "text-amber-300"
                                                        : "text-white"
                                                    }`}
                                                  >
                                                    {resolveCompanionName(item.friend_id)}
                                                  </span>
                                                </span>
                                              ))}
                                              <span className="whitespace-nowrap text-white/60">
                                                {"\u4e00\u8d77\u770b"}
                                              </span>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-3 text-sm text-white/45">
                              {"\u4eca\u5929\u9084\u6c92\u6709\u65b0\u7684\u89c0\u770b\u7d00\u9304"}
                            </div>
                          )}
                        </article>
                      ))
                    )}
                  </section>
                )}
              </div>
          </RequireAuthGate>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
