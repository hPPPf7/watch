export type HomeCarouselLayout = "compact" | "balanced";

function greatestCommonDivisor(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function getHomeCarouselGeometry(width: number, itemCount: number, layout: HomeCarouselLayout) {
  const viewport = Math.max(1, width);
  const gap = viewport <= 640 ? 10 : 12;
  const inset = viewport <= 640 ? 36 : 40;
  const slots = Math.max(2, Math.round(viewport / 204));
  const balancedFullCards = slots - 1;
  // Do not turn a button press into an exact full lap of the source list.
  let pageSize = itemCount > 2 ? Math.max(2, Math.min(itemCount - 1, balancedFullCards)) : 1;
  // A fixed stride must eventually expose every source item as a full card.
  // For example, advancing 2 through 20 items with 1 full slot skips every odd item.
  while (pageSize < itemCount - 1 && greatestCommonDivisor(pageSize, itemCount) > balancedFullCards) {
    pageSize += 1;
  }
  const fullCards = layout === "balanced"
    ? balancedFullCards
    : Math.max(1, Math.round((viewport - inset + gap) / 204 - 0.5));
  const cardWidth = layout === "balanced"
    ? viewport / slots - gap
    : (viewport - inset - fullCards * gap) / (fullCards + 0.5);
  return {
    inset,
    gap,
    fullCards,
    pageSize,
    cardWidth: Math.max(1, cardWidth),
    offset: layout === "balanced" ? cardWidth / 2 + gap : inset,
  };
}

export function getHomeCarouselCopies(itemCount: number, viewportCapacity: number) {
  if (itemCount < 2) return 1;
  // Three viewports plus a full source lap leave room for loopFix and page-sized moves.
  return Math.max(3, Math.ceil((Math.ceil(viewportCapacity / 180) * 3 + itemCount) / itemCount));
}

export function isHomeCardFullyVisible(
  card: Pick<DOMRect, "left" | "right">,
  viewport: Pick<DOMRect, "left" | "right">,
) {
  return card.left >= viewport.left - 0.6 && card.right <= viewport.right + 0.6;
}
