"use client";

import Image from "next/image";

type WatchlistCardProps = {
  title: string;
  posterPath: string | null;
  releaseDate?: string | null;
  watchedDate?: string | null;
  watchedCount?: number | null;
  watchedFriends?: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    isOwner: boolean;
  }>;
  onClick?: () => void;
};

export default function WatchlistCard({
  title,
  posterPath,
  releaseDate,
  watchedDate,
  watchedCount,
  watchedFriends,
  onClick,
}: WatchlistCardProps) {
  const getInitial = (value: string) => value.trim().slice(0, 1).toUpperCase();
  const displayCount = watchedDate ? watchedCount ?? 1 : 0;
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
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-sm font-semibold text-white">
          {title || "未提供片名"}
        </h3>
        <p className="mt-2 text-xs text-white/50">
          {releaseDate ? `上映日：${releaseDate}` : "\u00A0"}
        </p>
        <div className="mt-auto text-xs">
          {watchedDate ? (
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
                              ? "border-amber-300/60 text-white"
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
                  ? `已觀看${displayCount}次：${watchedDate}（最新）`
                  : `已觀看：${watchedDate}`}
              </p>
            </>
          ) : (
            <span className="text-transparent">—</span>
          )}
        </div>
      </div>
    </button>
  );
}
