import Image from "next/image";
import { useState } from "react";

type MediaCardProps = {
  title: string;
  subtitle: string;
  posterPath: string | null;
  onClick?: () => void;
  showWatchlistToggle?: boolean;
  watchlistActive?: boolean;
  onToggleWatchlist?: (anchorEl: HTMLButtonElement) => void;
  priority?: boolean;
  statusBadge?: { label: string; tone: "green" | "blue" } | null;
};

export default function MediaCard({
  title,
  subtitle,
  posterPath,
  onClick,
  showWatchlistToggle = false,
  watchlistActive = false,
  onToggleWatchlist,
  priority = false,
  statusBadge = null,
}: MediaCardProps) {
  const [loadedPosterPath, setLoadedPosterPath] = useState<string | null>(null);
  const [failedPosterPath, setFailedPosterPath] = useState<string | null>(null);
  const imageLoaded = Boolean(posterPath) && loadedPosterPath === posterPath;
  const imageFailed = Boolean(posterPath) && failedPosterPath === posterPath;

  return (
    <div
      className="watch-card-feedback relative w-full cursor-pointer select-none rounded-lg bg-white/5 p-2 hover:bg-white/10"
      onClick={onClick}
    >
      {statusBadge && (
        <div
          className={`absolute left-2 top-2 z-10 rounded-md border px-2 py-0.5 text-[10px] font-medium leading-4 ${
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
      <div className="mt-2 grid grid-rows-[40px_auto] gap-1">
        <p title={title} className="h-10 text-sm font-semibold leading-5 text-white/90 select-none line-clamp-2 overflow-hidden">
          {title}
        </p>
        <p className={`text-xs leading-5 text-white/55 select-none ${showWatchlistToggle ? "pr-9" : ""}`}>{subtitle}</p>
      </div>
      {showWatchlistToggle && (
        <button
          type="button"
          className={`absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/80 transition hover:text-white ${
            watchlistActive ? "text-yellow-300" : ""
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleWatchlist?.(event.currentTarget);
          }}
          aria-label={watchlistActive ? "移除清單" : "加入清單"}
          aria-pressed={watchlistActive}
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
