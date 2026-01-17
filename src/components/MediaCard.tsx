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
  return (
    <div
      className="cursor-pointer select-none rounded-lg bg-white/5 p-2 hover:bg-white/10"
      onClick={onClick}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-black/20">
        {posterPath ? (
          <img
            src={`https://image.tmdb.org/t/p/w342${posterPath}`}
            alt={title}
            className="h-full w-full select-none object-cover"
            draggable={false}
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
