import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./DetailOverview.module.css";

type DetailOverviewProps = {
  detail: {
    title: string;
    media_type: "movie" | "tv";
    is_anime: boolean;
    year: string | null;
    start_year: string | null;
    end_year: string | null;
    seasons?: number | null;
    runtime: number | null;
    countries: string[];
    languages: string[];
    overview: string | null;
    poster_path: string | null;
    homepage: string | null;
    collection_id?: number | null;
  };
  status: string | null | undefined;
  collectionOpen: boolean;
  onToggleCollection: () => void;
  children: ReactNode;
};

/** Presentation only; loading, collection actions and private state stay in DetailModal. */
export default function DetailOverview({ detail, status, collectionOpen, onToggleCollection, children }: DetailOverviewProps) {
  const year = detail.media_type === "tv" && detail.start_year && detail.end_year && detail.start_year !== detail.end_year
    ? `${detail.start_year} - ${detail.end_year}` : detail.year ?? "未提供";
  return (
    <div className={styles.overview}>
      <div className={styles.poster}>
        {detail.poster_path && <Image src={`https://image.tmdb.org/t/p/w342${detail.poster_path}`} alt={detail.title} fill sizes="288px" className="object-cover" />}
      </div>
      <div className={styles.content}>
        <div className={styles.heading}>
          <h2>{detail.title}</h2>
          {detail.media_type === "tv" && status && <span className={styles.status}>{status}</span>}
        </div>
        <div className={styles.metadata}>
          <span className={styles.year}><span className="sr-only">年份：</span>{year}</span>
          <span className={styles.runtime}><span className="sr-only">時長：</span>{detail.runtime ? detail.media_type === "tv" ? `每集約 ${detail.runtime} 分鐘` : `${detail.runtime} 分鐘` : "時長未提供"}</span>
          <span>{detail.media_type === "movie" ? "電影" : detail.is_anime ? "動畫" : "影集"}{detail.media_type === "tv" && Boolean(detail.seasons) && ` · ${detail.seasons} 季`}</span>
          <span><small>國家</small>{detail.countries.length ? detail.countries.join(" / ") : "未提供"}</span>
          <span><small>語言</small>{detail.languages.length ? detail.languages.join(" / ") : "未提供"}</span>
          {detail.homepage && <a href={detail.homepage} target="_blank" rel="noreferrer">官方網站</a>}
          {detail.media_type === "movie" && Boolean(detail.collection_id) && <button type="button" className={`watch-button watch-button--small ${styles.collectionToggle}`} onClick={onToggleCollection}>{collectionOpen ? "關閉系列清單" : "查看系列電影"}</button>}
        </div>
        {collectionOpen ? <div className={styles.collection}>{children}</div> : <>
          <p className={styles.summaryLabel}>故事簡介</p>
          <div className={styles.summary} tabIndex={0} aria-label="故事簡介"><p>{detail.overview || "未提供簡介。"}</p></div>
        </>}
      </div>
    </div>
  );
}

export function DetailOverviewSkeleton() {
  return <div className={styles.overview} aria-busy="true" aria-label="正在讀取作品詳情">
    <div className={styles.poster} />
    <div className={`${styles.content} gap-3`}>
      <p role="status" className="watch-loading text-sm"><span className="watch-spinner" aria-hidden="true" />正在讀取作品詳情…</p>
      <div className="h-7 w-1/2 shrink-0 rounded bg-watch-selected" />
      <div className="h-4 w-1/3 shrink-0 rounded bg-watch-selected" />
      <div className="h-4 w-2/3 shrink-0 rounded bg-watch-selected" />
      <div className="h-4 w-full shrink-0 rounded bg-watch-selected" />
      <div className="h-4 w-5/6 shrink-0 rounded bg-watch-selected" />
    </div>
  </div>;
}
