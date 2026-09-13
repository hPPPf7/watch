// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
const auth=vi.hoisted(()=>({session:{user:{id:"batch-user"}},loading:false}));
vi.mock("@/hooks/useAuth",()=>({default:()=>auth}));
vi.mock("@/hooks/useProfileNames",()=>({default:()=>({})}));
vi.mock("@/hooks/usePageActivityState",()=>({default:()=>false}));
vi.mock("@/components/DetailModal",()=>({default:()=>null}));
vi.mock("@/components/WatchlistCard",()=>({default:()=>null}));
import WatchlistSection from "./WatchlistSection";
import {setDetailCache} from "@/lib/tmdbDetailCache";
it("201 changed titles finish in bounded batches after re-reading and recomputing against the next revision",async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();sessionStorage.clear();
 const rows=Array.from({length:201},(_,i)=>({id:`item-${i}`,tmdb_id:900000+i,title:`Title ${i}`,year:"2020",release_date:"2020-01-01",status:"Ended",tmdb_cached_at:new Date().toISOString(),poster_path:"/test.jpg",media_type:"tv",is_anime:false,created_at:"2020-01-01"}));
 for(const row of rows)setDetailCache(`tv:${row.tmdb_id}`,{id:row.tmdb_id,media_type:"tv",title:row.title,status:"Ended",total_episodes:0,seasons_info:[]});
 const saved:Record<string,{tmdb_id:number}>={};const sizes:number[]=[];let revision=0;let readAfterSave=false;
 const fetcher=vi.fn<typeof fetch>(async(url,options)=>{
   const path=String(url);
   if(path.includes("tv-states/upsert")){
     const body=JSON.parse(String(options?.body));
     expect(body.baseRevision).toBe(`r${revision}`);
     expect(body.force).toBeUndefined();
     if(revision>0)expect(readAfterSave).toBe(true);
     readAfterSave=false;
     sizes.push(body.states.length);
     Object.assign(saved,Object.fromEntries(body.states.map((state:{tmdb_id:number})=>[state.tmdb_id,state])));
     revision++;
     return Response.json({persistedStates:Object.fromEntries(body.states.map((state:{tmdb_id:number})=>[state.tmdb_id,state]))});
   }
   if(path.includes("section-data") && revision>0)readAfterSave=true;
   return Response.json({rows,latestEpisodes:{},watchedCounts:{},tvStateRows:Object.values(saved),friends:[],hasData:true,hasSectionData:true,revision:`r${revision}`});
 });vi.stubGlobal("fetch",fetcher);
 const root=createRoot(document.createElement("div"));
 try{
   await act(async()=>root.render(<WatchlistSection mediaType="tv" filter="all"/>));
   for(let i=0;i<20&&Object.keys(saved).length<201;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
   expect(sizes).toEqual([200,1]);
   expect(Object.keys(saved)).toHaveLength(201);
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,100));});
   expect(sizes).toEqual([200,1]);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
