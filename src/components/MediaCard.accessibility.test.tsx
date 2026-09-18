// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("next/image", () => ({ default: () => null }));
import MediaCard from "./MediaCard";
it.each(["default", "home", "search"] as const)("uses separate native detail and star buttons, retaining pending and unknown semantics (%s)", async (presentation) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const detail = vi.fn(); const toggle = vi.fn();
  const props = { title: "作品", subtitle: "2026", posterPath: null, showWatchlistToggle: true, onClick: detail, onToggleWatchlist: toggle, presentation, statusBadge: { label: "已看完", tone: "green" as const } };
  try {
    await act(async () => root.render(<MediaCard {...props} />));
    expect(host.querySelector("button button")).toBeNull();
    expect(host.textContent?.match(/已看完/g)).toHaveLength(1);
    expect(host.textContent).toContain("2026");
    const buttons = host.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-label")).toBe("查看 作品 詳情");
    await act(async () => { buttons[0].click(); buttons[1].click(); });
    expect(detail).toHaveBeenCalledTimes(1); expect(toggle).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<MediaCard {...props} watchlistPending />));
    expect(buttons[1].disabled).toBe(true); expect(buttons[1].getAttribute("aria-busy")).toBe("true");
    await act(async () => root.render(<MediaCard {...props} watchlistUnknown />));
    expect(buttons[1].disabled).toBe(true); expect(buttons[1].hasAttribute("aria-pressed")).toBe(false);
  } finally { await act(async () => root.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = false; }
});
