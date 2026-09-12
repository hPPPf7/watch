"use client";

import { airedTotalHint, unavailableAiredTotalHint, previousAiredTotalHint, type DisplayEpisodeProgress } from "@/lib/episodeTotals";
import Image from "next/image";
import { useState } from "react";

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
  episodeProgress?: DisplayEpisodeProgress | null;
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
  episodeProgress,
  statusLoading = false,
  newEpisodeAlert = false,
  newEpisodeAlertLabel,
  upcomingEpisode,
  onClick,
}: WatchlistCardProps) {
  const [loadedPosterPath, setLoadedPosterPath] = useState<string | null>(null);
  const [failedPosterPath, setFailedPosterPath] = useState<string | null>(null);
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
    Boolean(displayEpisodeStatus?.startsWith("有未觀看的集數"));

  const hasEpisodeWarning = hasMissingTag || hasUnwatchedGaps ||
    Boolean(displayEpisodeStatus?.startsWith("集數資料不完整"));
  const statusUnconfirmed = statusLoading || /^(暫時|無法|正在確認)/.test(episodeStatus ?? "") ||
    Boolean(episodeStatus?.includes("（暫時無法確認最新集數）"));
  const previousProgress = episodeProgress?.stale || statusUnconfirmed;
  const totalLabel = previousProgress ? "已播出 · 待更新" : "已播出集數";
  const totalHint = episodeProgress?.total === null ? unavailableAiredTotalHint : previousProgress ? previousAiredTotalHint : airedTotalHint;
  const progressComplete = episodeProgress?.watched === episodeProgress?.total;
  const progressTextClass = hasEpisodeWarning || episodeProgress?.total === null ? "text-amber-300/90" :
    progressComplete ? "text-emerald-300" : "text-sky-200/80";
  const progressFillClass = hasEpisodeWarning ? "bg-amber-300/65" :
    progressComplete ? "bg-emerald-300/70" : "bg-sky-200/55";

  const isTitlePlaceholder = /^TMDB\s+\d+$/i.test(title.trim());
  const showMetadataLoading = metadataLoading === true;
  const titleText = isTitlePlaceholder ? "未提供片名" : title || "未提供片名";
  const imageLoaded = Boolean(posterPath) && loadedPosterPath === posterPath;
  const imageFailed = Boolean(posterPath) && failedPosterPath === posterPath;

  const showProgress =
    !upcomingEpisode &&
    !releaseCountdown &&
    !showMetadataLoading &&
    (!statusUnconfirmed || typeof episodeProgress?.total === "number") &&
    episodeProgress &&
    Number.isSafeInteger(episodeProgress.watched) &&
    episodeProgress.watched >= 0 &&
    (episodeProgress.total === null || (Number.isSafeInteger(episodeProgress.total) &&
      episodeProgress.total > 0 && episodeProgress.watched <= episodeProgress.total));

  const compactMovie = Boolean(watchedDate) && !upcomingEpisode &&
    !episodeStatus && !statusLoading && !releaseCountdown && !newEpisodeAlert;
  const movieWatchLabel = displayCount > 1
    ? `已觀看 ${displayCount} 次：${watchedDate}（最新）`
    : `已觀看：${watchedDate}`;
  const movieFriendsLabel = watchedFriends?.length
    ? `和 ${watchedFriends.map((friend) => friend.name).join("、")} 一起看`
    : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className="watch-card-feedback flex w-full select-none gap-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
    >
      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-white/10">
        {posterPath && !imageLoaded && !imageFailed ? <div aria-hidden="true" className="absolute inset-0 bg-white/5" /> : null}
        {(!posterPath || imageFailed) && !showMetadataLoading ? <div className="flex h-full items-center justify-center text-[10px] text-white/50">暫無海報</div> : null}
        {posterPath && !imageFailed ? (
          <Image
            src={`https://image.tmdb.org/t/p/w185${posterPath}`}
            alt={titleText}
            fill
            sizes="80px"
            className="object-cover"
            loading="lazy"
            onLoad={() => {
              setLoadedPosterPath(posterPath);
              setFailedPosterPath((current) =>
                current === posterPath ? null : current,
              );
            }}
            onError={() => {
              setFailedPosterPath(posterPath);
            }}
          />
        ) : showMetadataLoading ? (
          <div className="h-full w-full bg-white/10" />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 title={titleText} className="line-clamp-2 text-sm font-semibold leading-5 text-white">{titleText}</h3>
        {showProgress ? (
          <div className="mt-1 flex min-h-4 min-w-0 items-center gap-2 text-[10px] leading-4">
            {hasMissingTag && (
              <span className="shrink-0 font-medium text-amber-300/90">集數資料不完整</span>
            )}
            {newEpisodeAlert && (
              <span title={newEpisodeAlertLabel ?? "新集數提醒"} className="min-w-0 truncate rounded-md border border-red-400/25 bg-red-400/10 px-1.5 font-medium text-red-200">
                {newEpisodeAlertLabel ?? "新集數提醒"}
              </span>
            )}
          </div>
        ) : upcomingEpisode ? (
          <>
            <p className="mt-2 text-xs text-white/70">
              S{upcomingEpisode.season}E{upcomingEpisode.episode}
              {upcomingEpisode.name ? ` - ${upcomingEpisode.name}` : ""}
            </p>
            <p className="mt-1 text-xs text-white/50">
              播出日: {upcomingEpisode.airDate}
            </p>
            <p className="mt-3 text-xs font-medium text-white/75">
              {upcomingEpisode.daysUntil} 天
            </p>
          </>
        ) : (
          <>
            <p className={showProgress || compactMovie ? "mt-1 text-[10px] leading-4 text-white/50" : "mt-2 text-xs text-white/50"}>
              {releaseDate ? `上映日: ${releaseDate}` : "\u00A0"}
            </p>
            {releaseCountdown ? (
              <p className="mt-3 text-xs font-medium text-white/75">
                {releaseCountdown}
              </p>
            ) : null}
          </>
        )}
        {showProgress && episodeProgress ? (
          <div className="mt-auto pt-1">
            {displayEpisodeStatus && (
              <p title={displayEpisodeStatus} className={`mb-1 truncate text-[11px] leading-4 ${hasUnwatchedGaps || displayEpisodeStatus.startsWith("集數資料不完整") ? "text-amber-300/90" : displayEpisodeStatus.startsWith("已看完") ? "text-emerald-300" : "text-white/70"}`}>
                {displayEpisodeStatus}
              </p>
            )}
            <div aria-hidden={episodeProgress.total !== null} className="flex flex-wrap items-center justify-between gap-x-2 text-[10px] leading-4">
              <span className={progressTextClass}>
                {episodeProgress.total === null ? `已看 ${episodeProgress.watched} 集` : `已看 ${episodeProgress.watched} / ${episodeProgress.total} 集`}
              </span>
              <span className="text-white/50" title={totalHint}>{episodeProgress.total === null ? "已播出待確認" : totalLabel}</span>
            </div>
            {episodeProgress.total !== null && <div
              role="progressbar"
              aria-label={`${totalLabel}觀看進度`}
              aria-valuemin={0}
              aria-valuemax={episodeProgress.total}
              aria-valuenow={episodeProgress.watched}
              aria-valuetext={`已看 ${episodeProgress.watched} / ${episodeProgress.total} 集（${previousProgress ? "上次確認，待更新" : "已播出集數，依 TMDB 播出日期計算"}）`}
              className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"
            >
              <div
                className={`h-full rounded-full ${progressFillClass}`}
                style={{ width: `${episodeProgress.watched / episodeProgress.total * 100}%` }}
              />
            </div>}
          </div>
        ) : compactMovie ? (
          <div className="mt-auto min-w-0 pt-1">
            {watchedFriends && watchedFriends.length > 0 && (
              <div title={movieFriendsLabel} aria-label={movieFriendsLabel} className="mb-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[10px] leading-5 text-white/60">
                <span aria-hidden="true" className="flex shrink-0 -space-x-1">
                  {watchedFriends.slice(0, 4).map((friend) => (
                    <span key={friend.id} className={`relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-neutral-800 text-[9px] text-white/80 ${friend.isOwner ? "border-amber-300" : "border-white/20"}`}>
                      {friend.avatarUrl ? (
                        <Image src={friend.avatarUrl} alt="" fill sizes="20px" className="object-cover" />
                      ) : getInitial(friend.name)}
                    </span>
                  ))}
                  {watchedFriends.length > 4 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-white/20 bg-neutral-800 px-1 text-[9px] text-white/80">+{watchedFriends.length - 4}</span>
                  )}
                </span>
                <span aria-hidden="true" className="min-w-0 truncate">一起看</span>
              </div>
            )}
            <p title={movieWatchLabel} className="truncate text-[11px] leading-4 text-emerald-300">
              {movieWatchLabel}
            </p>
          </div>
        ) : (
        <div className="mt-auto pt-3 text-xs leading-5">
          {!upcomingEpisode && newEpisodeAlert ? (
            <div className="mb-2 inline-flex items-center justify-center rounded-md border border-red-400/25 bg-red-400/10 px-2 py-0.5 text-[10px] font-medium leading-4 text-red-200">
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
                  displayEpisodeStatus.startsWith("已看完")
                    ? "text-emerald-300"
                    : hasEpisodeWarning
                      ? "text-amber-300/90"
                      : "text-white/70"
                }
              >
                {displayEpisodeStatus}
              </p>
            </>
          ) : statusLoading ? (
            <p className="text-white/50">正在載入進度…</p>
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
          ) : (
            <span className="text-transparent">.</span>
          )}

        </div>
        )}
      </div>
    </button>
  );
}
