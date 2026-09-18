"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTmdbClient } from "@/lib/fetchTmdbClient";

export type SearchResult = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
  release_date: string | null;
  is_anime: boolean;
  poster_path: string | null;
};

type SearchPage = { results: SearchResult[]; page: number; total_pages: number };
type CachedPage = { data: SearchPage; expiresAt: number };
type SearchState = {
  query: string;
  results: SearchResult[];
  page: number;
  totalPages: number;
  expiresAt: number;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  moreError: string;
};
const EMPTY_RESULTS: SearchResult[] = [];
const pageCache = new Map<string, CachedPage>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_PAGES = 50;
const initialState: SearchState = {
  query: "", results: EMPTY_RESULTS, page: 0, totalPages: 0, expiresAt: 0,
  loading: false, loadingMore: false, error: "", moreError: "",
};

function uniqueResults(results: SearchResult[]) {
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = item.media_type + ":" + item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readPage(query: string, page: number, signal: AbortSignal): Promise<CachedPage> {
  const key = JSON.stringify([query.toLowerCase(), page]);
  const now = Date.now();
  for (const [cacheKey, entry] of pageCache) {
    if (entry.expiresAt <= now) pageCache.delete(cacheKey);
  }
  const cached = pageCache.get(key);
  if (cached) return cached;
  const response = await fetchTmdbClient(
    "/api/tmdb/search?query=" + encodeURIComponent(query) + "&page=" + page,
    { signal },
  );
  if (!response.ok) throw new Error(response.status === 429 ? "rate_limited" : "search_failed");
  const data = await response.json() as SearchPage;
  signal.throwIfAborted();
  if (!Array.isArray(data.results) || data.page !== page || !Number.isInteger(data.total_pages)
    || data.total_pages < 0 || data.total_pages > 500
    || data.results.some((item) => !item || !Number.isSafeInteger(item.id) || item.id <= 0
      || !["movie", "tv"].includes(item.media_type) || typeof item.title !== "string")) {
    throw new Error("invalid_search_page");
  }
  const entry = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  pageCache.set(key, entry);
  while (pageCache.size > CACHE_MAX_PAGES) pageCache.delete(pageCache.keys().next().value!);
  return entry;
}

function errorMessage(error: unknown, more = false) {
  if (error instanceof Error && error.message === "rate_limited") return "請求過於頻繁，請稍後再試。";
  return more ? "更多結果載入失敗，已載入的作品會保留。" : "搜尋失敗，請稍後再試。";
}

// Only public metadata is shared in pageCache. Account-owned stars/status stay in SiteHeader.
export default function useMediaSearch(query: string, enabled: boolean, composing: boolean) {
  const key = query.trim();
  const [state, setState] = useState<SearchState>(initialState);
  const stateRef = useRef(state);
  const controllerRef = useRef<AbortController | null>(null);
  const morePendingRef = useRef(false);
  const [retryToken, setRetryToken] = useState(0);
  const commit = useCallback((next: SearchState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    morePendingRef.current = false;
    const previous = stateRef.current;
    if (!key) {
      commit(initialState);
    } else if (!enabled || composing) {
      if (previous.loading || previous.loadingMore) commit({ ...previous, loading: false, loadingMore: false });
    } else if (previous.query === key && previous.expiresAt > Date.now()) {
      // Reopening retains all loaded pages; appending a page never extends the older pages' expiry.
      if (previous.loadingMore) commit({ ...previous, loadingMore: false });
    } else {
      commit({ ...initialState, query: key, loading: true });
      const timer = window.setTimeout(async () => {
        try {
          const entry = await readPage(key, 1, controller.signal);
          if (controller.signal.aborted) return;
          commit({
            ...initialState, query: key, results: uniqueResults(entry.data.results), page: 1,
            totalPages: entry.data.total_pages, expiresAt: entry.expiresAt,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          commit({ ...initialState, query: key, error: errorMessage(error) });
        }
      }, 400);
      return () => { controller.abort(); window.clearTimeout(timer); };
    }
    return () => controller.abort();
  }, [key, enabled, composing, retryToken, commit]);

  const loadMore = useCallback(async () => {
    const previous = stateRef.current;
    const controller = controllerRef.current;
    if (!enabled || composing || !controller || controller.signal.aborted || morePendingRef.current
      || previous.query !== key || previous.loading || previous.page < 1 || previous.page >= previous.totalPages) return;
    morePendingRef.current = true;
    commit({ ...previous, loadingMore: true, moreError: "" });
    try {
      const entry = await readPage(key, previous.page + 1, controller.signal);
      if (controller.signal.aborted) return;
      const results = uniqueResults([...previous.results, ...entry.data.results]);
      commit({
        ...previous, results: results.length === previous.results.length ? previous.results : results,
        page: entry.data.page, totalPages: entry.data.total_pages,
        expiresAt: Math.min(previous.expiresAt, entry.expiresAt), loadingMore: false, moreError: "",
      });
    } catch (error) {
      if (!controller.signal.aborted) commit({ ...previous, loadingMore: false, moreError: errorMessage(error, true) });
    } finally {
      if (controllerRef.current === controller) morePendingRef.current = false;
    }
  }, [key, enabled, composing, commit]);

  const matches = state.query === key;
  return {
    results: matches ? state.results : EMPTY_RESULTS,
    loading: Boolean(enabled && key && (composing || !matches || state.loading)),
    error: matches ? state.error : "",
    loadingMore: matches && state.loadingMore,
    moreError: matches ? state.moreError : "",
    hasMore: matches && state.page > 0 && state.page < state.totalPages,
    loadMore,
    retry: () => setRetryToken((value) => value + 1),
  };
}
