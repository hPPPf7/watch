import { NextResponse } from "next/server";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type TMDBCollectionItem = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
};

type TMDBCollectionResponse = {
  id: number;
  name?: string;
  parts?: TMDBCollectionItem[];
};

type CollectionItem = {
  id: number;
  title: string;
  year: string | null;
  poster_path: string | null;
};

type CollectionResponse = {
  id: number;
  name: string | null;
  items: CollectionItem[];
};

const buildCollectionUrl = (id: string, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/collection/${id}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", language);
  return url.toString();
};

const extractYear = (dateValue?: string) => {
  if (!dateValue) return null;
  return dateValue.slice(0, 4) || null;
};

const normalizeCollection = (payload: TMDBCollectionResponse): CollectionResponse => {
  const items = (payload.parts ?? []).map((item) => ({
    id: item.id,
    title: item.title ?? item.original_title ?? "",
    year: extractYear(item.release_date),
    poster_path: item.poster_path ?? null,
  }));

  const sortedItems = items.slice().sort((a, b) => {
    const aYear = a.year ? Number(a.year) : 9999;
    const bYear = b.year ? Number(b.year) : 9999;
    if (aYear !== bYear) return aYear - bYear;
    return a.id - b.id;
  });

  return {
    id: payload.id,
    name: payload.name ?? null,
    items: sortedItems,
  };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const [primaryRes, fallbackRes] = await Promise.all([
    fetch(buildCollectionUrl(id, "zh-TW"), { cache: "no-store" }),
    fetch(buildCollectionUrl(id, "en-US"), { cache: "no-store" }),
  ]);

  if (!primaryRes.ok) {
    return NextResponse.json(
      { error: "TMDB collection failed" },
      { status: primaryRes.status }
    );
  }

  const primary = normalizeCollection(
    (await primaryRes.json()) as TMDBCollectionResponse
  );

  if (!fallbackRes.ok) {
    return NextResponse.json(primary);
  }

  const fallback = normalizeCollection(
    (await fallbackRes.json()) as TMDBCollectionResponse
  );

  const fallbackMap = new Map<number, CollectionItem>();
  fallback.items.forEach((item) => fallbackMap.set(item.id, item));

  const mergedItems = primary.items.map((item) => {
    if (item.title && item.year) return item;
    const fallbackItem = fallbackMap.get(item.id);
    if (!fallbackItem) return item;
    return {
      ...item,
      title: item.title || fallbackItem.title,
      year: item.year ?? fallbackItem.year,
      poster_path: item.poster_path ?? fallbackItem.poster_path,
    };
  });

  const merged: CollectionResponse = {
    id: primary.id,
    name: primary.name ?? fallback.name,
    items: mergedItems,
  };

  return NextResponse.json(merged);
}
