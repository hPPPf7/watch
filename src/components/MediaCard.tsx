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
}: MediaCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div
      className="relative w-full cursor-pointer select-none rounded-lg bg-white/5 p-2 hover:bg-white/10"
      onClick={onClick}
    >
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg bg-black/20">
        {posterPath && !imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          </div>
        )}
        {posterPath ? (
          <Image
            src={`https://image.tmdb.org/t/p/w342${posterPath}`}
            alt={title}
            fill
            sizes="192px"
            className="select-none object-cover"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            priority={priority}
            loading={priority ? "eager" : "lazy"}
          />
        ) : null}
      </div>
      <div className="mt-2 grid grid-rows-[40px_auto] gap-1">
        <p className="h-10 text-sm font-semibold leading-5 text-white/90 select-none line-clamp-2 overflow-hidden">
          {title}
        </p>
        <p className="text-xs text-white/50 select-none">{subtitle}</p>
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
