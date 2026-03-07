"use client";

import Image from "next/image";

type WatchlistCardProps = {
  title: string;
  posterPath: string | null;
  metadataLoading?: boolean;
  releaseDate?: string | null;
  releaseCountdown?: string | null;
  watchedDate?: string | null;
  watchedCount?: number | null;
  watchedFriends?: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    isOwner: boolean;
  }>;
  episodeStatus?: string | null;
  statusLoading?: boolean;
  newEpisodeAlert?: boolean;
  newEpisodeAlertLabel?: string;
  upcomingEpisode?: {
    season: number;
    episode: number;
    name: string | null;
    airDate: string;
    daysUntil: number;
  } | null;
  onClick?: () => void;
};

export default function WatchlistCard({
  title,
  posterPath,
  metadataLoading,
  releaseDate,
  releaseCountdown,
  watchedDate,
  watchedCount,
  watchedFriends,
  episodeStatus,
  statusLoading = false,
  newEpisodeAlert = false,
  newEpisodeAlertLabel,
  upcomingEpisode,
  onClick,
}: WatchlistCardProps) {
  const getInitial = (value: string) => value.trim().slice(0, 1).toUpperCase();
  const displayCount = watchedDate ? watchedCount ?? 1 : 0;
  const missingTags = ["MISSING_EPISODE_DATA", "（中間有漏集）"];
  const hasMissingTag =
    episodeStatus != null && missingTags.some((tag) => episodeStatus.includes(tag));
  const displayEpisodeStatus = hasMissingTag
    ? missingTags.reduce(
        (text, tag) => text.replace(tag, "").trim(),
        episodeStatus ?? "",
      )
    : episodeStatus;
  const hasUnwatchedGaps =
    displayEpisodeStatus === "\u6709\u672a\u89c0\u770b\u7684\u96c6\u6578";

  const isTitlePlaceholder = /^TMDB\s+\d+$/i.test(title.trim());
  const showMetadataLoading = metadataLoading === true;
  const titleText = showMetadataLoading
    ? "資料載入中..."
    : isTitlePlaceholder
      ? "未提供片名"
      : title || "未提供片名";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full select-none gap-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-white/30"
    >
      <div className="relative h-28 w-20 overflow-hidden rounded-xl bg-white/10">
        {posterPath ? (
          <Image
            src={`https://image.tmdb.org/t/p/w185${posterPath}`}
            alt={titleText}
            fill
            sizes="80px"
            className="object-cover"
          />
        ) : showMetadataLoading ? (
          <div className="h-full w-full animate-pulse bg-white/10" />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-sm font-semibold text-white">{titleText}</h3>
        {upcomingEpisode ? (
          <>
            <p className="mt-2 text-xs text-white/70">
              S{upcomingEpisode.season}E{upcomingEpisode.episode}
              {upcomingEpisode.name ? ` - ${upcomingEpisode.name}` : ""}
            </p>
            <p className="mt-1 text-xs text-white/50">
              播出日: {upcomingEpisode.airDate}
            </p>
            <p className="mt-3 text-sm font-semibold text-red-300">
              {upcomingEpisode.daysUntil} 天
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-white/50">
              {releaseDate ? `上映日: ${releaseDate}` : "\u00A0"}
            </p>
            {releaseCountdown ? (
              <p className="mt-3 text-sm font-semibold text-red-300">
                {releaseCountdown}
              </p>
            ) : null}
          </>
        )}
        <div className="mt-auto text-xs">
          {!upcomingEpisode && newEpisodeAlert ? (
            <div className="mb-2 inline-flex items-center justify-center rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-semibold leading-none text-white">
              {newEpisodeAlertLabel ?? "新集數提醒"}
            </div>
          ) : null}
          {upcomingEpisode ? null : displayEpisodeStatus ? (
            <>
              {hasMissingTag && (
                <p className="mb-1 text-[11px] font-semibold text-amber-300/90">
                  集數資料不完整
                </p>
              )}
              <p
                className={
                  displayEpisodeStatus.startsWith("已")
                    ? "text-emerald-300"
                    : hasUnwatchedGaps
                      ? "text-amber-300/90"
                      : "text-white/70"
                }
              >
                {displayEpisodeStatus}
              </p>
            </>
          ) : statusLoading ? (
            <p className="flex items-center gap-2 text-white/50">
              <span
                className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
                aria-hidden="true"
              />
              載入中...
            </p>
          ) : watchedDate ? (
            <>
              {watchedFriends && watchedFriends.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-white/60">
                  <span className="shrink-0">和</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {watchedFriends.map((friend) => (
                      <span
                        key={friend.id}
                        className="flex items-center text-white/80"
                      >
                        <span
                          className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-white/5 text-[10px] font-semibold ${
                            friend.isOwner
                              ? "border-amber-300 text-white border-2"
                              : "border-white/15 text-white"
                          }`}
                          aria-hidden="true"
                        >
                          {friend.avatarUrl ? (
                            <Image
                              src={friend.avatarUrl}
                              alt=""
                              fill
                              sizes="24px"
                              className="object-cover"
                            />
                          ) : (
                            getInitial(friend.name)
                          )}
                        </span>
                      </span>
                    ))}
                  </div>
                  <span className="shrink-0">一起看</span>
                </div>
              )}
              <p className="text-emerald-300">
                {displayCount > 1
                  ? `已觀看 ${displayCount} 次: ${watchedDate} (最新)`
                  : `已觀看: ${watchedDate}`}
              </p>
            </>
          ) : showMetadataLoading ? (
            <p className="text-white/50">資料載入中...</p>
          ) : (
            <span className="text-transparent">.</span>
          )}
        </div>
      </div>
    </button>
  );
}
