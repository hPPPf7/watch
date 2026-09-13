import Image from "next/image";
import { useState } from "react";

type MediaCardProps = {
  title: string;
  subtitle: string;
  posterPath: string | null;
  onClick?: () => void;
  showWatchlistToggle?: boolean;
  watchlistActive?: boolean;
  watchlistPending?: boolean;
  watchlistUnknown?: boolean;
  onToggleWatchlist?: (anchorEl: HTMLButtonElement) => void;
  priority?: boolean;
  statusBadge?: { label: string; tone: "green" | "blue" } | null;
  presentation?: "default" | "home";
};

export default function MediaCard({
  title,
  subtitle,
  posterPath,
  onClick,
  showWatchlistToggle = false,
  watchlistActive = false,
  watchlistPending = false,
  watchlistUnknown = false,
  onToggleWatchlist,
  priority = false,
  statusBadge = null,
  presentation = "default",
}: MediaCardProps) {
  const isHome = presentation === "home";
  const [loadedPosterPath, setLoadedPosterPath] = useState<string | null>(null);
  const [failedPosterPath, setFailedPosterPath] = useState<string | null>(null);
  const imageLoaded = Boolean(posterPath) && loadedPosterPath === posterPath;
  const imageFailed = Boolean(posterPath) && failedPosterPath === posterPath;
  const watchlistLabel = watchlistPending ? "清單更新中" : watchlistUnknown ? "清單狀態待確認" : watchlistActive ? "移除清單" : "加入清單";

  return (
    <div
      className={`watch-card-feedback relative isolate w-full cursor-pointer select-none ${isHome ? "min-w-0 rounded-[13px] bg-[#1b1c20] p-2.5 hover:bg-[#202126]" : "rounded-lg bg-white/5 p-2 hover:bg-white/10"}`}
    >
      <button
        type="button"
        className={`absolute inset-0 z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 ${isHome ? "rounded-[13px]" : "rounded-lg"}`}
        onClick={onClick}
        data-home-detail={isHome ? true : undefined}
        aria-label={`查看 ${title} 詳情`}
        title={isHome ? title : undefined}
      />
      {!isHome && statusBadge && (
        <div
          className={`pointer-events-none absolute left-2 top-2 z-10 rounded-md border px-2 py-0.5 text-[10px] font-medium leading-4 ${
            statusBadge.tone === "green"
              ? "border-emerald-400/30 bg-[#16241d] text-emerald-200"
              : "border-sky-400/30 bg-[#15212b] text-sky-200"
          }`}
        >
          {statusBadge.label}
        </div>
      )}
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg bg-black/20">
        {posterPath && !imageLoaded && !imageFailed ? <div aria-hidden="true" className="absolute inset-0 bg-white/5" /> : null}
        {!posterPath || imageFailed ? <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">暫無海報</div> : null}
        {posterPath && !imageFailed ? (
          <Image
            src={`https://image.tmdb.org/t/p/w342${posterPath}`}
            alt={title}
            fill
            sizes="192px"
            className="select-none object-cover"
            draggable={false}
            onLoad={() => setLoadedPosterPath(posterPath)}
            onError={() => setFailedPosterPath(posterPath)}
            priority={priority}
            loading={priority ? "eager" : "lazy"}
          />
        ) : null}
      </div>
      <div className={isHome ? "mt-2.5 grid grid-rows-[42px_32px] gap-1" : "mt-2 grid grid-rows-[40px_auto] gap-1"}>
        <p title={title} className={`select-none overflow-hidden text-sm font-semibold line-clamp-2 ${isHome ? "h-[42px] leading-[21px] text-[#f1f2f5]" : "h-10 leading-5 text-white/90"}`}>
          {title}
        </p>
        {isHome ? (
          <div className={`flex min-w-0 items-center gap-2 text-xs text-[#868b95] ${showWatchlistToggle ? "pr-9" : ""}`}>
            <span title={subtitle} className="min-w-0 truncate">{subtitle}</span>
            {statusBadge && (
              <span title={statusBadge.label} className={`ml-auto shrink-0 text-[10px] font-medium ${statusBadge.tone === "green" ? "text-watch-complete" : "text-watch-progress"}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
        ) : (
          <p className={`text-xs leading-5 text-white/55 select-none ${showWatchlistToggle ? "pr-9" : ""}`}>{subtitle}</p>
        )}
      </div>
      {showWatchlistToggle && (
        <button
          type="button"
          className={`absolute z-20 flex h-8 w-8 items-center justify-center transition hover:text-white disabled:cursor-wait disabled:opacity-50 ${
            isHome
              ? `bottom-2.5 right-2.5 rounded-[7px] bg-transparent hover:bg-white/5 ${watchlistActive ? "text-[#c9b588]" : "text-[#9499a2]"}`
              : `bottom-2 right-2 rounded-full bg-black/50 text-white/80 ${watchlistActive ? "text-yellow-300" : ""}`
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleWatchlist?.(event.currentTarget);
          }}
          disabled={watchlistPending || watchlistUnknown}
          data-home-bookmark={isHome ? true : undefined}
          aria-busy={watchlistPending}
          aria-label={watchlistLabel}
          title={isHome ? watchlistLabel : undefined}
          aria-pressed={watchlistUnknown ? undefined : watchlistActive}
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill={watchlistActive ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path
              d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.9L12 16.9 6.8 19.6l1-5.9-4.2-4.1 5.8-.8L12 3.5z"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
