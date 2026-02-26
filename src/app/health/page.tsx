"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

type Status = "ok" | "warning" | "error";

type CheckItem = {
  key: string;
  category: "connection" | "feature";
  source: "auth" | "neon" | "tmdb" | "runtime";
  label: string;
  status: Status;
  rule: string;
  detail: string;
};

type HealthResponse = {
  overall: Status;
  generatedAt: string;
  checks: CheckItem[];
};

const statusText = (status: Status) => {
  if (status === "ok") return "正常";
  if (status === "warning") return "警告";
  return "錯誤";
};

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/health/stack", { cache: "no-store" });
      if (!response.ok) throw new Error(`Health API failed: ${response.status}`);
      const payload = (await response.json()) as HealthResponse;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const sourceGrouped = useMemo(() => {
    const empty = {
      auth: [] as CheckItem[],
      neon: [] as CheckItem[],
      tmdb: [] as CheckItem[],
      runtime: [] as CheckItem[],
    };
    if (!data) return empty;
    return {
      auth: data.checks.filter((item) => item.source === "auth"),
      neon: data.checks.filter((item) => item.source === "neon"),
      tmdb: data.checks.filter((item) => item.source === "tmdb"),
      runtime: data.checks.filter((item) => item.source === "runtime"),
    };
  }, [data]);

  const sourceLabel: Record<CheckItem["source"], string> = {
    auth: "Auth.js",
    neon: "Neon",
    tmdb: "TMDB",
    runtime: "部署環境",
  };

  const renderCard = (item: CheckItem) => (
    <article
      key={item.key}
      className="rounded-xl border border-white/10 bg-white/5 p-3"
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.15em] ${
            item.status === "ok"
              ? "border border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : item.status === "warning"
                ? "border border-amber-400/40 bg-amber-500/10 text-amber-300"
                : "border border-red-400/40 bg-red-500/10 text-red-300"
          }`}
        >
          {item.status}
        </span>
        <h3 className="text-sm font-semibold text-white">{item.label}</h3>
      </div>
      <p className="mt-2 text-xs text-white/70">{item.detail}</p>
      <p className="mt-1 text-xs text-white/50">類型：{item.category === "connection" ? "連線檢查" : "功能檢查"}</p>
      <p className="mt-1 text-xs text-white/50">判斷規則：{item.rule}</p>
    </article>
  );

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto w-full page-shell">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">系統健康檢查</h1>
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                onClick={() => load().catch(() => undefined)}
              >
                重新檢查
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              <p>整體狀態：{data ? statusText(data.overall) : "-"}</p>
              <p className="mt-1 text-xs text-white/50">
                檢查時間：{data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "-"}
              </p>
            </div>

            {loading && <p className="mt-4 text-sm text-white/60">檢查中...</p>}
            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

            {!loading && !error && data && (
              <div className="mt-4 grid gap-5">
                {(Object.keys(sourceGrouped) as Array<CheckItem["source"]>).map((source) => {
                  const items = sourceGrouped[source];
                  if (items.length === 0) return null;
                  return (
                    <section key={source}>
                      <h2 className="mb-2 text-sm font-semibold text-white/80">
                        {sourceLabel[source]}
                      </h2>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {items.map(renderCard)}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
