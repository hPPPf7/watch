import Image from "next/image";
import { useState } from "react";

type MediaCardProps = {
  title: string;
  subtitle: string;
  posterPath: string | null;
  onClick?: () => void;
};

export default function MediaCard({
  title,
  subtitle,
  posterPath,
  onClick,
}: MediaCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div
      className="w-full cursor-pointer select-none rounded-lg bg-white/5 p-2 hover:bg-white/10"
      onClick={onClick}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-black/20">
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
          />
        ) : null}
      </div>
      <div className="mt-2 grid grid-rows-[40px_auto] gap-1">
        <p className="h-10 text-sm font-semibold leading-5 text-white/90 select-none line-clamp-2 overflow-hidden">
          {title}
        </p>
        <p className="text-xs text-white/50 select-none">{subtitle}</p>
      </div>
    </div>
  );
}
