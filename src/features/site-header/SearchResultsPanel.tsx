"use client";

import { useId, useState, type ReactNode } from "react";
import type { SearchResult } from "@/features/site-header/useMediaSearch";
import styles from "./SearchResultsPanel.module.css";

type Category = "all" | "movie" | "tv" | "anime";

const categories: { value: Category; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "movie", label: "電影" },
  { value: "tv", label: "影集" },
  { value: "anime", label: "動畫" },
];

function categoryOf(item: SearchResult): Exclude<Category, "all"> {
  return item.media_type === "movie" ? "movie" : item.is_anime ? "anime" : "tv";
}

type SearchResultsPanelProps = {
  query: string;
  results: SearchResult[];
  loading: boolean;
  loadingStatus?: string | null;
  error: string;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: string;
  onLoadMore: () => void;
  children?: ReactNode;
  renderCard: (item: SearchResult) => ReactNode;
};

export default function SearchResultsPanel({
  query,
  results,
  loading,
  loadingStatus,
  error,
  onRetry,
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
  children,
  renderCard,
}: SearchResultsPanelProps) {
  const headingId = useId();
  const filterHintId = useId();
  const [filter, setFilter] = useState<{ query: string; category: Category }>({ query, category: "all" });
  // Reset only the local filter, leaving the search data and request state with the parent.
  if (filter.query !== query) {
    setFilter({ query, category: "all" });
  }
  const category = filter.query === query ? filter.category : "all";
  const categoryLabel = categories.find((item) => item.value === category)!.label;
  const counts: Record<Category, number> = { all: results.length, movie: 0, tv: 0, anime: 0 };
  for (const item of results) counts[categoryOf(item)] += 1;
  const visibleResults = category === "all" ? results : results.filter((item) => categoryOf(item) === category);
  const hasResults = results.length > 0;
  const loadingMessage = loading ? "搜尋中…" : loadingStatus;

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.heading}>
        <div className={styles.headingTitle}>
          <h1 id={headingId}>搜尋結果</h1>
          {loadingMessage && (
            <span className={styles.headingLoading} role="status" title={loadingMessage}>
              <span className="watch-spinner" aria-hidden="true" />
              <span className="sr-only">{loadingMessage}</span>
            </span>
          )}
        </div>
        <p className={styles.queryLine}>
          <span className={styles.queryWord} title={query || undefined}>{query ? `「${query}」` : "搜尋電影、影集與動畫"}</span>
          {!loading && (!error || hasResults) && (
            <>
              <span className={styles.separator} aria-hidden="true" />
              <span className={styles.resultCount} role="status" aria-live="polite">目前載入 {results.length} 部</span>
            </>
          )}
        </p>
      </div>

      {!loading && hasResults && (
        <div className={styles.filtersLine}>
          <div className={styles.filters} role="group" aria-label="篩選目前載入的搜尋結果" aria-describedby={filterHintId}>
            {categories.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={category === item.value}
                onClick={() => setFilter({ query, category: item.value })}
              >
                {item.label}<span className={styles.count}>{counts[item.value]}</span>
              </button>
            ))}
          </div>
          <p id={filterHintId} className={styles.filterHint}>篩選目前載入的作品</p>
        </div>
      )}

      {loading ? (
        <>
          <div aria-busy="true" aria-label="搜尋結果載入中">
            <ul className={styles.grid} aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
                <li key={index}>
                  <div className={styles.skeleton}>
                    <div className={styles.skeletonPoster} />
                    <div className={styles.skeletonLine} />
                    <div className={styles.skeletonShortLine} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <>
          {error && (
            <div className={`${styles.stateBox} ${styles.error}`} role="alert">
              <h2>暫時無法取得搜尋結果</h2>
              <p>{error}</p>
              <button type="button" className={`watch-button ${styles.action}`} onClick={onRetry}>重試</button>
            </div>
          )}
          {children && <div className={styles.notices}>{children}</div>}
          {hasResults ? (
            visibleResults.length > 0 ? (
              <ul className={styles.grid} aria-label={`${categoryLabel}搜尋結果`} aria-busy={loadingMore}>
                {visibleResults.map((item) => (
                  <li key={`${item.media_type}:${item.id}`}>{renderCard(item)}</li>
                ))}
              </ul>
            ) : (
              <div className={styles.stateBox} role="status">
                <h2>目前載入的作品沒有{categoryLabel}</h2>
                <p>{hasMore ? "可選擇其他分類，或載入更多作品。" : "可選擇其他分類查看。"}</p>
              </div>
            )
          ) : !error ? (
            <div className={styles.stateBox} role="status">
              <h2>{hasMore ? "目前載入的頁面沒有可顯示作品" : query ? `沒有找到「${query}」相關作品` : "輸入片名開始搜尋"}</h2>
              <p>{hasMore ? "可以載入更多作品，或試試其他搜尋字詞。" : "試試其他片名或縮短搜尋字詞。"}</p>
            </div>
          ) : null}
          {(hasMore || loadingMore || moreError) && (
            <div className={styles.more}>
              {moreError && <p className={styles.moreError} role="alert">{moreError}</p>}
              <button type="button" className={`watch-button ${styles.action} ${styles.moreAction}`} disabled={loadingMore} aria-busy={loadingMore} aria-label={loadingMore ? "正在載入更多作品…" : undefined} onClick={onLoadMore}>
                <span className="watch-spinner-slot" aria-hidden="true">{loadingMore && <span className="watch-spinner" />}</span>
                {loadingMore ? "載入中…" : moreError ? "重試載入更多" : "載入更多"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
