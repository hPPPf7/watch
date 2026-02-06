"use client";

import { useEffect, useMemo, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import useAuth from "@/hooks/useAuth";
import { supabase } from "@/lib/supabaseClient";
import useProfileNames from "@/hooks/useProfileNames";
import { getDetailCache, setDetailCache } from "@/lib/tmdbDetailCache";

const WEEK_DAYS = ["日", "一", "二", "三", "四", "五", "六"];
const PROJECT_ID = "watch";

type CalendarDay = {
  date: Date;
  inMonth: boolean;
};

type WatchHistoryEntry = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  watched_at: string;
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
  const [monthCursor, setMonthCursor] = useState(() => {
    const start = new Date();
    start.setDate(1);
    return start;
  });
  const { session, loading: sessionLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState("all");
  const [cardsByDate, setCardsByDate] = useState<Record<string, CalendarCard[]>>(
    {},
  );
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const monthLabel = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
  }).format(monthCursor);
  const todayKey = now.toDateString();
  const calendarRows = buildMonthGrid(year, month);
  const profileNameIds = useMemo(
    () => friends.map((friend) => friend.friend_id),
    [friends],
  );
  const profileNames = useProfileNames(profileNameIds);

  const resolveFriendName = (friend: FriendEntry) =>
    profileNames[friend.friend_id]?.nickname ||
    friend.friend_nickname ||
    `使用者-${friend.friend_id.slice(0, 6)}`;

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) return;

    let isMounted = true;
    const loadFriends = async () => {
      setFriendsLoading(true);
      const { data, error } = await supabase
        .from("friends")
        .select("friend_id, friend_nickname")
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .order("created_at", { ascending: false });

      if (!isMounted) return;
      if (error) {
        setFriends([]);
      } else {
        setFriends((data as FriendEntry[]) ?? []);
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
      const startDate = new Date(year, month, 1).toLocaleDateString("sv-SE");
      const endDate = new Date(year, month + 1, 0).toLocaleDateString("sv-SE");
      const baseSelect =
        "tmdb_id, media_type, season_number, episode_number, watched_at";
      let data: WatchHistoryEntry[] | null = null;
      let error: { message: string } | null = null;

      if (selectedFriendId === "self") {
        const res = await supabase
          .from("watch_history")
          .select(baseSelect)
          .eq("user_id", session.user.id)
          .eq("project_id", PROJECT_ID)
          .gte("watched_at", startDate)
          .lte("watched_at", endDate)
          .order("watched_at", { ascending: true });
        data = res.data as WatchHistoryEntry[] | null;
        error = res.error;
      } else if (selectedFriendId === "all") {
        const [ownRes, shareRes] = await Promise.all([
          supabase
            .from("watch_history")
            .select(baseSelect)
            .eq("user_id", session.user.id)
            .eq("project_id", PROJECT_ID)
            .gte("watched_at", startDate)
            .lte("watched_at", endDate),
          supabase
            .from("watch_history_shares")
            .select(baseSelect)
            .eq("project_id", PROJECT_ID)
            .gte("watched_at", startDate)
            .lte("watched_at", endDate)
            .or(
              `owner_id.eq.${session.user.id},target_user_id.eq.${session.user.id}`,
            ),
        ]);
        data = [
          ...((ownRes.data as WatchHistoryEntry[]) ?? []),
          ...((shareRes.data as WatchHistoryEntry[]) ?? []),
        ];
        error = ownRes.error ?? shareRes.error;
      } else {
        const res = await supabase
          .from("watch_history_shares")
          .select(baseSelect)
          .eq("project_id", PROJECT_ID)
          .gte("watched_at", startDate)
          .lte("watched_at", endDate)
          .or(
            `and(owner_id.eq.${session.user.id},target_user_id.eq.${selectedFriendId}),and(owner_id.eq.${selectedFriendId},target_user_id.eq.${session.user.id})`,
          )
          .order("watched_at", { ascending: true });
        data = res.data as WatchHistoryEntry[] | null;
        error = res.error;
      }

      if (!isMounted) return;
      if (error) {
        setCardsByDate({});
        setLoading(false);
        return;
      }

      const entries = (data ?? []) as WatchHistoryEntry[];
      if (entries.length === 0) {
        setCardsByDate({});
        setLoading(false);
        return;
      }

      const movieIds = Array.from(
        new Set(
          entries.filter((e) => e.media_type === "movie").map((e) => e.tmdb_id),
        ),
      );
      const tvIds = Array.from(
        new Set(
          entries.filter((e) => e.media_type === "tv").map((e) => e.tmdb_id),
        ),
      );

      const [movieRes, tvRes] = await Promise.all([
        movieIds.length > 0
          ? supabase
              .from("watchlist_items")
              .select("tmdb_id, title, media_type, is_anime")
              .eq("user_id", session.user.id)
              .eq("project_id", PROJECT_ID)
              .eq("media_type", "movie")
              .in("tmdb_id", movieIds)
          : Promise.resolve({ data: [] as WatchlistItem[] }),
        tvIds.length > 0
          ? supabase
              .from("watchlist_items")
              .select("tmdb_id, title, media_type, is_anime")
              .eq("user_id", session.user.id)
              .eq("project_id", PROJECT_ID)
              .eq("media_type", "tv")
              .in("tmdb_id", tvIds)
          : Promise.resolve({ data: [] as WatchlistItem[] }),
      ]);

      if (!isMounted) return;

      const titleMap = new Map<string, string>();
      const tvAnimeMap = new Map<number, boolean>();
      (movieRes.data ?? []).forEach((item) => {
        titleMap.set(`movie:${item.tmdb_id}`, item.title);
      });
      (tvRes.data ?? []).forEach((item) => {
        titleMap.set(`tv:${item.tmdb_id}`, item.title);
        tvAnimeMap.set(item.tmdb_id, item.is_anime);
      });

      const missingDetails = entries.filter(
        (entry) =>
          !titleMap.has(`${entry.media_type}:${entry.tmdb_id}`),
      );
      if (missingDetails.length > 0) {
        await Promise.all(
          missingDetails.map(async (entry) => {
            const cacheKey = `${entry.media_type}:${entry.tmdb_id}`;
            const cached = getDetailCache<{ title?: string | null }>(cacheKey);
            if (cached?.title) {
              titleMap.set(cacheKey, cached.title);
              return;
            }
            const response = await fetch(
              `/api/tmdb/detail?type=${entry.media_type}&id=${entry.tmdb_id}`,
            );
            if (!response.ok) return;
            const detail = (await response.json()) as { title?: string | null };
            if (detail?.title) {
              titleMap.set(cacheKey, detail.title);
              setDetailCache(cacheKey, detail);
            }
          }),
        );
      }

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
        const movieSet = new Set<number>();
        const tvGroups = new Map<
          number,
          { seasons: Array<{ season: number; episode: number }> }
        >();

        dayEntries.forEach((entry) => {
          if (entry.media_type === "movie") {
            movieSet.add(entry.tmdb_id);
            return;
          }
          const season =
            entry.season_number === null ? null : entry.season_number;
          const episode =
            entry.episode_number === null ? null : entry.episode_number;
          if (season === null || episode === null) return;
          if (!tvGroups.has(entry.tmdb_id)) {
            tvGroups.set(entry.tmdb_id, { seasons: [] });
          }
          tvGroups.get(entry.tmdb_id)?.seasons.push({ season, episode });
        });

        movieSet.forEach((tmdbId) => {
          const title = titleMap.get(`movie:${tmdbId}`) ?? `TMDB ${tmdbId}`;
          cards.push({
            id: `movie:${tmdbId}:${dateKey}`,
            label: title,
            tone: "movie",
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

        tvGroups.forEach((group, tmdbId) => {
          const title = titleMap.get(`tv:${tmdbId}`) ?? `TMDB ${tmdbId}`;
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

          const tone = tvAnimeMap.get(tmdbId) ? "anime" : "tv";
          cards.push({
            id: `tv:${tmdbId}:${dateKey}`,
            label: `${title} ${rangeLabel}`,
            tone,
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

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-8 pb-16 pt-10">
        <div className="mx-auto h-full w-full pt-3">
          <div id="search-results-slot" className="mb-6" />
          <RequireAuthGate>
            <div className="page-content space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold">{monthLabel}</h1>
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Date(monthCursor);
                          next.setMonth(next.getMonth() - 1);
                          setMonthCursor(next);
                        }}
                        className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/40 hover:text-white"
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
                        onClick={() => {
                          const next = new Date(monthCursor);
                          next.setMonth(next.getMonth() + 1);
                          setMonthCursor(next);
                        }}
                        className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/40 hover:text-white"
                      >
                        下個月
                      </button>
                      <div className="relative">
                        <select
                          value={selectedFriendId}
                          onChange={(event) => setSelectedFriendId(event.target.value)}
                          className="rounded-full border border-white/15 bg-black/30 px-3 py-1 pr-8 text-xs text-white/80 transition hover:border-white/40"
                        >
                          <option value="all">所有紀錄</option>
                          <option value="self">只看自己</option>
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
                      <div className="flex min-h-5 items-center gap-2 text-white/50">
                        {loading && (
                          <>
                            <span
                              className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
                              aria-hidden="true"
                            />
                            載入中...
                          </>
                        )}
                      </div>
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
            </div>
          </RequireAuthGate>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
