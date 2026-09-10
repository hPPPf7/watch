// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({auth:{session:{user:{id:"search-test"}},loading:false},profiles:{}}));
vi.mock("@/hooks/useAuth",()=>({default:()=>state.auth}));
vi.mock("@/hooks/useProfileNames",()=>({default:()=>state.profiles}));
vi.mock("@/hooks/usePageActivityState",()=>({default:()=>false}));
vi.mock("@/hooks/useWatchRealtimeRefresh",()=>({default:()=>{}}));
vi.mock("@/components/DetailModal",()=>({default:()=>null}));
vi.mock("@/components/WatchlistCard",()=>({default:({title}:{title:string})=><div data-card>{title}</div>}));
import WatchlistSection from "./WatchlistSection";
it("searches and clears already loaded cards without another fetch",async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 localStorage.clear(); sessionStorage.clear();document.body.innerHTML="<div id='test'></div>";
 const rows=["沙丘","星際效應"].map((title,i)=>({id:String(i),tmdb_id:i+1,title,year:"2020",release_date:"2020-01-01",status:"Released",tmdb_cached_at:new Date().toISOString(),poster_path:"/test.jpg",media_type:"movie",is_anime:false,created_at:"2020-01-01"}));
 const fetcher=vi.fn(async()=>Response.json({rows,movieHistoryRows:[],friends:[],hasData:true,hasSectionData:true,revision:"test"}));vi.stubGlobal("fetch",fetcher);
 const root=createRoot(document.getElementById("test")!);
 try{
  await act(async()=>root.render(<WatchlistSection mediaType="movie" filter="all" />));
  await act(async()=>{await new Promise(r=>setTimeout(r,200));});
  expect(document.querySelectorAll("[data-card]")).toHaveLength(2);
  const count=fetcher.mock.calls.length;const input=document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"沙丘");input.dispatchEvent(new Event("input",{bubbles:true}));});
  expect(document.querySelectorAll("[data-card]")).toHaveLength(1);
  expect(document.querySelector("[data-card]")?.textContent).toBe("沙丘");expect(fetcher).toHaveBeenCalledTimes(count);
  await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="清除搜尋"]')!.click());
  expect(document.querySelectorAll("[data-card]")).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(count);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
