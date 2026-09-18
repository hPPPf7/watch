"use client";

import useAccountFetch from "@/hooks/useAccountFetch";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import useAuth from "@/hooks/useAuth";
import useProfileNames from "@/hooks/useProfileNames";
import useWatchRealtimeRefresh from "@/hooks/useWatchRealtimeRefresh";
import {
  extractDateOnlyKey,
  getCalendarGridRange,
  formatLocalDateKey,
  parseDateOnlyKeyToLocalDate,
} from "@/lib/calendarDate";
import CalendarMonthView, { CalendarParticipants, type CalendarMonthCard } from "@/components/CalendarMonthView";

const TITLE_LOOKUP_FAILURE_RETRY_MS = 6 * 60 * 60 * 1000;

const CALENDAR_HISTORY_REFRESH_REASONS = new Set([
  "history_upsert",
  "history_delete",
  "history_sync_shares",
  "friend_remove_history_share",
  "account_delete_history_share_cleanup",
  "account_delete_site_history_share_cleanup",
]);

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

type SharedTitle = {
  title: string | null;
  is_anime: boolean;
  refresh_after_ms?: number;
};

type CalendarCard = {
  id: string;
  // 跨日識別用：不含日期，連續日期的同一部作品（同 owner、同參與者）會共用同一個值，
  // 月曆才能把它們排進同一條車道並接成一條 bar。
  groupKey: string;
  // 查共用標題用的 key（movie:123 / tv:456），跨月份、跨清單都是同一個。
  mediaKey: string;
  // month-data 內嵌的標題。階段 2 會把它從 API 拿掉，屆時這裡恆為 null。
  fallbackTitle: string | null;
  // 集數範圍；電影沒有集數，是空字串。
  detail: string;
  tone: "movie" | "tv" | "anime";
  participants: Array<{
    friend_id: string;
    is_owner: boolean;
  }>;
};

// 卡片與「畫面外延續探針」必須算出一模一樣的 key，所以只留這一份公式。
const buildCardGroupKey = (
  mediaType: "movie" | "tv",
  ownerId: string,
  tmdbId: number,
  participantIds: Iterable<string>,
) =>
  `${mediaType}:${ownerId}:${tmdbId}:${Array.from(participantIds).sort().join("|")}`;

// 可見範圍外一天的裸紀錄沒有標題，只需要還原出 groupKey 來比對是否延續。
const collectGroupKeys = (entries: WatchHistoryEntry[]) => {
  const events = new Map<
    string,
    {
      mediaType: "movie" | "tv";
      ownerId: string;
      tmdbId: number;
      participants: Set<string>;
    }
  >();

  entries.forEach((entry) => {
    let event = events.get(entry.history_id);
    if (!event) {
      event = {
        mediaType: entry.media_type,
        ownerId: entry.owner_id,
        tmdbId: entry.tmdb_id,
        participants: new Set<string>(),
      };
      events.set(entry.history_id, event);
    }
    event.participants.add(entry.owner_id);
    if (entry.companion_id) event.participants.add(entry.companion_id);
  });

  return new Set(
    Array.from(events.values()).map((event) =>
      buildCardGroupKey(
        event.mediaType,
        event.ownerId,
        event.tmdbId,
        event.participants,
      ),
    ),
  );
};

