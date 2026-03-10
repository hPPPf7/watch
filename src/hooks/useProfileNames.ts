"use client";

import { useEffect, useMemo, useState } from "react";
import { chunkProfileIds } from "@/lib/profileBulk";

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
      const payloads = await Promise.all(
        chunkProfileIds(stableIds).map(async (idsChunk) => {
          const response = await fetch("/api/profiles/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: idsChunk }),
          });
          if (!response.ok) {
            throw new Error("PROFILE_BULK_FAILED");
          }
          const payload = (await response.json()) as {
            rows?: Array<{
              id: string;
              nickname: string | null;
              avatar_url: string | null;
            }>;
          };
          return payload.rows ?? [];
        }),
      ).catch(() => null);
      if (!payloads) return;
      const data = payloads.flat();

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
