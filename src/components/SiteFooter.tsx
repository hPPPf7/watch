"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const tmdbNotice =
  "This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

export default function SiteFooter() {
  const [noticeExpanded, setNoticeExpanded] = useState(false);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!noticeExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!noticeRef.current?.contains(event.target as Node)) {
        setNoticeExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [noticeExpanded]);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0b0b0c]">
      <div
        ref={noticeRef}
        className="flex w-full items-center justify-center gap-3 px-8 py-2 text-xs text-[#c7c7c7] max-[1024px]:gap-2 max-[1024px]:px-3"
      >
        <Image
          src="/assets/tmdb/Primary%20short%20(blue)%20-%20SVG.svg"
          alt="TMDB logo"
          width={40}
          height={9}
          className="opacity-80"
          style={{ width: "60px", height: "14px" }}
          priority
        />
        <button
          type="button"
          onClick={() => setNoticeExpanded((value) => !value)}
          className={`text-left max-[1024px]:min-w-0 ${
            noticeExpanded ? "max-[1024px]:whitespace-normal" : "max-[1024px]:truncate"
          }`}
        >
          <span className="hidden max-[1024px]:inline">{tmdbNotice}</span>
          <span className="max-[1024px]:hidden">{tmdbNotice}</span>
        </button>
      </div>
    </footer>
  );
}