const buildMonthGrid = (year: number, month: number) => {
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const { weekCount } = getCalendarGridRange(year, month);
  const startOffset = new Date(year, month, 1).getDay();
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
  const fetch = useAccountFetch();
  const { session, loading: sessionLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [friendsError, setFriendsError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const loadedScopeRef = useRef("");
  const [historyDataScope, setHistoryDataScope] = useState("");
  const [isViewportSmall, setIsViewportSmall] = useState(false);
  const [desktopViewMode, setDesktopViewMode] = useState<"calendar" | "list">(
    "calendar",
  );
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendFilterMode, setFriendFilterMode] = useState<
    "all" | "self" | "friends"
  >("all");
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [draftFriendIds, setDraftFriendIds] = useState<string[]>([]);
  const [friendFilterOpen, setFriendFilterOpen] = useState(false);
  const friendFilterRef = useRef<HTMLDivElement | null>(null);
  const friendFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [cardsByDate, setCardsByDate] = useState<Record<string, CalendarCard[]>>(
    {},
  );
  // 共用標題查詢的結果，key 是 movie:123 / tv:456。刻意用累加的方式保留，
  // 切換月份時已知的標題就不必再等一次網路。
  const [sharedTitles, setSharedTitles] = useState<Record<string, SharedTitle>>(
    {},
  );
  // 不把 sharedTitles 放進月份 effect 的依賴，避免收到標題後立刻重跑整份月曆；
  // 用 ref 記錄每個 key 何時才需要再問，切月份時只送尚未取得或已到期的項目。
  const sharedTitleRefreshAtRef = useRef<Record<string, number>>({});
  // 可見範圍前後各一天的探針結果：哪些 groupKey 延續到畫面外。
  const [edgeContinuation, setEdgeContinuation] = useState<{
    continuingBefore: Set<string>;
    continuingAfter: Set<string>;
  }>(() => ({ continuingBefore: new Set(), continuingAfter: new Set() }));
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
  const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const monthLabel = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
  }).format(monthCursor);
  const todayKey = formatLocalDateKey(now);
  const calendarRows = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const effectiveViewMode = isViewportSmall ? "list" : desktopViewMode;
  const historyScope = effectiveViewMode === "calendar" ? "grid" : "month";
  const selectedFriendKey =
    friendFilterMode === "friends"
      ? `friends:${selectedFriendIds.join("|")}`
      : friendFilterMode;
  const requestedHistoryScope = JSON.stringify([session?.user.id, year, month, friendFilterMode, selectedFriendIds, historyScope]);
  const profileNameIds = Array.from(
    new Set([
      ...(session?.user.id ? [session.user.id] : []),
      ...friends.map((friend) => friend.friend_id),
    ]),
  );
  const profileNames = useProfileNames(profileNameIds);
  // 月曆、當日明細與條列共用已載入資料；展開明細不觸發新的查詢。
  const displayCardsByDate = useMemo<Record<string, CalendarMonthCard[]>>(() => {
    // 背景更新可保留同範圍快照，切帳號或範圍時不能短暫沿用上一份資料。
    if (historyDataScope !== requestedHistoryScope) return {};
    const visibleFriends = new Map(friends.map(friend => [friend.friend_id, friend]));
    return Object.fromEntries(Object.entries(cardsByDate).map(([date, cards]) => [
      date,
      cards.map(card => ({
        id: card.id,
        groupKey: card.groupKey,
        title: sharedTitles[card.mediaKey]?.title ?? card.fallbackTitle ?? "",
        detail: card.detail,
        tone: card.tone,
        // 不顯示自己或目前不可見的人；也不因隱藏參與者就推定為「自己觀看」。
        participants: card.participants
          .filter(person => person.friend_id !== session?.user.id && visibleFriends.has(person.friend_id))
          .map(person => ({
            id: person.friend_id,
            name: profileNames[person.friend_id]?.nickname || visibleFriends.get(person.friend_id)?.friend_nickname || `使用者-${person.friend_id.slice(0, 6)}`,
            avatarUrl: profileNames[person.friend_id]?.avatarUrl || null,
            isOwner: person.is_owner,
          })),
      })),
    ]));
  }, [cardsByDate, friends, historyDataScope, profileNames, requestedHistoryScope, session?.user.id, sharedTitles]);
  const listDateEntries = (() => {
    const monthDays = calendarRows
      .flat()
      .filter((day) => day.inMonth)
      .map((day) => day.date);
    const entries = monthDays.filter((date) => {
      const key = formatLocalDateKey(date);
      return (displayCardsByDate[key]?.length ?? 0) > 0 || key === todayKey;
    });
    entries.sort((a, b) => b.getTime() - a.getTime());
    return entries.map((date) => {
      const key = formatLocalDateKey(date);
      return {
        key,
        date,
        cards: displayCardsByDate[key] ?? [],
        isToday: key === todayKey,
      };
    });
  })();

  const resolveFriendName = (friend: FriendEntry) =>
    profileNames[friend.friend_id]?.nickname ||
    friend.friend_nickname ||
    `使用者-${friend.friend_id.slice(0, 6)}`;

  const selectedFriendNames = selectedFriendIds
    .map((id) => friends.find((friend) => friend.friend_id === id))
    .filter((friend): friend is FriendEntry => Boolean(friend))
    .map((friend) => resolveFriendName(friend));
  const friendFilterLabel =
    friendFilterMode === "friends" && selectedFriendNames.length > 0
      ? selectedFriendNames.join("、")
      : "篩選好友";

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) return;

    let isMounted = true;
    const loadFriends = async () => {
      setFriendsLoading(true);
      setFriendsError("");
      const response = await fetch("/api/calendar/friends", {
        cache: "no-store",
      });
      const payload = response.ok
        ? ((await response.json()) as { rows?: FriendEntry[] })
        : null;

      if (!isMounted) return;
      if (!response.ok) throw new Error("Friends unavailable");
      setFriends(payload?.rows ?? []);
      setFriendsLoading(false);
    };

    void loadFriends().catch(() => {
      if (isMounted) setFriendsError("好友資料讀取失敗，請重試。");
    }).finally(() => { if (isMounted) setFriendsLoading(false); });

    return () => {
      isMounted = false;
    };
  }, [fetch, retryToken, session, sessionLoading]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) return;

    let isMounted = true;
    const loadHistory = async () => {
      setLoading(true);
      setHistoryError("");
      const scope = requestedHistoryScope;
      if (loadedScopeRef.current !== scope) {
        setCardsByDate({});
        setEdgeContinuation({ continuingBefore: new Set(), continuingAfter: new Set() });
        loadedScopeRef.current = scope;
      }
      const response = await fetch("/api/calendar/month-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          selectedFriendId: friendFilterMode === "friends" ? "all" : friendFilterMode,
          selectedFriendIds:
            friendFilterMode === "friends" ? selectedFriendIds : undefined,
          scope: historyScope,
        }),
      });
      const payload = response.ok
        ? ((await response.json()) as {
            rows?: WatchHistoryEntry[];
            edge_rows?: WatchHistoryEntry[];
            movie_items?: WatchlistItem[];
            tv_items?: WatchlistItem[];
          })
        : null;

      if (!isMounted) return;
      const emptyEdges = {
        continuingBefore: new Set<string>(),
        continuingAfter: new Set<string>(),
      };
      if (!response.ok) throw new Error("Calendar unavailable");

      const entries = payload?.rows ?? [];
      if (entries.length === 0) {
        setHistoryDataScope(scope);
        setCardsByDate({});
        setEdgeContinuation(emptyEdges);
        setLoading(false);
        return;
      }

      // 探針落在可見範圍之前或之後，決定的是首格左端 / 末格右端要不要收邊。
      const gridRange = getCalendarGridRange(year, month);
      const firstVisibleKey = formatLocalDateKey(gridRange.startDate);
      const edgeRows = payload?.edge_rows ?? [];
      const beforeRows = edgeRows.filter(
        (row) => (extractDateOnlyKey(row.watched_at) ?? "") < firstVisibleKey,
      );
      const afterRows = edgeRows.filter(
        (row) => (extractDateOnlyKey(row.watched_at) ?? "") >= firstVisibleKey,
      );
      setEdgeContinuation({
        continuingBefore: collectGroupKeys(beforeRows),
        continuingAfter: collectGroupKeys(afterRows),
      });

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
        const dateKey = extractDateOnlyKey(entry.watched_at);
        if (!dateKey) return;
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
          cards.push({
            id: `movie:${event.historyId}:${dateKey}`,
            groupKey: buildCardGroupKey(
              "movie",
              event.ownerId,
              event.tmdbId,
              event.participants.keys(),
            ),
            mediaKey: `movie:${event.tmdbId}`,
            fallbackTitle: titleMap.get(`movie:${event.tmdbId}`) ?? null,
            detail: "",
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
            ownerId: string;
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
                ownerId: event.ownerId,
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
            groupKey: buildCardGroupKey(
              "tv",
              group.ownerId,
              group.tmdbId,
              group.participants.keys(),
            ),
            mediaKey: `tv:${group.tmdbId}`,
            fallbackTitle: titleMap.get(`tv:${group.tmdbId}`) ?? null,
            detail: rangeLabel,
            tone,
            participants: Array.from(group.participants.values()),
          });
        });

        nextMap[dateKey] = cards;
      });

      setCardsByDate(nextMap);
      setHistoryDataScope(scope);
      setLoading(false);

      // 標題走共用查詢，和月份資料是兩個獨立的快取生命週期：觀看紀錄沒變就能一直
      // 用本機的，而繁中標題被 TMDB backoff 補上後，這裡會自己拿到新的。
      // 先用 month-data 內嵌的標題把畫面畫出來，共用標題到了再覆蓋。
      const titleLookupNow = Date.now();
      const mediaItems = Array.from(
        new Map(
          entries.map((entry) => [
            `${entry.media_type}:${entry.tmdb_id}`,
            { media_type: entry.media_type, tmdb_id: entry.tmdb_id },
          ]),
        ).entries(),
      )
        .filter(
          ([mediaKey]) =>
            (sharedTitleRefreshAtRef.current[mediaKey] ?? 0) <= titleLookupNow,
        )
        .map(([, item]) => item);
      if (mediaItems.length === 0) return;

      const titleResponse = await fetch("/api/media/titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: mediaItems }),
      }).catch(() => null);
      if (!isMounted || !titleResponse?.ok) return;

      const titlePayload = (await titleResponse.json().catch(() => null)) as {
        titles?: Record<string, SharedTitle>;
      } | null;
      if (!isMounted || !titlePayload?.titles) return;

      const receivedAt = Date.now();
      const nextRefreshAt = { ...sharedTitleRefreshAtRef.current };
      mediaItems.forEach((item) => {
        const mediaKey = `${item.media_type}:${item.tmdb_id}`;
        const refreshAfterMs =
          titlePayload.titles?.[mediaKey]?.refresh_after_ms ??
          TITLE_LOOKUP_FAILURE_RETRY_MS;
        nextRefreshAt[mediaKey] =
          receivedAt + Math.max(60 * 1000, refreshAfterMs);
      });
      sharedTitleRefreshAtRef.current = nextRefreshAt;
      setSharedTitles((current) => ({ ...current, ...titlePayload.titles }));
    };

    void loadHistory().catch(() => {
      if (isMounted) setHistoryError("觀看紀錄讀取失敗，請重試；已有資料會先保留。");
    }).finally(() => { if (isMounted) setLoading(false); });

    return () => {
      isMounted = false;
    };
  }, [
    fetch,
    retryToken,
    calendarRefreshToken,
    friendFilterMode,
    historyScope,
    month,
    requestedHistoryScope,
    selectedFriendIds,
    selectedFriendKey,
    session,
    sessionLoading,
    year,
  ]);

  useWatchRealtimeRefresh(
    async (trigger) => {
      if (
        trigger.source === "event" &&
        trigger.reason &&
        !CALENDAR_HISTORY_REFRESH_REASONS.has(trigger.reason)
      ) {
        return;
      }
      setCalendarRefreshToken((prev) => prev + 1);
    },
    {
      enabled: Boolean(session) && !sessionLoading,
      runOnMount: false,
      fallbackIntervalMs: 60 * 1000,
      connectedIntervalMs: null,
      pauseWhenHidden: true,
    },
  );

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
    if (!friendFilterOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!friendFilterRef.current?.contains(target)) {
        setFriendFilterOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFriendFilterOpen(false);
      friendFilterButtonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [friendFilterOpen]);

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
      const friendScope =
        table === "watch_history"
          ? "self"
          : friendFilterMode === "friends"
            ? "all"
            : friendFilterMode;
      const response = await fetch("/api/calendar/edge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedFriendId: friendScope,
          selectedFriendIds:
            table === "watch_history" || friendFilterMode !== "friends"
              ? undefined
              : selectedFriendIds,
          boundary,
          direction,
        }),
      });
      if (!response.ok) throw new Error("Calendar edge unavailable");
      const payload = (await response.json()) as { edge?: string | null };
      if (payload.edge !== null && (
        typeof payload.edge !== "string" ||
        !parseDateOnlyKeyToLocalDate(extractDateOnlyKey(payload.edge) ?? payload.edge)
      )) {
        throw new Error("Calendar edge invalid");
      }
      return payload.edge;
    },
    [fetch, friendFilterMode, selectedFriendIds],
  );

  const findNextMonthWithRecords = useCallback(
    async (direction: -1 | 1, boundary: string) => {
      if (!session) return null;

      if (friendFilterMode === "self") {
        return fetchEdgeRecord("watch_history", boundary, direction);
      }

      if (friendFilterMode === "all") {
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
    [fetchEdgeRecord, friendFilterMode, session],
  );

  const handleMonthJump = async (
    direction: -1 | 1,
    anchorEl?: HTMLElement | null,
  ) => {
    if (!session || sessionLoading) return;
    if (isMonthJumping) return;
    setIsMonthJumping(true);
    try {

    const startDate = formatLocalDateKey(new Date(year, month, 1));
    const nextMonthStart = formatLocalDateKey(new Date(year, month + 1, 1));
    const boundary = direction === 1 ? nextMonthStart : startDate;

    const edge = await findNextMonthWithRecords(direction, boundary);
    if (!edge) {
      showToast("沒有可切換的月份。", "error", anchorEl);
      setIsMonthJumping(false);
      return;
    }

    const targetDate = parseDateOnlyKeyToLocalDate(
      extractDateOnlyKey(edge) ?? edge,
    );
    if (!targetDate) {
      showToast("月份資料格式錯誤。", "error", anchorEl);
      setIsMonthJumping(false);
      return;
    }
    const diffMonths =
      Math.abs(
        (targetDate.getFullYear() - year) * 12 + (targetDate.getMonth() - month),
      );

    if (diffMonths > 1) {
      showToast("已跳過沒有紀錄的月份。", "success", anchorEl);
    }

    setMonthCursor(targetDate);
    setIsMonthJumping(false);
    } catch {
      showToast("月份切換失敗，請稍後再試。", "error", anchorEl);
    } finally {
      setIsMonthJumping(false);
    }
  };

  const openFriendFilter = () => {
    if (friendFilterOpen) {
      setFriendFilterOpen(false);
      return;
    }
    setDraftFriendIds(selectedFriendIds);
    setFriendFilterOpen(true);
  };

  const toggleDraftFriend = (friendId: string) => {
    setDraftFriendIds((current) =>
      current.includes(friendId)
        ? current.filter((id) => id !== friendId)
        : [...current, friendId],
    );
  };

  const applyFriendFilter = () => {
    const nextIds = friends
      .map((friend) => friend.friend_id)
      .filter((id) => draftFriendIds.includes(id));
    setSelectedFriendIds(nextIds);
    setFriendFilterMode(nextIds.length > 0 ? "friends" : "all");
    setFriendFilterOpen(false);
  };

  const clearFriendFilter = () => {
    setSelectedFriendIds([]);
    setDraftFriendIds([]);
    setFriendFilterMode("all");
    setFriendFilterOpen(false);
  };

  return (
    <div className="min-h-screen bg-watch-bg text-watch-text">
      <SiteHeader />
      {toast && (
        <div
          ref={toastRef}
          className={`fixed z-50 whitespace-nowrap rounded-full border border-watch-border bg-watch-popover px-3 py-1.5 text-xs ${toast.anchor ? "-translate-x-1/2 -translate-y-full" : "right-6 top-24"}`}
          style={toast.anchor ? { left: toastPosition?.left ?? toast.anchor.left, top: toastPosition?.top ?? toast.anchor.top } : undefined}
          role="status"
        >
          <span className={toast.tone === "error" ? "text-watch-error" : "text-watch-complete"}>{toast.message}</span>
        </div>
      )}
      <main className={`min-h-screen px-8 pt-16 ${effectiveViewMode === "calendar" ? "pb-[33px]" : "pb-20"}`}>
        <div className="mx-auto h-full w-full">
          <div id="search-results-slot" />
          <RequireAuthGate>
            <div className="page-content" aria-busy={loading}>
              {(historyError || friendsError) && (
                <div role="alert" className="my-3 flex items-center gap-3 text-sm text-watch-error">
                  <span>{historyError || friendsError}</span>
                  <button type="button" disabled={loading || friendsLoading} onClick={() => setRetryToken(value => value + 1)} className="watch-button">重試</button>
                </div>
              )}
              <div ref={toolbarRef} className="sticky top-16 z-30 -mx-8 flex flex-wrap items-center justify-between gap-3 border-b border-watch-border-subtle bg-watch-bg px-4 py-3 min-[1024px]:px-7">
                <div className="flex w-full min-w-0 flex-wrap items-center gap-3 min-[1024px]:w-auto">
                  <div className="flex w-full items-center justify-between gap-3 min-[1024px]:w-auto min-[1024px]:justify-start">
                    <h1 className="flex items-center gap-2 whitespace-nowrap text-2xl font-semibold">
                      {monthLabel}
                      <span className="watch-spinner-slot" title={isMonthJumping ? "正在尋找月份…" : loading ? "正在更新紀錄…" : undefined}>
                        {(isMonthJumping || (loading && Object.keys(displayCardsByDate).length > 0)) && <span role="status"><span className="watch-spinner" aria-hidden="true" /><span className="sr-only">{isMonthJumping ? "正在尋找月份…" : "正在更新紀錄…"}</span></span>}
                      </span>
                    </h1>
                    <div className="flex shrink-0 items-center gap-1 text-xs text-watch-text-secondary">
                      <button type="button" onClick={event => handleMonthJump(-1, event.currentTarget)} disabled={isMonthJumping} title="上一個有紀錄的月份" className="watch-button watch-button--small w-8 p-0">
                        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span className="sr-only">上個月</span>
                      </button>
                      <button type="button" onClick={() => { const next = new Date(); next.setDate(1); setMonthCursor(next); }} className="watch-button watch-button--small">本月</button>
                      <button type="button" onClick={event => handleMonthJump(1, event.currentTarget)} disabled={isMonthJumping} title="下一個有紀錄的月份" className="watch-button watch-button--small w-8 p-0">
                        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m10 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span className="sr-only">下個月</span>
                      </button>
                    </div>
                  </div>
                  <div ref={friendFilterRef} className="relative inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-lg border border-watch-border-subtle bg-watch-panel p-0.75 text-xs">
                    <button type="button" aria-pressed={friendFilterMode === "all"} onClick={() => { setFriendFilterMode("all"); setSelectedFriendIds([]); setDraftFriendIds([]); setFriendFilterOpen(false); }} className={`shrink-0 rounded-md px-2.5 py-1.75 transition focus-visible:outline-2 focus-visible:outline-watch-focus ${friendFilterMode === "all" ? "bg-watch-selected text-watch-text" : "text-watch-text-muted enabled:hover:text-watch-text"}`}>所有紀錄</button>
                    <button type="button" aria-pressed={friendFilterMode === "self"} onClick={() => { setFriendFilterMode("self"); setSelectedFriendIds([]); setDraftFriendIds([]); setFriendFilterOpen(false); }} className={`shrink-0 rounded-md px-2.5 py-1.75 transition focus-visible:outline-2 focus-visible:outline-watch-focus ${friendFilterMode === "self" ? "bg-watch-selected text-watch-text" : "text-watch-text-muted enabled:hover:text-watch-text"}`}>自己單獨看</button>
                    <span className="relative inline-flex min-w-0">
                      <button ref={friendFilterButtonRef} type="button" onClick={openFriendFilter} disabled={friendsLoading} aria-expanded={friendFilterOpen} aria-controls={friendFilterOpen ? "calendar-friend-filter" : undefined} aria-label={friendFilterMode === "friends" ? `篩選好友：${friendFilterLabel}` : "篩選好友"} className={`flex w-28 min-w-0 items-center gap-1 rounded-md py-1.75 pl-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-watch-focus ${friendFilterMode === "friends" ? "bg-watch-selected pr-7 text-watch-text" : "pr-2.5 text-watch-text-muted enabled:hover:text-watch-text"}`}>
                        <span className="min-w-0 flex-1 truncate">{friendsLoading ? "載入好友中..." : friendFilterLabel}</span>
                        <span className="watch-spinner-slot" aria-hidden="true">{friendsLoading ? <span className="watch-spinner" /> : friendFilterMode !== "friends" ? <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 7.5 5 5 5-5" /></svg> : null}</span>
                      </button>
                      {friendFilterMode === "friends" && <button type="button" onClick={clearFriendFilter} aria-label="清除好友篩選" className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-sm text-watch-text-muted enabled:hover:bg-watch-hover enabled:hover:text-watch-text">×</button>}
                    </span>
                    {friendFilterOpen && (
                      <div id="calendar-friend-filter" className="absolute left-0 top-full z-40 mt-2 w-70 max-w-[calc(100vw-2rem)] rounded-xl border border-watch-border bg-watch-popover p-3 shadow-xl shadow-black/40">
                        <div className="max-h-72 space-y-1 overflow-y-auto pr-1" aria-label="選擇好友">
                          {friendsError && friends.length === 0 ? <p className="px-2 py-6 text-xs text-watch-error">{friendsError}</p> : friends.length === 0 ? <div className="px-2 py-6 text-center text-xs text-watch-text-muted">目前沒有好友</div> : friends.map(friend => {
                            const checked = draftFriendIds.includes(friend.friend_id);
                            return <button key={friend.friend_id} type="button" aria-pressed={checked} onClick={() => toggleDraftFriend(friend.friend_id)} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${checked ? "bg-watch-selected text-watch-text" : "text-watch-text-secondary enabled:hover:bg-watch-hover enabled:hover:text-watch-text"}`}>
                              <span className="truncate">{resolveFriendName(friend)}</span>
                              <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border text-[11px] ${checked ? "border-watch-progress bg-watch-progress text-black" : "border-watch-border text-transparent"}`} aria-hidden="true">✓</span>
                            </button>;
                          })}
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-watch-border-subtle pt-3">
                          <button type="button" onClick={() => { setFriendFilterOpen(false); friendFilterButtonRef.current?.focus(); }} className="watch-button watch-button--small watch-button--quiet">取消</button>
                          <button type="button" onClick={applyFriendFilter} className="watch-button watch-button--small watch-button--primary">確認</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {!isViewportSmall && <div className="inline-flex items-center gap-0.5 rounded-lg border border-watch-border-subtle bg-watch-panel p-0.75 text-xs text-watch-text-muted" aria-label="顯示方式">
                    <button type="button" aria-pressed={effectiveViewMode === "calendar"} onClick={() => setDesktopViewMode("calendar")} className={`rounded-md px-2.5 py-1.75 transition focus-visible:outline-2 focus-visible:outline-watch-focus ${effectiveViewMode === "calendar" ? "bg-watch-selected text-watch-text" : "enabled:hover:text-watch-text"}`}>月曆</button>
                    <button type="button" aria-pressed={effectiveViewMode === "list"} onClick={() => setDesktopViewMode("list")} className={`rounded-md px-2.5 py-1.75 transition focus-visible:outline-2 focus-visible:outline-watch-focus ${effectiveViewMode === "list" ? "bg-watch-selected text-watch-text" : "enabled:hover:text-watch-text"}`}>條列</button>
                  </div>}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-watch-text-muted" aria-label="類型圖例">
                  <span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-[#c4ab69]" />電影</span>
                  <span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-[#c08b8e]" />影集</span>
                  <span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-[#8db8a2]" />動畫</span>
                </div>
              </div>
              {loading && Object.keys(displayCardsByDate).length === 0 ? (
                <section className="flex min-h-[48vh] items-center justify-center" role="status"><span className="watch-loading text-sm"><span className="watch-spinner" aria-hidden="true" />載入中...</span></section>
              ) : historyError && Object.keys(displayCardsByDate).length === 0 ? null : effectiveViewMode === "calendar" ? (
                <CalendarMonthView
                  key={`${session?.user.id}:${year}:${month}:${selectedFriendKey}`}
                  weeks={calendarRows}
                  cardsByDate={displayCardsByDate}
                  boundary={edgeContinuation}
                  todayKey={todayKey}
                  toolbarRef={toolbarRef}
                  escapeDisabled={friendFilterOpen}
                />
              ) : (
                <section className="-mx-4 space-y-6 py-5 min-[1024px]:mx-auto min-[1024px]:max-w-295" aria-label="觀看紀錄條列">
                  {listDateEntries.length === 0 ? <div className="rounded-xl border border-watch-border-subtle px-5 py-12 text-center text-sm text-watch-text-muted">這個月還沒有觀看紀錄</div> : listDateEntries.map(entry => (
                    <article key={entry.key} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 min-[1024px]:grid-cols-[7.25rem_minmax(0,1fr)] min-[1024px]:gap-5">
                      <div className="pt-3 text-[11px] leading-relaxed text-watch-text-muted">
                        <p className="whitespace-nowrap text-sm font-medium text-watch-text min-[1024px]:text-base">{isViewportSmall ? `${entry.date.getMonth() + 1}/${entry.date.getDate()}` : `${entry.date.getMonth() + 1} 月 ${entry.date.getDate()} 日`}</p>
                        <span>週{["日", "一", "二", "三", "四", "五", "六"][entry.date.getDay()]}</span>
                        {entry.isToday && <span className="block text-watch-progress min-[1024px]:ml-1 min-[1024px]:inline">今天</span>}
                      </div>
                      <div className="min-w-0">
                        {entry.cards.length > 0 ? entry.cards.map(card => (
                          <div key={card.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-watch-border-subtle py-3">
                            <div className="flex min-w-0 flex-1 items-start gap-2.5">
                              <i aria-hidden="true" className={`mt-1.75 h-1.5 w-1.5 shrink-0 rounded-full ${card.tone === "movie" ? "bg-[#c4ab69]" : card.tone === "anime" ? "bg-[#8db8a2]" : "bg-[#c08b8e]"}`} />
                              <div className="min-w-0">
                                {card.title ? <h2 className="text-sm font-medium wrap-anywhere text-watch-text">{card.title}</h2> : !card.detail ? <h2 className="text-sm text-watch-text-muted">片名待更新</h2> : null}
                                {card.detail && <p className="mt-1 text-xs wrap-anywhere text-watch-text-muted">{card.detail}</p>}
                              </div>
                            </div>
                            {card.participants.length > 0 && <div className="ml-4 max-w-full basis-full min-[1024px]:ml-0 min-[1024px]:max-w-72 min-[1024px]:basis-auto"><CalendarParticipants participants={card.participants} /></div>}
                          </div>
                        )) : <p className="py-5 text-xs text-watch-text-muted">今天還沒有新的觀看紀錄</p>}
                      </div>
                    </article>
                  ))}
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
