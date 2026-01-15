"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

const navItems = [
  { label: "首頁", href: "/" },
  { label: "電影", href: "/movies" },
  { label: "影集", href: "/series" },
  { label: "動畫", href: "/anime" },
  { label: "行事曆", href: "/calendar" },
];

type SiteHeaderProps = {
  showLoginLink?: boolean;
};

type SearchResult = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
  poster_path: string | null;
};

type CachedSearch = {
  results: SearchResult[];
  expiresAt: number;
};

const searchCache = new Map<string, CachedSearch>();
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;

export default function SiteHeader({ showLoginLink = true }: SiteHeaderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!searchOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!searchRef.current) return;
      if (!searchRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchOpen]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setSearchError("");
      setSearchOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      setSearchOpen(true);

      try {
        const cached = searchCache.get(trimmed);
        if (cached && cached.expiresAt > Date.now()) {
          setResults(cached.results);
          setSearchLoading(false);
          return;
        }

        const response = await fetch(
          `/api/tmdb/search?query=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("search failed");
        }

        const data = await response.json();
        const nextResults = data.results ?? [];
        setResults(nextResults);
        searchCache.set(trimmed, {
          results: nextResults,
          expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setSearchError("搜尋失敗，請稍後再試。");
        setResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const userInitial =
    session?.user?.email?.trim().charAt(0).toUpperCase() ?? "U";

  return (
    <header className="fixed inset-x-0 top-0 z-20 border-b border-white/10 bg-[#0b0b0c]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <nav className="flex items-center gap-8 text-sm tracking-wide text-[#cfcfcf]">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="relative mx-6 flex-1" ref={searchRef}>
          <input
            type="search"
            placeholder="搜尋"
            className="h-9 w-full rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white/80 outline-none placeholder:text-white/40 focus:border-white/30"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (query.trim().length >= 2) setSearchOpen(true);
            }}
          />
          {searchOpen && (
            <div className="absolute left-0 right-0 top-11 z-30 rounded-2xl border border-white/10 bg-[#0b0b0c] p-3 text-xs text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
              {searchLoading && (
                <p className="px-2 py-2 text-white/60">搜尋中...</p>
              )}
              {!searchLoading && searchError && (
                <p className="px-2 py-2 text-red-300">{searchError}</p>
              )}
              {!searchLoading && !searchError && results.length === 0 && (
                <p className="px-2 py-2 text-white/60">沒有找到結果。</p>
              )}
              {!searchLoading && !searchError && results.length > 0 && (
                <ul className="max-h-80 overflow-y-auto">
                  {results.map((item) => (
                    <li
                      key={`${item.media_type}:${item.id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5"
                    >
                      <div className="h-12 w-8 flex-shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5">
                        {item.poster_path ? (
                          <img
                            src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                            alt={item.title}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-white/90">{item.title}</p>
                        <p className="mt-1 text-xs text-white/50">
                          {item.media_type === "movie" ? "電影" : "影集"}
                          {item.year ? ` · ${item.year}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {!session && showLoginLink && (
          <Link
            href="/login"
            className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
          >
            登入
          </Link>
        )}
        {session && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-white/80"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {userInitial}
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 mt-2 w-36 rounded-xl border border-white/10 bg-[#0b0b0c] p-2 text-xs text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                role="menu"
              >
                <Link
                  href="/account"
                  className="block rounded-lg px-3 py-2 hover:bg-white/10"
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                >
                  帳戶
                </Link>
                <Link
                  href="/friends"
                  className="mt-1 block rounded-lg px-3 py-2 hover:bg-white/10"
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                >
                  好友
                </Link>
                <Link
                  href="/settings"
                  className="mt-1 block rounded-lg px-3 py-2 hover:bg-white/10"
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                >
                  設定
                </Link>
                <button
                  type="button"
                  className="mt-1 w-full rounded-lg px-3 py-2 text-left text-red-300 hover:bg-red-500/10"
                  onClick={async () => {
                    setMenuOpen(false);
                    await handleSignOut();
                  }}
                  role="menuitem"
                >
                  登出
                </button>
              </div>
            )}
          </div>
        )}
        {!session && !showLoginLink && (
          <span className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80">
            登入
          </span>
        )}
      </div>
    </header>
  );
}
