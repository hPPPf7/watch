// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
// Native image events are intentional in this isolated Next Image test stub.
// eslint-disable-next-line @next/next/no-img-element
vi.mock("next/image", () => ({ default: (props: ComponentProps<"img">) => <img alt={props.alt} src={props.src} onLoad={props.onLoad} onError={props.onError} /> }));
import WatchlistCard from "./WatchlistCard";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
 globalThis.IS_REACT_ACT_ENVIRONMENT = true;
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
async function render(props: Partial<ComponentProps<typeof WatchlistCard>> = {}) {
 await act(async () => root.render(<WatchlistCard title="測試影集" posterPath={null} episodeStatus="觀看中" episodeProgress={{watched:5,total:8}} {...props} />));
}
it("labels progress as aired episodes and exposes the correct count", async () => {
 await render(); const bar = host.querySelector('[role="progressbar"]')!;
 expect(bar.getAttribute("aria-valuenow")).toBe("5"); expect(bar.getAttribute("aria-valuemax")).toBe("8");
 expect(bar.getAttribute("aria-valuetext")).toBe("已看 5 / 8 集（已播出）");
});
it.each([
 {episodeProgress:null}, {episodeProgress:{watched:0,total:0}}, {episodeProgress:{watched:9,total:8}},
 {episodeProgress:{watched:-1,total:8}}, {episodeProgress:{watched:1,total:NaN}},
 {statusLoading:true}, {metadataLoading:true}, {episodeStatus:"觀看中 MISSING_EPISODE_DATA"},
 {episodeStatus:"暫時無法取得集數"},
 {upcomingEpisode:{season:1,episode:2,name:null,airDate:"2026-09-12",daysUntil:2}},
])("hides unreliable or inapplicable progress: %j", async (props) => {
 await render(props); expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
it("recovers from a failed poster when the card receives another poster", async () => {
 await render({posterPath:"/old.jpg"});
 await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
 expect(host.textContent).toContain("暫無海報"); expect(host.querySelector("img")).toBeNull();
 await render({posterPath:"/new.jpg"}); expect(host.querySelector("img")?.src).toContain("/new.jpg");
 expect(host.textContent).not.toContain("暫無海報");
});

it("combines the viewing position into compact progress while retaining new episode alerts", async () => {
 await render({episodeStatus:"看到第 1 季第 5 集",newEpisodeAlert:true});
 expect(host.textContent).not.toContain("看到第 1 季第 5 集");
 expect(host.textContent).toContain("已看 5 / 8 集");
 expect(host.textContent).toContain("新集數提醒");
});
it.each(["有未觀看的集數", "觀看中 MISSING_EPISODE_DATA"])("preserves important status instead of compact progress: %s", async (episodeStatus) => {
 await render({episodeStatus});
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.textContent).toContain(episodeStatus.includes("MISSING") ? "集數資料不完整" : episodeStatus);
});
