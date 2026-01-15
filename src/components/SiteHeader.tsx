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

export default function SiteHeader({ showLoginLink = true }: SiteHeaderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
                  href="/settings"
                  className="block rounded-lg px-3 py-2 hover:bg-white/10"
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
