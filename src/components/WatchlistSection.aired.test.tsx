// @vitest-environment jsdom
import {act,type ComponentProps} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({auth:{session:{user:{id:"aired-list"}},loading:false},profiles:{}}));
vi.mock("@/hooks/useAuth",()=>({default:()=>state.auth}));
vi.mock("@/hooks/useProfileNames",()=>({default:()=>state.profiles}));
vi.mock("@/hooks/usePageActivityState",()=>({default:()=>false}));
vi.mock("@/hooks/useWatchRealtimeRefresh",()=>({default:()=>{}}));
vi.mock("@/components/DetailModal",()=>({default:()=>null}));
// eslint-disable-next-line @next/next/no-img-element
vi.mock("next/image",()=>({default:(props:ComponentProps<"img">)=><img alt={props.alt} src={props.src}/>}));
import WatchlistSection from "./WatchlistSection";
import {setDetailCache} from "@/lib/tmdbDetailCache";
it("finishes normal status scanning then fills missing aired dates without repeating the list scan",async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 localStorage.clear();sessionStorage.clear();
 const id=781623;
 const rows=[{id:"item",tmdb_id:id,title:"跨季清單測試",year:"2020",release_date:"2020-01-01",status:"Returning Series",tmdb_cached_at:new Date().toISOString(),poster_path:"/test.jpg",media_type:"tv",is_anime:false,created_at:"2020-01-01"}];
 const season1=Array.from({length:4},(_,i)=>({episode_number:i+1,name:`前季${i+1}`,air_date:"2020-01-01"}));
 const season2=Array.from({length:12},(_,i)=>({episode_number:i+1,name:`本季${i+1}`,air_date:i<6?"2020-01-01":"2099-01-01"}));
 setDetailCache(`tv:${id}`,{id,media_type:"tv",title:"跨季清單測試",status:"Returning Series",seasons_info:[{season_number:1,episode_count:4},{season_number:2,episode_count:12}]});
 const fetcher=vi.fn<typeof fetch>(async(url,options)=>{
  const path=String(url);
  if(path.includes("/api/tmdb/season")) return Response.json({episodes:path.includes("season=1")?season1:season2});
  if(path.includes("tv-states/upsert")) {
    const states=JSON.parse(String(options?.body)).states;
    return Response.json({persistedStates:Object.fromEntries(states.map((s:{tmdb_id:number})=>[s.tmdb_id,s]))});
  }
  return Response.json({rows,latestEpisodes:{[id]:{season:2,episode:5}},watchedCounts:{[id]:9},latestWatchedDates:{[id]:"2026-09-01"},tvStateRows:[],friends:[],hasData:true,hasSectionData:true,revision:"test"});
 });vi.stubGlobal("fetch",fetcher);
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<WatchlistSection mediaType="tv" filter="all"/>));
  await act(async()=>{await new Promise(r=>setTimeout(r,100));});
  expect(host.textContent).toContain("已看 9 / 10 集");
  expect(host.textContent).toContain("下一集：S2E6 - 本季6");
  const requests=fetcher.mock.calls.filter(args=>String(args[0]).includes("/api/tmdb/season"));
  expect(requests.map(args=>String(args[0]))).toEqual([
   `/api/tmdb/season?type=tv&id=${id}&season=2`, `/api/tmdb/season?type=tv&id=${id}&season=1`]);
  const count=fetcher.mock.calls.length;
  await act(async()=>setDetailCache(`tv:${id}:season:1`,season1));
  expect(fetcher).toHaveBeenCalledTimes(count);
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
