"use client";

import { useEffect, useMemo, useState } from "react";

type ProfileInfo = {
  nickname: string | null;
  avatarUrl: string | null;
};

type ProfileNameMap = Record<string, ProfileInfo>;

const normalizeIds = (ids: string[]) =>
  Array.from(new Set(ids.filter(Boolean)));

export default function useProfileNames(ids: string[]) {
  const idsKey = useMemo(() => normalizeIds(ids).join("|"), [ids]);
  const stableIds = useMemo(
    () => (idsKey ? idsKey.split("|") : []),
    [idsKey]
  );
  const [names, setNames] = useState<ProfileNameMap>({});

  useEffect(() => {
    if (stableIds.length === 0) {
      queueMicrotask(() => {
        setNames({});
      });
      return;
    }

    let isMounted = true;

    const load = async () => {
      const response = await fetch("/api/profiles/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: stableIds }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        rows?: Array<{
          id: string;
          nickname: string | null;
          avatar_url: string | null;
        }>;
      };
      const data = payload.rows ?? [];

      if (!isMounted) return;

      setNames((prev) => {
        const next = { ...prev };
        (data ?? []).forEach((entry) => {
          next[entry.id] = {
            nickname: entry.nickname ?? null,
            avatarUrl: entry.avatar_url ?? null,
          };
        });
        return next;
      });
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [stableIds]);

  return names;
}
