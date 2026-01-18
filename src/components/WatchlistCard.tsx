"use client";

type WatchlistCardProps = {
  title: string;
  posterPath: string | null;
  watchedDate?: string | null;
  onClick?: () => void;
};

export default function WatchlistCard({
  title,
  posterPath,
  watchedDate,
  onClick,
}: WatchlistCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full select-none gap-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-white/30"
    >
      <div className="h-28 w-20 overflow-hidden rounded-xl bg-white/10">
        {posterPath ? (
          <img
            src={`https://image.tmdb.org/t/p/w185${posterPath}`}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <h3 className="text-sm font-semibold text-white">
          {title || "未提供片名"}
        </h3>
        {watchedDate && (
          <p className="text-xs text-emerald-300">已觀看：{watchedDate}</p>
        )}
      </div>
    </button>
  );
}
