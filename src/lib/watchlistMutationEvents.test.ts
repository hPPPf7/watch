// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWatchlistDirtyMarker,
  getWatchlistDirtyMarker,
  markWatchlistDirty,
} from "@/lib/watchlistMutationEvents";

const scope = {
  userId: "user-1",
  mediaType: "tv" as const,
  isAnime: true,
};

describe("watchlist mutation events", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the dirty scope", () => {
    markWatchlistDirty(scope);

    expect(getWatchlistDirtyMarker(scope)).toBeTruthy();
  });

  it("does not clear a newer mutation marker", () => {
    markWatchlistDirty(scope);
    const oldMarker = getWatchlistDirtyMarker(scope);
    markWatchlistDirty(scope);
    const newMarker = getWatchlistDirtyMarker(scope);

    clearWatchlistDirtyMarker(scope, oldMarker!);
    expect(getWatchlistDirtyMarker(scope)).toBe(newMarker);

    clearWatchlistDirtyMarker(scope, newMarker!);
    expect(getWatchlistDirtyMarker(scope)).toBeNull();
  });

  it("marks both affected TV sections after reclassification", () => {
    markWatchlistDirty(scope, [false, true]);

    expect(
      getWatchlistDirtyMarker({ ...scope, isAnime: false }),
    ).toBeTruthy();
    expect(getWatchlistDirtyMarker(scope)).toBeTruthy();
  });
});
