import { describe, expect, it } from "vitest";
import { getHomeCarouselCopies, getHomeCarouselGeometry, isHomeCardFullyVisible } from "./homeCarouselGeometry";

describe("home carousel geometry", () => {
  it.each([280, 320, 390, 640, 641, 768, 1024, 1440, 1920, 2560, 3840, 7680])(
    "keeps a compact initial gutter, then exactly equal half-card edges at %i px", width => {
      const compact = getHomeCarouselGeometry(width, 10, "compact");
      expect(compact.offset).toBe(width <= 640 ? 36 : 40);
      expect(compact.offset + compact.fullCards * (compact.cardWidth + compact.gap) + compact.cardWidth / 2).toBeCloseTo(width, 6);
      const balanced = getHomeCarouselGeometry(width, 10, "balanced");
      expect(balanced.offset).toBeCloseTo(balanced.cardWidth / 2 + balanced.gap);
      expect(balanced.cardWidth + balanced.fullCards * balanced.cardWidth + (balanced.fullCards + 1) * balanced.gap).toBeCloseTo(width, 6);
      expect(balanced.cardWidth).toBeGreaterThan(0);
      expect(balanced.pageSize).toBeGreaterThanOrEqual(2);
      expect(balanced.pageSize).toBeLessThan(10);
    },
  );
  it.each([2, 3, 10, 20])("reserves bounded local slides for both page directions with %i source items", count => {
    for (const width of [320, 1440, 1920, 2560, 3840, 7680]) {
      const capacity = Math.max(1920, Math.ceil(width / 1920) * 1920);
      const copies = getHomeCarouselCopies(count, capacity);
      const geometry = getHomeCarouselGeometry(width, count, "balanced");
      const visible = Math.ceil(width / (geometry.cardWidth + geometry.gap));
      const looped = Math.ceil(visible / 2) + geometry.pageSize;
      expect(copies * count).toBeGreaterThan(visible + 2 * looped);
      expect(geometry.pageSize % count).not.toBe(0);
    }
  });
  it("makes every title fully reachable with arrows alone in either direction", () => {
    for (const width of [280, 320, 390, 509, 510, 640, 768, 1024, 1440, 1920, 3840]) {
      for (let count = 2; count <= 40; count += 1) {
        const geometry = getHomeCarouselGeometry(width, count, "balanced");
        for (const direction of [-1, 1]) {
          const seen = new Set<number>();
          let first = 0;
          for (let page = 0; page < count; page += 1) {
            for (let slot = 0; slot < geometry.fullCards; slot += 1) seen.add((first + slot) % count);
            first = (first + direction * geometry.pageSize + count) % count;
          }
          expect(seen.size, `${width}px, ${count} titles, direction ${direction}`).toBe(count);
        }
        const capacity = Math.max(1920, Math.ceil(width / 1920) * 1920);
        const visible = Math.ceil(width / (geometry.cardWidth + geometry.gap));
        const looped = Math.ceil(visible / 2) + geometry.pageSize;
        expect(getHomeCarouselCopies(count, capacity) * count).toBeGreaterThan(visible + 2 * looped);
      }
    }
  });
  it("does not duplicate a single item or treat a clipped card as a detail target", () => {
    expect(getHomeCarouselCopies(1, 3840)).toBe(1);
    const viewport = { left: 0, right: 1440 };
    expect(isHomeCardFullyVisible({ left: 12, right: 204 }, viewport)).toBe(true);
    expect(isHomeCardFullyVisible({ left: -96, right: 96 }, viewport)).toBe(false);
    expect(isHomeCardFullyVisible({ left: 1344, right: 1536 }, viewport)).toBe(false);
    expect(isHomeCardFullyVisible({ left: -0.2, right: 191.8 }, viewport)).toBe(true);
  });
});
