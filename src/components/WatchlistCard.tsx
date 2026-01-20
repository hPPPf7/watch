"use client";

import Image from "next/image";

type WatchlistCardProps = {
  title: string;
  posterPath: string | null;
  watchedDate?: string | null;
  watchedFriends?: string[];
  sharedOwnerName?: string | null;
  onClick?: () => void;
};

export default function WatchlistCard({
  title,
  posterPath,
  watchedDate,
  watchedFriends,
  sharedOwnerName,
  onClick,
}: WatchlistCardProps) {
  const getInitial = (value: string) => value.trim().slice(0, 1).toUpperCase();
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
            alt={title}
            fill
            sizes="80px"
            className="object-cover"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <h3 className="text-sm font-semibold text-white">
          {title || "未提供片名"}
        </h3>
        {watchedDate && (
          <div className="text-xs">
            <p className="text-emerald-300">已觀看：{watchedDate}</p>
            {watchedFriends && watchedFriends.length > 0 && (
              <div className="mt-2 flex items-center gap-2 overflow-x-auto text-white/60">
                <span className="shrink-0">和</span>
                <div className="flex items-center gap-2">
                  {watchedFriends.map((name, index) => (
                    <span
                      key={`${name}-${index}`}
                      className="flex items-center gap-2 text-white/80"
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full border bg-white/5 text-[10px] font-semibold ${
                          sharedOwnerName === name
                            ? "border-amber-300/60 text-white"
                            : "border-white/15 text-white"
                        }`}
                        aria-hidden="true"
                      >
                        {getInitial(name)}
                      </span>
                      <span
                        className={`whitespace-nowrap font-semibold ${
                          sharedOwnerName === name ? "text-amber-300" : "text-white"
                        }`}
                      >
                        {name}
                      </span>
                    </span>
                  ))}
                </div>
                <span className="shrink-0">一起看</span>
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
