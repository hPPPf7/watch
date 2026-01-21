"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
    const { data } = await supabase
      .from("profiles")
      .select("id, nickname, avatar_url")
      .in("id", stableIds);

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

    load();

    const channel = supabase
      .channel(`profiles-${stableIds.join("-")}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=in.(${stableIds.join(",")})`,
        },
        (payload) => {
          const id = (payload.new as { id?: string } | null)?.id;
          if (!id) return;
          const next = payload.new as
            | { nickname?: string | null; avatar_url?: string | null }
            | null;
          setNames((prev) => ({
            ...prev,
            [id]: {
              nickname: next?.nickname ?? null,
              avatarUrl: next?.avatar_url ?? null,
            },
          }));
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [stableIds]);

  return names;
}
