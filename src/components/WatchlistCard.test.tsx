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
it("labels known episode totals honestly and explains unaired episodes", async () => {
 await render(); const bar = host.querySelector('[role="progressbar"]')!;
 expect(bar.getAttribute("aria-valuenow")).toBe("5"); expect(bar.getAttribute("aria-valuemax")).toBe("8");
 expect(host.querySelector('[title="總集數可能包含尚未播出的集數"]')?.textContent).toBe("已知總集數");
 expect(bar.getAttribute("aria-valuetext")).toBe("已看 5 / 8 集（已知總集數，可能包含尚未播出的集數）");
});
it.each([
 {episodeProgress:null}, {episodeProgress:{watched:0,total:0}}, {episodeProgress:{watched:9,total:8}},
 {episodeProgress:{watched:-1,total:8}}, {episodeProgress:{watched:1,total:NaN}},
 {statusLoading:true}, {metadataLoading:true}, {episodeStatus:"正在確認最新集數…"},
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

it("preserves the next episode and title alongside progress and new episode alerts", async () => {
 await render({releaseDate:null,episodeStatus:"下一集：S1E6 - 新的開始",newEpisodeAlert:true});
 expect(host.textContent).toContain("下一集：S1E6 - 新的開始");
 expect(host.querySelector('[title="下一集：S1E6 - 新的開始"]')).not.toBeNull();
 expect(host.textContent).toContain("已看 5 / 8 集");
 expect(host.textContent).toContain("新集數提醒");
 expect(host.textContent).not.toContain("上映日");
});
it.each(["有未觀看的集數", "觀看中 MISSING_EPISODE_DATA", "下一集：S1E8 - 新的一天（中間有漏集）", "集數資料不完整"])("keeps yellow progress alongside episode warnings: %s", async (episodeStatus) => {
 await render({episodeStatus});
 expect(host.querySelector('[role="progressbar"]')?.firstElementChild?.className).toContain("bg-amber-300/65");
 expect(host.textContent).toContain(/MISSING|中間有漏集/.test(episodeStatus) ? "集數資料不完整" : episodeStatus);
});

it("keeps movie group viewing compact while retaining all friends and the latest viewing information", async () => {
 const watchedFriends = Array.from({length:8}, (_, i) => ({id:String(i),name:`好友${i+1}`,avatarUrl:`/avatar-${i}.jpg`,isOwner:i===0}));
 await render({title:"很長的電影名稱，這個名稱需要使用兩行來完整呈現",episodeStatus:null,episodeProgress:null,watchedDate:"2026-09-10",watchedCount:12,watchedFriends});
 expect(host.querySelectorAll("img")).toHaveLength(4);
 expect(host.textContent).toContain("+4");
 expect(host.querySelector('[aria-label="和 好友1、好友2、好友3、好友4、好友5、好友6、好友7、好友8 一起看"]')).not.toBeNull();
 expect(host.querySelector('[title="已觀看 12 次：2026-09-10（最新）"]')).not.toBeNull();
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
});

it("preserves caught-up status when known totals include future episodes", async () => {
 await render({episodeStatus:"已看完目前已播出集數",episodeProgress:{watched:5,total:12}});
 expect(host.textContent).toContain("已看完目前已播出集數");
 expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuemax")).toBe("12");
});

it("preserves the ended and fully watched status alongside progress", async () => {
 await render({releaseDate:null,episodeStatus:"已看完",episodeProgress:{watched:12,total:12}});
 expect(host.querySelector('[title="已看完"]')?.textContent).toBe("已看完");
 expect(host.textContent).not.toContain("已看完目前已播出集數");
 expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("12");
});
it.each(["今天上映", "3天後"])("preserves movie release reminders: %s", async (releaseCountdown) => {
 await render({title:"測試電影",releaseDate:"2026-09-13",releaseCountdown,episodeStatus:null,episodeProgress:null});
 expect(host.textContent).toContain("上映日: 2026-09-13");
 expect(host.textContent).toContain(releaseCountdown);
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
});

it("uses muted blue for unfinished progress and green only for complete totals", async () => {
 await render();
 expect(host.querySelector('[role="progressbar"]')?.firstElementChild?.className).toContain("bg-sky-200/55");
 expect(Array.from(host.querySelectorAll("span")).find(el => el.textContent === "已看 5 / 8 集")?.className).toContain("text-sky-200/80");
 await render({episodeStatus:"已看完",episodeProgress:{watched:8,total:8}});
 expect(host.querySelector('[role="progressbar"]')?.firstElementChild?.className).toContain("bg-emerald-300/70");
});
it("removes gap warnings after missing episodes are watched", async () => {
 await render({episodeStatus:"下一集：S1E8（中間有漏集）",episodeProgress:{watched:6,total:12},newEpisodeAlert:true});
 expect(host.textContent).toContain("集數資料不完整");
 expect(host.textContent).toContain("新集數提醒");
 await render({episodeStatus:"下一集：S1E8",episodeProgress:{watched:7,total:12}});
 expect(host.textContent).not.toContain("集數資料不完整");
 expect(host.querySelector('[role="progressbar"]')?.firstElementChild?.className).toContain("bg-sky-200/55");
});
it("keeps fallback warnings yellow while hiding unverified progress", async () => {
 await render({episodeStatus:"有未觀看的集數（暫時無法確認最新集數）"});
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(Array.from(host.querySelectorAll("p")).find(el => el.textContent?.startsWith("有未觀看"))?.className).toContain("text-amber-300/90");
});
it("does not invent a total for a gap warning without reliable counts", async () => {
 await render({episodeStatus:"下一集：S1E8（中間有漏集）",episodeProgress:null});
 expect(host.textContent).toContain("集數資料不完整");
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
});

it.each(["無法忘記的一天", "暫時告別", "正在確認的秘密", "集數資料不完整的謎團"])("does not mistake an episode title for a loading or error status: %s", async (name) => {
 await render({episodeStatus:`下一集：S1E6 - ${name}`});
 expect(host.querySelector('[role="progressbar"]')?.firstElementChild?.className).toContain("bg-sky-200/55");
});
