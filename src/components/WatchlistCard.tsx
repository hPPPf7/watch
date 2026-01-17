"use client";

type WatchlistCardProps = {
  title: string;
  year: string | null;
  posterPath: string | null;
};

export default function WatchlistCard({
  title,
  year,
  posterPath,
}: WatchlistCardProps) {
  return (
    <div className="flex w-full select-none gap-4 rounded-2xl border border-white/10 bg-white/5 p-3">
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
        <p className="text-xs text-white/50">{year ?? "未提供"}</p>
      </div>
    </div>
  );
}
