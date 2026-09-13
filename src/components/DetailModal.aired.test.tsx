// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({auth:{session:{user:{id:"aired-modal"}},loading:false},profiles:{}}));
vi.mock("@/hooks/useAuth",()=>({default:()=>state.auth}));
vi.mock("@/hooks/useProfileNames",()=>({default:()=>state.profiles}));
vi.mock("@/hooks/usePageActivityState",()=>({default:()=>false}));
import DetailModal from "./DetailModal";
import {setDetailCache} from "@/lib/tmdbDetailCache";
it("fills a missing season, updates the real modal and selector, and does not reload viewing records on date updates",async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 vi.stubGlobal("ResizeObserver",class{observe(){} disconnect(){} unobserve(){}});
 Element.prototype.scrollIntoView=vi.fn();
 const id=881732;
 const season1=Array.from({length:4},(_,i)=>({episode_number:i+1,name:`第一季集名${i+1}`,air_date:"2020-01-01"}));
 const season2=Array.from({length:12},(_,i)=>({episode_number:i+1,name:`第二季集名${i+1}`,air_date:i<6?"2020-01-01":"2099-01-01"}));
 const rows=[...season1.map(e=>({season_number:1,episode_number:e.episode_number})),...season2.slice(0,5).map(e=>({season_number:2,episode_number:e.episode_number}))];
 setDetailCache(`tv:${id}`,{id,media_type:"tv",title:"跨季測試作品",year:"2026",status:"Returning Series",seasons_info:[{season_number:1,episode_count:4},{season_number:2,episode_count:12}],countries:[],languages:[]});
 setDetailCache(`tv:${id}:season:2`,season2); // 下一集流程已經取得當季。
 const fetcher=vi.fn<typeof fetch>(async url=>{
  if(String(url).includes("/api/tmdb/season")) return Response.json({episodes:season1});
  return Response.json({rows,count:9,friends:[],inWatchlist:true});
 });vi.stubGlobal("fetch",fetcher);
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<DetailModal open defaultTab="history" mediaType="tv" tmdbId={id} onClose={()=>{}}/>));
  expect(host.querySelector('[aria-label="已看 9 / 10 集（已播出集數）"]')).not.toBeNull();
  expect(host.querySelector("select")?.textContent).toContain("第1季 · 已播 4 集");
  expect(host.querySelector("select")?.textContent).toContain("第2季 · 已播 6 集");
  expect(fetcher.mock.calls.filter(args=>String(args[0]).includes("/api/tmdb/"))).toHaveLength(1);
  const historyCalls=()=>fetcher.mock.calls.filter(args=>String(args[0]).includes("/api/detail/history")).length;
  const before=historyCalls();
  await act(async()=>setDetailCache(`tv:${id}:season:2`,season2.map((e,i)=>i===6?{...e,air_date:"2020-01-01"}:e)));
  expect(host.querySelector('[aria-label="已看 9 / 11 集（已播出集數）"]')).not.toBeNull();
  expect(historyCalls()).toBe(before);
  await act(async()=>setDetailCache(`tv:${id}:season:2`,season2.map((e,i)=>i===6?{...e,air_date:null}:e)));
  expect(host.querySelector('[aria-label="已看 9 / 10 集（已播出集數）"]')).not.toBeNull();
  expect(host.querySelector("select")?.textContent).toContain("第2季 · 已播 6 集");
  expect(host.textContent).not.toContain("已知總");
  expect(historyCalls()).toBe(before);
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});


it("uses Taipei's aired date across local midnight and does not poll viewing history every 20 seconds", async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-12T16:30:00Z"));
 const locale=vi.spyOn(Date.prototype,"toLocaleDateString").mockReturnValue("2026-09-12");
 vi.stubGlobal("ResizeObserver",class{observe(){} disconnect(){} unobserve(){}});
 Element.prototype.scrollIntoView=vi.fn();
 const id=881733;
 setDetailCache(`tv:${id}`,{id,media_type:"tv",title:"Midnight",year:"2026",status:"Returning Series",seasons_info:[{season_number:1,episode_count:3}],countries:[],languages:[]});
 setDetailCache(`tv:${id}:season:1`,[
   {episode_number:1,name:"Aired today in Taipei",air_date:"2026-09-13"},
   {episode_number:2,name:"Tomorrow",air_date:"2026-09-14"},
   {episode_number:3,name:"Unknown",air_date:null},
 ]);
 const fetcher=vi.fn(async()=>Response.json({rows:[],count:0,friends:[],inWatchlist:true}));
 vi.stubGlobal("fetch",fetcher);
 const host=document.createElement("div");const root=createRoot(host);
 try{
   await act(async()=>root.render(<DetailModal open defaultTab="history" mediaType="tv" tmdbId={id} onClose={()=>{}}/>));
   expect(host.querySelector("select")?.textContent).toContain("已播 1 集");
   expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(1);
   expect(host.textContent).toContain("1天後播出");
   const before=fetcher.mock.calls.length;
   await act(async()=>vi.advanceTimersByTimeAsync(60_000));
   expect(fetcher).toHaveBeenCalledTimes(before);
 }finally{await act(async()=>root.unmount());locale.mockRestore();vi.useRealTimers();vi.unstubAllGlobals();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
