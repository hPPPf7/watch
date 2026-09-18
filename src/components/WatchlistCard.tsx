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
  const hasStatusError = !statusLoading && (/^(暫時無法|無法)/.test(episodeStatus ?? "") ||
    Boolean(episodeStatus?.includes("（暫時無法確認最新集數）")));
  const previousProgress = episodeProgress?.stale || statusUnconfirmed;
  const totalLabel = previousProgress ? "已播出 · 待更新" : "已播出集數";
  const totalHint = episodeProgress?.total === null ? unavailableAiredTotalHint : previousProgress ? previousAiredTotalHint : airedTotalHint;
  const progressComplete = episodeProgress?.watched === episodeProgress?.total;
  const progressTextClass = hasEpisodeWarning || episodeProgress?.total === null ? "text-watch-warning" :
    progressComplete ? "text-watch-complete" : "text-watch-progress";
  const progressFillClass = hasEpisodeWarning ? "bg-watch-warning" :
    progressComplete ? "bg-watch-complete" : "bg-watch-progress";

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
      className="watch-card-feedback flex w-full min-w-0 select-none gap-3.5 rounded-[13px] border border-transparent bg-watch-surface p-4 text-left enabled:hover:border-watch-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-watch-focus"
    >
      <div className="relative h-29 w-20 shrink-0 overflow-hidden rounded-lg bg-watch-selected">
        {posterPath && !imageLoaded && !imageFailed ? <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-watch-surface"><span className="watch-spinner" /></div> : null}
        {(!posterPath || imageFailed) && !showMetadataLoading ? <div className="flex h-full items-center justify-center text-[10px] text-watch-text-muted">暫無海報</div> : null}
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
          <div className="flex h-full w-full items-center justify-center bg-watch-selected" aria-label="作品資料載入中"><span className="watch-spinner" aria-hidden="true" /></div>
        ) : null}
      </div>
      <div className="flex min-h-29 min-w-0 flex-1 flex-col">
        <h3 title={titleText} className="line-clamp-2 text-base font-semibold leading-[1.45] text-watch-text max-sm:text-[15px]">{titleText}</h3>
        {showProgress ? (
          <div className="mt-1 flex min-h-5 min-w-0 items-center gap-2 text-[10px] leading-4">
            {hasMissingTag && (
              <span className="shrink-0 font-medium text-watch-warning">集數資料不完整</span>
            )}
            {newEpisodeAlert && (
              <span title={newEpisodeAlertLabel ?? "新集數提醒"} className="min-w-0 truncate rounded-md border border-[#ae747e]/25 bg-white/2 px-1.5 font-medium text-[#d5b1b6]">
                {newEpisodeAlertLabel ?? "新集數提醒"}
              </span>
            )}
          </div>
        ) : upcomingEpisode ? (
          <>
            <p className="mt-2 text-xs text-watch-text-secondary">
              S{upcomingEpisode.season}E{upcomingEpisode.episode}
              {upcomingEpisode.name ? ` - ${upcomingEpisode.name}` : ""}
            </p>
            <p className="mt-1 text-xs text-watch-text-muted">
              播出日: {upcomingEpisode.airDate}
            </p>
            <p className="mt-3 text-xs font-medium text-watch-text-secondary">
              {upcomingEpisode.daysUntil} 天
            </p>
          </>
        ) : (
          <>
            <p className={showProgress || compactMovie ? "mt-1 text-[10px] leading-4 text-watch-text-muted" : "mt-2 text-xs text-watch-text-muted"}>
              {releaseDate ? `上映日: ${releaseDate}` : "\u00A0"}
            </p>
            {releaseCountdown ? (
              <p className="mt-3 text-xs font-medium text-watch-text-secondary">
                {releaseCountdown}
              </p>
            ) : null}
          </>
        )}
        {showProgress && episodeProgress ? (
          <div className="mt-auto pt-1.5">
            {displayEpisodeStatus && (
              <p title={displayEpisodeStatus} className={`mb-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 ${hasUnwatchedGaps || displayEpisodeStatus.startsWith("集數資料不完整") ? "text-watch-warning" : hasStatusError ? "text-watch-error" : displayEpisodeStatus.startsWith("已看完") ? "text-watch-complete" : "text-watch-text-secondary"}`}>
                <span className="min-w-0 truncate">{displayEpisodeStatus}</span>
                {statusLoading && <span className="watch-spinner" role="status" aria-label="正在更新觀看進度" title="正在更新觀看進度" />}
              </p>
            )}
            <div aria-hidden={episodeProgress.total !== null} className="flex flex-wrap items-center justify-between gap-x-2 text-[10px] leading-4.5">
              <span className={progressTextClass}>
                {episodeProgress.total === null ? `已看 ${episodeProgress.watched} 集` : `已看 ${episodeProgress.watched} / ${episodeProgress.total} 集`}
              </span>
              <span className="inline-flex items-center gap-1.5 text-watch-text-muted" title={totalHint}>
                {episodeProgress.total === null ? "已播出待確認" : totalLabel}
                {!displayEpisodeStatus && statusLoading && <span className="watch-spinner" aria-hidden="true" />}
              </span>
            </div>
            {episodeProgress.total !== null && <div
              role="progressbar"
              aria-label={`${totalLabel}觀看進度`}
              aria-valuemin={0}
              aria-valuemax={episodeProgress.total}
              aria-valuenow={episodeProgress.watched}
              aria-valuetext={`已看 ${episodeProgress.watched} / ${episodeProgress.total} 集（${previousProgress ? "上次確認，待更新" : "已播出集數，依 TMDB 播出日期計算"}）`}
              className="mt-0.5 h-0.75 overflow-hidden rounded-full bg-watch-hover"
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
              <div title={movieFriendsLabel} aria-label={movieFriendsLabel} className="mb-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[10px] leading-5 text-watch-text-muted">
                <span aria-hidden="true" className="flex shrink-0 -space-x-1">
                  {watchedFriends.slice(0, 4).map((friend) => (
                    <span key={friend.id} className={`relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-watch-selected text-[9px] text-watch-text-secondary ${friend.isOwner ? "border-watch-owner" : "border-watch-border"}`}>
                      {friend.avatarUrl ? (
                        <Image src={friend.avatarUrl} alt="" fill sizes="20px" className="object-cover" />
                      ) : getInitial(friend.name)}
                    </span>
                  ))}
                  {watchedFriends.length > 4 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-watch-border bg-watch-selected px-1 text-[9px] text-watch-text-secondary">+{watchedFriends.length - 4}</span>
                  )}
                </span>
                <span aria-hidden="true" className="min-w-0 truncate">一起看</span>
              </div>
            )}
            <p title={movieWatchLabel} className="truncate text-[11px] leading-4 text-watch-complete">
              {movieWatchLabel}
            </p>
          </div>
        ) : (
        <div className="mt-auto pt-3 text-xs leading-5">
          {!upcomingEpisode && newEpisodeAlert ? (
            <div className="mb-2 inline-flex items-center justify-center rounded-md border border-[#ae747e]/25 bg-white/2 px-2 py-0.5 text-[10px] font-medium leading-4 text-[#d5b1b6]">
              {newEpisodeAlertLabel ?? "新集數提醒"}
            </div>
          ) : null}
          {upcomingEpisode ? null : displayEpisodeStatus ? (
            <>
              {hasMissingTag && (
                <p className="mb-1 text-[11px] font-semibold text-watch-warning">
                  集數資料不完整
                </p>
              )}
              <p
                className={
                  hasStatusError
                    ? "text-watch-error"
                    : displayEpisodeStatus.startsWith("已看完")
                    ? "text-watch-complete"
                    : hasEpisodeWarning
                      ? "text-watch-warning"
                      : "text-watch-text-secondary"
                }
              >
                {displayEpisodeStatus}
                {statusLoading && <span className="watch-spinner ml-1.5 align-middle" role="status" aria-label="正在更新觀看進度" title="正在更新觀看進度" />}
              </p>
            </>
          ) : statusLoading ? (
            <p className="watch-loading"><span className="watch-spinner" aria-hidden="true" />正在載入進度…</p>
          ) : watchedDate ? (
            <>
              {watchedFriends && watchedFriends.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-watch-text-muted">
                  <span className="shrink-0">和</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {watchedFriends.map((friend) => (
                      <span
                        key={friend.id}
                        className="flex items-center text-watch-text-secondary"
                      >
                        <span
                          className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-watch-surface text-[10px] font-semibold ${
                            friend.isOwner
                              ? "border-watch-owner text-watch-text border-2"
                              : "border-watch-border text-watch-text"
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
              <p className="text-watch-complete">
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
