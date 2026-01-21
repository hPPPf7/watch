"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import useAuth from "@/hooks/useAuth";
import {
  DEFAULT_DETAIL_TTL_MS,
  getDetailCache,
  setDetailCache,
} from "@/lib/tmdbDetailCache";

const PROJECT_ID = "watch";

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

type DetailModalProps = {
  open: boolean;
  onClose: () => void;
  mediaType: "movie" | "tv";
  tmdbId: number;
  defaultTab?: "details" | "history";
  onWatchlistChange?: (inWatchlist: boolean, detail: DetailData) => void;
  onWatchDateChange?: (tmdbId: number, watchedDate: string | null) => void;
};

export default function DetailModal({
  open,
  onClose,
  mediaType,
  tmdbId,
  defaultTab = "details",
  onWatchlistChange,
  onWatchDateChange,
}: DetailModalProps) {
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "history">("details");
  const [detailHeight, setDetailHeight] = useState<number | null>(null);
  const [detailBaseHeight, setDetailBaseHeight] = useState<number | null>(null);
  const [detailReady, setDetailReady] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [seasonEpisodes, setSeasonEpisodes] = useState<EpisodeInfo[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState("");
  const { session, loading: sessionLoading } = useAuth();
  const [watchDateLoading, setWatchDateLoading] = useState(false);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [watchedDate, setWatchedDate] = useState("");
  const [watchDateEditing, setWatchDateEditing] = useState(true);
  const [sharedWatchDate, setSharedWatchDate] = useState<string | null>(null);
  const [sharedOwnerId, setSharedOwnerId] = useState<string | null>(null);
  const [hasOwnWatchDate, setHasOwnWatchDate] = useState(false);
  const [historyParticipants, setHistoryParticipants] = useState<
    Array<{ friend_id: string; friend_nickname: string | null; is_owner: boolean }>
  >([]);
  const [friends, setFriends] = useState<
    Array<{ friend_id: string; friend_nickname: string | null }>
  >([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState("");
  const [watchlistNoticeTone, setWatchlistNoticeTone] = useState<
    "default" | "error"
  >("default");
  const detailModalRef = useRef<HTMLDivElement | null>(null);
  const watchlistSyncRef = useRef<number | null>(null);
  const friendSelectionRef = useRef(false);
  const baseDetailHeight = 468;

  const getTodayDateString = () =>
    new Date().toLocaleDateString("sv-SE");
  const getInitial = (value: string) =>
    value.trim().slice(0, 1).toUpperCase();
  const selectedFriendNames = selectedFriendIds
    .map((friendId) => {
      const match = friends.find((friend) => friend.friend_id === friendId);
      if (!match) return null;
      return (
        match.friend_nickname || `使用者-${match.friend_id.slice(0, 6)}`
      );
    })
    .filter((value): value is string => Boolean(value));
  const displayParticipants =
    historyParticipants.length > 0
      ? historyParticipants
      : selectedFriendNames.map((name, index) => ({
          friend_id: `local-${index}`,
          friend_nickname: name,
          is_owner: false,
        }));

  useEffect(() => {
    if (!open) return;
    const initialTab = defaultTab === "history" ? "details" : defaultTab;
    setDetailTab(initialTab);
    setDetailReady(defaultTab !== "history");
    setDetailHeight(null);
    setDetailBaseHeight(null);
    setDetailLoading(true);
    setDetailError("");
    setDetailData(null);
    setSelectedSeason(null);
    setWatchedDate(getTodayDateString());
    setWatchDateEditing(true);
    setSharedWatchDate(null);
    setSharedOwnerId(null);
    setHasOwnWatchDate(false);
    setHistoryParticipants([]);
    setSelectedFriendIds([]);
    setFriends([]);
    setFriendsLoading(false);
    setWatchDateLoading(mediaType === "movie");
    setWatchlistNoticeTone("default");
    setSeasonEpisodes([]);
    setSeasonLoading(false);
    setSeasonError("");
    watchlistSyncRef.current = null;
    friendSelectionRef.current = false;
  }, [open, defaultTab, mediaType]);

  useEffect(() => {
    if (!open) return;
    let isMounted = true;

    const fetchDetail = async () => {
      try {
        const cacheKey = `${mediaType}:${tmdbId}`;
        const cached = getDetailCache<DetailData>(cacheKey);
        const cacheMissingSeasons =
          cached?.media_type === "tv" &&
          (!cached.seasons_info || cached.seasons_info.length === 0);
        if (cached && !cacheMissingSeasons) {
          if (cached.media_type === "tv") {
            const firstSeason =
              cached.seasons_info?.[0]?.season_number ?? null;
            setSelectedSeason(firstSeason);
          }
          setDetailData({ ...cached });
          setDetailLoading(false);
          return;
        }

        const response = await fetch(
          `/api/tmdb/detail?type=${mediaType}&id=${tmdbId}`
        );

        if (!response.ok) {
          throw new Error("detail failed");
        }

        const data = (await response.json()) as DetailData;
        if (!isMounted) return;
        if (data.media_type === "tv") {
          const firstSeason = data.seasons_info?.[0]?.season_number ?? null;
          setSelectedSeason(firstSeason);
        }
        setDetailData(data);
        setDetailCache(cacheKey, data, DEFAULT_DETAIL_TTL_MS);
      } catch {
        if (!isMounted) return;
        setDetailError("載入詳細資料失敗，請稍後再試。");
      } finally {
        if (!isMounted) return;
        setDetailLoading(false);
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [open, mediaType, tmdbId]);

  useEffect(() => {
    if (!detailData || detailData.media_type !== "tv") {
      setSelectedSeason(null);
      setSeasonEpisodes([]);
      setSeasonLoading(false);
      setSeasonError("");
      return;
    }
    if (selectedSeason !== null) return;
    const firstSeason = detailData.seasons_info?.[0]?.season_number ?? null;
    setSelectedSeason(firstSeason);
  }, [detailData, selectedSeason]);

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
        setDetailCache(cacheKey, episodes, DEFAULT_DETAIL_TTL_MS);
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

  useLayoutEffect(() => {
    if (!open) return;
    if (detailTab !== "details") return;
    if (detailLoading || !detailData) return;
    if (!detailModalRef.current) return;
    const nextHeight = detailModalRef.current.offsetHeight;
    if (nextHeight > 0) {
      setDetailHeight(nextHeight);
      setDetailBaseHeight(nextHeight);
      if (defaultTab === "history" && !detailReady) {
        setDetailTab("history");
        setDetailReady(true);
      }
    }
  }, [open, detailTab, detailLoading, detailData, defaultTab, detailReady]);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

    useEffect(() => {
      if (!open) return;
      if (!session) {
        setIsInWatchlist(false);
        if (!sessionLoading) {
          setWatchDateLoading(false);
          setWatchDateEditing(true);
          setSharedWatchDate(null);
        }
        return;
      }

    let isMounted = true;
    setWatchlistLoading(true);
    setWatchlistNotice("");
    setWatchDateLoading(true);

    Promise.all([
      supabase
        .from("watchlist_items")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", mediaType)
        .eq("tmdb_id", tmdbId)
        .maybeSingle(),
      mediaType === "movie"
        ? supabase
            .from("watch_history")
            .select("watched_at")
            .eq("user_id", session.user.id)
            .eq("project_id", PROJECT_ID)
            .eq("media_type", mediaType)
            .eq("tmdb_id", tmdbId)
            .eq("season_number", 0)
            .eq("episode_number", 0)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      mediaType === "movie"
        ? supabase
            .from("watch_history_shares")
            .select("watched_at, owner_id")
            .eq("target_user_id", session.user.id)
            .eq("project_id", PROJECT_ID)
            .eq("media_type", mediaType)
            .eq("tmdb_id", tmdbId)
            .eq("season_number", 0)
            .eq("episode_number", 0)
            .order("created_at", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: [], error: null }),
    ])
      .then(([watchlistResult, historyResult, shareResult]) => {
        if (!isMounted) return;
        if (watchlistResult.error) {
          setIsInWatchlist(false);
          return;
        }
        setIsInWatchlist(Boolean(watchlistResult.data));
        const ownDate = historyResult?.data?.watched_at ?? "";
        const sharedDate =
          Array.isArray(shareResult?.data) && shareResult.data.length > 0
            ? shareResult.data[0].watched_at
            : null;
        const ownerId =
          Array.isArray(shareResult?.data) && shareResult.data.length > 0
            ? shareResult.data[0].owner_id
            : null;
        setHasOwnWatchDate(Boolean(ownDate));
        if (ownDate) {
          setWatchedDate(ownDate);
        } else if (sharedDate) {
          setWatchedDate("");
        }
        setSharedWatchDate(sharedDate);
        setSharedOwnerId(ownerId);
        setWatchDateEditing(!ownDate && !sharedDate);
      })
      .finally(() => {
        if (!isMounted) return;
        setWatchlistLoading(false);
        setWatchDateLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, session, sessionLoading, mediaType, tmdbId]);

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

  useEffect(() => {
    if (!open) return;
    if (!session) return;
    if (!isInWatchlist) return;
    if (!detailData) return;
    if (watchlistSyncRef.current === detailData.id) return;

    watchlistSyncRef.current = detailData.id;
    supabase
      .from("watchlist_items")
      .update({
        title: detailData.title,
        year: getWatchlistYear(detailData),
        poster_path: detailData.poster_path,
        is_anime: detailData.is_anime,
      })
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .then(() => undefined);
  }, [open, session, isInWatchlist, detailData]);

  useEffect(() => {
    if (!open || !session) return;
    if (mediaType !== "movie") return;

    let isMounted = true;
    setFriendsLoading(true);

    const loadFriends = async () => {
      try {
        const { data } = await supabase
          .from("friends")
          .select("friend_id, friend_nickname")
          .eq("user_id", session.user.id)
          .eq("project_id", PROJECT_ID)
          .order("created_at", { ascending: false });
        if (!isMounted) return;
        setFriends(
          (data ?? []) as Array<{
            friend_id: string;
            friend_nickname: string | null;
          }>
        );
      } finally {
        if (!isMounted) return;
        setFriendsLoading(false);
      }
    };

    loadFriends();

    return () => {
      isMounted = false;
    };
  }, [open, session, mediaType]);

  useEffect(() => {
    if (!open || !session) return;
    if (mediaType !== "movie") return;
    if (friendSelectionRef.current) return;

    let isMounted = true;
    supabase
      .from("watch_history_shares")
      .select("target_user_id")
      .eq("owner_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", "movie")
      .eq("tmdb_id", tmdbId)
      .eq("season_number", 0)
      .eq("episode_number", 0)
      .then(({ data }) => {
        if (!isMounted) return;
        const nextIds = (data ?? []).map((row) => row.target_user_id);
        setSelectedFriendIds(nextIds);
        friendSelectionRef.current = true;
      });

    return () => {
      isMounted = false;
    };
  }, [open, session, mediaType, tmdbId]);

  useEffect(() => {
    if (!open || !session) return;
    if (mediaType !== "movie") return;
    if (!detailData) return;

    let isMounted = true;

    const fetchParticipants = () => {
      supabase
        .rpc("get_watch_history_participants", {
          target_project: PROJECT_ID,
          target_media: "movie",
          target_tmdb_id: tmdbId,
          target_season: 0,
          target_episode: 0,
        })
        .then(({ data }) => {
          if (!isMounted) return;
          setHistoryParticipants(
            (data ?? []) as Array<{
              friend_id: string;
              friend_nickname: string | null;
              is_owner: boolean;
            }>
          );
        });
    };

    fetchParticipants();

    const friendsChannel = supabase
      .channel(`detail-friends-${session.user.id}-${tmdbId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friends",
          filter: `user_id=eq.${session.user.id}`,
        },
        fetchParticipants
      )
      .subscribe();

    const ownerShareChannel = supabase
      .channel(`detail-owner-shares-${session.user.id}-${tmdbId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history_shares",
          filter: `owner_id=eq.${session.user.id}`,
        },
        fetchParticipants
      )
      .subscribe();

    const targetShareChannel = supabase
      .channel(`detail-target-shares-${session.user.id}-${tmdbId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_history_shares",
          filter: `target_user_id=eq.${session.user.id}`,
        },
        fetchParticipants
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(friendsChannel);
      supabase.removeChannel(ownerShareChannel);
      supabase.removeChannel(targetShareChannel);
    };
  }, [open, session, mediaType, tmdbId, detailData]);

  const handleToggleWatchlist = async () => {
    if (!detailData) return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以加入清單。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (watchlistLoading) return;

    setWatchlistLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("default");

    if (isInWatchlist) {
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", session.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("media_type", detailData.media_type)
        .eq("tmdb_id", detailData.id);
      if (error) {
        setWatchlistNotice(
          error.message?.includes("watch_history_exists")
            ? "已有觀看紀錄，無法移除清單。"
            : "移除失敗，請稍後再試。"
        );
        setWatchlistNoticeTone("error");
      } else {
        setIsInWatchlist(false);
        setWatchlistNotice("已從清單移除。");
        setWatchlistNoticeTone("default");
        onWatchlistChange?.(false, detailData);
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
      setWatchlistNoticeTone("error");
    } else {
      setIsInWatchlist(true);
      setWatchlistNotice("已加入清單。");
      setWatchlistNoticeTone("default");
      onWatchlistChange?.(true, detailData);
    }
    setWatchlistLoading(false);
  };

  const handleRecordWatchDate = async () => {
    if (!detailData || detailData.media_type !== "movie") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以紀錄觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (watchlistLoading) return;

    const recordDate = watchedDate || getTodayDateString();
    setWatchlistLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("default");

    if (!isInWatchlist) {
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
        setWatchlistNotice("紀錄失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      setIsInWatchlist(true);
      onWatchlistChange?.(true, detailData);
    }

    const { error: historyError } = await supabase.from("watch_history").upsert(
      {
        user_id: session.user.id,
        project_id: PROJECT_ID,
        media_type: detailData.media_type,
        tmdb_id: detailData.id,
        season_number: 0,
        episode_number: 0,
        watched_at: recordDate,
      },
      {
        onConflict:
          "user_id,project_id,media_type,tmdb_id,season_number,episode_number",
      }
    );

    if (historyError) {
      setWatchlistNotice("紀錄失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    const { error: shareDeleteError } = await supabase
      .from("watch_history_shares")
      .delete()
      .eq("owner_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", 0)
      .eq("episode_number", 0);

    if (shareDeleteError) {
      setWatchlistNotice("同步好友失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    if (selectedFriendIds.length > 0) {
      const shareRows = selectedFriendIds.map((friendId) => ({
        owner_id: session.user.id,
        target_user_id: friendId,
        project_id: PROJECT_ID,
        media_type: detailData.media_type,
        tmdb_id: detailData.id,
        season_number: 0,
        episode_number: 0,
        watched_at: recordDate,
      }));

      const { error: shareInsertError } = await supabase
        .from("watch_history_shares")
        .insert(shareRows);

      if (shareInsertError) {
        setWatchlistNotice("同步好友失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }

      const { error: friendWatchlistError } = await supabase.rpc(
        "sync_watchlist_items_for_friends",
        {
          target_project: PROJECT_ID,
          target_media: detailData.media_type,
          target_tmdb_id: detailData.id,
          target_title: detailData.title,
          target_year: getWatchlistYear(detailData),
          target_poster_path: detailData.poster_path,
          target_is_anime: detailData.is_anime,
          target_friend_ids: selectedFriendIds,
        }
      );
      if (friendWatchlistError) {
        setWatchlistNotice("同步好友清單失敗，請稍後再試。");
        setWatchlistNoticeTone("error");
        setWatchlistLoading(false);
        return;
      }
    }

    setWatchedDate(recordDate);
    setHistoryParticipants(
      selectedFriendIds.map((friendId) => {
        const match = friends.find((friend) => friend.friend_id === friendId);
        return {
          friend_id: friendId,
          friend_nickname:
            match?.friend_nickname || `使用者-${match.friend_id.slice(0, 6)}`,
          is_owner: false,
        };
      })
    );
    setWatchDateEditing(false);
    setWatchlistNotice("");
    setWatchlistNoticeTone("default");
    onWatchDateChange?.(detailData.id, recordDate);
    setWatchlistLoading(false);
  };

  const handleClearWatchDate = async () => {
    if (!detailData || detailData.media_type !== "movie") return;
    if (sessionLoading) return;
    if (!session) {
      setWatchlistNotice("請先登入以編輯觀看日期。");
      setWatchlistNoticeTone("error");
      return;
    }
    if (watchlistLoading) return;

    if (!isInWatchlist) {
      setWatchedDate(getTodayDateString());
      setWatchDateEditing(true);
      onWatchDateChange?.(detailData.id, null);
      return;
    }

    setWatchlistLoading(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("default");

    const { error } = await supabase
      .from("watch_history")
      .delete()
      .eq("user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", 0)
      .eq("episode_number", 0);

    if (error) {
      setWatchlistNotice("清除失敗，請稍後再試。");
      setWatchlistNoticeTone("error");
      setWatchlistLoading(false);
      return;
    }

    await supabase
      .from("watch_history_shares")
      .delete()
      .eq("owner_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("media_type", detailData.media_type)
      .eq("tmdb_id", detailData.id)
      .eq("season_number", 0)
      .eq("episode_number", 0);

    setWatchedDate(getTodayDateString());
    setHistoryParticipants([]);
    setWatchDateEditing(true);
    setWatchlistNotice("");
    setWatchlistNoticeTone("default");
    onWatchDateChange?.(detailData.id, null);
    setWatchlistLoading(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-8"
      onClick={onClose}
    >
      <div
        ref={detailModalRef}
        className={`relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] ${
          detailReady ? "opacity-100" : "opacity-0"
        }`}
        style={{
          ...(detailHeight ? { height: `${detailHeight}px` } : {}),
          ...(!detailHeight && detailTab === "history"
            ? { height: `${detailBaseHeight ?? baseDetailHeight}px` }
            : {}),
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 h-8 w-8 rounded-full border border-white/15 text-sm text-white/70 hover:border-white/40"
          onClick={onClose}
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
              <svg
                aria-hidden="true"
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill={isInWatchlist ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path
                  d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.9L12 16.9 6.8 19.6l1-5.9-4.2-4.1 5.8-.8L12 3.5z"
                  strokeLinejoin="round"
                />
              </svg>
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
            <p
              className={`mt-2 text-xs ${
                watchlistNoticeTone === "error"
                  ? "text-red-300"
                  : "text-white/60"
              }`}
            >
              {watchlistNotice}
            </p>
          )}
          <div className="mt-4 flex-1 h-full min-h-0 overflow-hidden pr-2">
            {detailLoading && detailTab === "details" && (
              <div className="flex flex-col gap-6 md:flex-row">
                <div className="h-90 w-60 animate-pulse rounded-xl bg-white/5" />
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
            {detailLoading && detailTab === "history" && (
              <div className="grid h-full min-h-0 flex-1 grid-rows-[auto,1fr] gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-20 animate-pulse rounded-full bg-white/10" />
                  <div className="h-9 w-40 animate-pulse rounded-full bg-white/10" />
                </div>
                <div className="h-full min-h-0 overflow-hidden pr-1">
                  <div className="grid gap-2">
                    {Array.from({ length: 6 }, (_, index) => (
                      <div
                        key={`history-skeleton-${index}`}
                        className="h-10 animate-pulse rounded-lg border border-white/10 bg-white/5"
                      />
                    ))}
                  </div>
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
                    <div className="relative h-90 w-60 overflow-hidden rounded-xl bg-white/5">
                      {detailData.poster_path ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w342${detailData.poster_path}`}
                          alt={detailData.title}
                          fill
                          sizes="240px"
                          className="object-cover"
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
                  <div className="grid h-full min-h-0 flex-1 grid-rows-[auto,1fr] gap-4 content-start">
                    {detailData.media_type === "movie" && (
                      <div className="grid gap-4 text-sm text-white/70">
                        {watchDateLoading ? null : watchDateEditing && !sharedWatchDate ? (
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] lg:items-start">
                            <label className="grid gap-2">
                              <span className="text-sm text-white/60">
                                選擇日期
                              </span>
                              <input
                                type="date"
                                id="movie-watch-date"
                                name="movie-watch-date"
                                className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-white/80 outline-none focus:border-white/40"
                                value={watchedDate}
                                onChange={(event) =>
                                  setWatchedDate(event.target.value)
                                }
                              />
                            </label>
                            <div className="grid gap-2">
                              <span className="text-sm text-white/60">
                                選擇好友
                              </span>
                              <div className="max-h-32 overflow-y-auto rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                                {friendsLoading && (
                                  <p className="text-xs text-white/40">
                                    載入好友中...
                                  </p>
                                )}
                                {!friendsLoading && friends.length === 0 && (
                                  <p className="text-xs text-white/40">
                                    尚未有好友
                                  </p>
                                )}
                                {!friendsLoading && friends.length > 0 && (
                                  <div className="grid gap-2 text-xs text-white/80">
                                    {friends.map((friend) => (
                                      <label
                                        key={friend.friend_id}
                                        className="flex items-center gap-3"
                                      >
                                        <input
                                          type="checkbox"
                                          className="h-4 w-4 rounded border-white/20 bg-transparent text-white"
                                          checked={selectedFriendIds.includes(
                                            friend.friend_id
                                          )}
                                          onChange={(event) => {
                                            const isChecked =
                                              event.target.checked;
                                            setSelectedFriendIds((prev) => {
                                              if (isChecked) {
                                                return [
                                                  ...prev,
                                                  friend.friend_id,
                                                ];
                                              }
                                              return prev.filter(
                                                (id) => id !== friend.friend_id
                                              );
                                            });
                                          }}
                                        />
                                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[10px] font-semibold text-white/80">
                                          {(friend.friend_nickname ?? "?")
                                            .trim()
                                            .slice(0, 1)
                                            .toUpperCase()}
                                        </span>
                                        <span>
                                          {friend.friend_nickname ||
                                            `使用者-${friend.friend_id.slice(0, 6)}`}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="h-fit rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                              onClick={handleRecordWatchDate}
                            >
                              確認紀錄
                            </button>
                          </div>
                        ) : hasOwnWatchDate && watchedDate ? (
                          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs text-white/50">
                                  觀看日期
                                </p>
                                <p className="text-sm text-emerald-300">
                                  {watchedDate}
                                </p>
                                {displayParticipants.length > 0 && (
                                  <div className="mt-2 flex items-center gap-2 overflow-x-auto text-xs text-white/60">
                                    <span className="shrink-0">和</span>
                                    <div className="flex items-center gap-2 text-white/80">
                                      {displayParticipants.map((item) => (
                                        <span
                                          key={item.friend_id}
                                          className="flex items-center gap-2 text-white/80"
                                        >
                                          <span
                                            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[10px] font-semibold"
                                            aria-hidden="true"
                                          >
                                            {getInitial(
                                              item.friend_nickname ||
                                                `使用者-${item.friend_id.slice(0, 6)}`
                                            )}
                                          </span>
                                          <span className="whitespace-nowrap font-semibold text-white">
                                            {item.friend_nickname ||
                                              `使用者-${item.friend_id.slice(0, 6)}`}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                    <span className="shrink-0">一起看</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  className="text-white/60 transition hover:text-white"
                                  onClick={() => setWatchDateEditing(true)}
                                  aria-label="編輯觀看日期"
                                >
                                  <svg
                                    aria-hidden="true"
                                    className="h-6 w-6"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                  >
                                    <path
                                      d="M4 20h4l10-10-4-4L4 16v4z"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M14 6l4 4"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="text-white/60 transition hover:text-red-300"
                                  onClick={handleClearWatchDate}
                                  aria-label="刪除觀看日期"
                                >
                                  <svg
                                    aria-hidden="true"
                                    className="h-6 w-6"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                  >
                                    <path
                                      d="M3 6h18"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M8 6V4h8v2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M6 6l1 14h10l1-14"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : sharedWatchDate ? (
                          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs text-white/50">
                                  觀看日期
                                </p>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm text-emerald-300">
                                    {sharedWatchDate}
                                  </p>
                                </div>
                                {historyParticipants.length > 0 ? (
                                  <div className="mt-2 flex items-center gap-2 overflow-x-auto text-xs text-white/60">
                                    <span className="shrink-0">和</span>
                                    <div className="flex items-center gap-2 text-white/80">
                                      {historyParticipants.map((item) => {
                                        const isOwner =
                                          item.is_owner ||
                                          (sharedOwnerId
                                            ? item.friend_id === sharedOwnerId
                                            : false);
                                        return (
                                          <span
                                            key={item.friend_id}
                                            className="flex items-center gap-2 text-white/80"
                                          >
                                            <span
                                              className={`flex h-6 w-6 items-center justify-center rounded-full border bg-white/5 text-[10px] font-semibold ${
                                                isOwner
                                                  ? "border-amber-300/60 text-white"
                                                  : "border-white/15 text-white"
                                              }`}
                                              aria-hidden="true"
                                            >
                                              {getInitial(
                                                item.friend_nickname ||
                                                  `使用者-${item.friend_id.slice(0, 6)}`
                                              )}
                                            </span>
                                            <span
                                              className={`whitespace-nowrap font-semibold ${
                                                isOwner
                                                  ? "text-amber-300"
                                                  : "text-white"
                                              }`}
                                            >
                                              {item.friend_nickname ||
                                                `使用者-${item.friend_id.slice(0, 6)}`}
                                            </span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                    <span className="shrink-0">一起看</span>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs text-white/40">
                                    由好友同步
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                            <p className="text-xs text-white/50">
                              尚未建立觀看紀錄。
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {detailData.media_type !== "movie" &&
                      detailData.media_type !== "tv" && (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                          此內容沒有季數。
                        </div>
                      )}
                    {detailData.media_type === "tv" &&
                      (() => {
                        const seasonCount =
                          detailData.seasons_info?.length ?? 0;
                        const hasSeasonOptions = seasonCount > 0;
                        const showSeasonMessage =
                          !hasSeasonOptions || selectedSeason === null;
                        const showEpisodeMessage =
                          hasSeasonOptions &&
                          selectedSeason !== null &&
                          !seasonLoading &&
                          !seasonError &&
                          seasonEpisodes.length === 0;

                        return (
                          <>
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-white/60">
                                選擇季數
                              </span>
                              <select
                                id="detail-season-select-modal"
                                name="detail-season-select-modal"
                                className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-white/80 outline-none focus:border-white/40"
                                value={selectedSeason ?? ""}
                                onChange={(event) =>
                                  setSelectedSeason(
                                    event.target.value
                                      ? Number(event.target.value)
                                      : null
                                  )
                                }
                                disabled={!hasSeasonOptions}
                              >
                                {hasSeasonOptions ? (
                                  detailData.seasons_info?.map((season) => (
                                    <option
                                      key={season.season_number}
                                      value={season.season_number}
                                    >
                                      第{season.season_number}季 · 共{" "}
                                      {season.episode_count ?? "未知"} 集
                                    </option>
                                  ))
                                ) : (
                                  <option value="">尚未取得季數資料</option>
                                )}
                              </select>
                            </div>
                            <div
                              className={`h-full min-h-0 pr-1 ${
                                selectedSeason &&
                                !seasonLoading &&
                                !seasonError &&
                                seasonEpisodes.length > 0
                                  ? "overflow-y-scroll overscroll-contain"
                                  : "overflow-hidden"
                              }`}
                            >
                              <div className="grid gap-2 text-sm text-white/70">
                                {showSeasonMessage && (
                                  <p className="text-white/50">
                                    {hasSeasonOptions
                                      ? "尚未選擇季數。"
                                      : "尚未取得季數資料。"}
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
                                {selectedSeason &&
                                  !seasonLoading &&
                                  seasonError && (
                                    <p className="text-red-300">
                                      {seasonError}
                                    </p>
                                  )}
                                {showEpisodeMessage && (
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
                                      S{selectedSeason}E
                                      {episode.episode_number}
                                      {episode.name
                                        ? ` - ${episode.name}`
                                        : ""}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
