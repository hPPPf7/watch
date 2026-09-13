// @vitest-environment jsdom
import {act, createElement, useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {it, expect, vi} from "vitest";
const state = vi.hoisted(() => ({userId:"account-a", fail:false}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({data:{user:{id:state.userId}}, status:"authenticated"}),
}));
vi.mock("@/hooks/useProfileNames", () => ({default:() => ({})}));
vi.mock("@/hooks/usePageActivityState", () => ({default:() => false}));
vi.mock("@/components/DetailModal", () => ({default:() => null}));
vi.mock("@/components/WatchlistCard", () => ({default:({title}:{title:string}) => createElement("div", {"data-card":true}, title)}));
import {AuthProvider} from "@/providers/AuthProvider";
import useAccountFetch from "@/hooks/useAccountFetch";
import WatchlistSection from "@/components/WatchlistSection";
import {markWatchlistDirty} from "@/lib/watchlistMutationEvents";

it("a direct account switch cannot display or cache the previous account list, even when the new read fails", async () => {
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 localStorage.clear(); sessionStorage.clear();
 state.userId="account-a"; state.fail=false;
 const rows=[{id:"a-row",tmdb_id:123,title:"A private title",year:"2020",release_date:"2020-01-01",status:"Released",tmdb_cached_at:new Date().toISOString(),poster_path:"/x.jpg",media_type:"movie",is_anime:false,created_at:"2020-01-01"}];
 vi.stubGlobal("fetch", vi.fn(async () => state.userId==="account-a" && !state.fail
   ? Response.json({rows,movieHistoryRows:[],friends:[],hasData:true,hasSectionData:true,revision:"a"})
   : Response.json({}, {status:503})));
 const host=document.createElement("div"); const root=createRoot(host);
 const render=async () => { await act(async () => {
   root.render(<AuthProvider><WatchlistSection mediaType="movie" filter="all"/></AuthProvider>);
   await new Promise(resolve=>setTimeout(resolve,25));
 }); await act(async()=>{ await new Promise(resolve=>setTimeout(resolve,60)); }); };
 try {
   await render();
   expect(host.textContent).toContain("A private title");
   expect(localStorage.getItem("watchlist:section:v2:account-a:movie:false")).toContain("A private title");
   state.fail=true;
   await act(async()=>markWatchlistDirty({userId:"account-a",mediaType:"movie",isAnime:false}));
   expect(host.textContent).toContain("同步失敗");
   expect(host.textContent).toContain("A private title");
   expect(localStorage.getItem("watchlist:section:v2:account-a:movie:false")).toContain("A private title");
   state.userId="account-b";
   await render();
   expect(host.textContent).not.toContain("A private title");
   expect(localStorage.getItem("watchlist:section:v2:account-b:movie:false")).toBeNull();
   expect(host.textContent).toContain("同步失敗");
   expect(localStorage.getItem("watchlist:section:v2:account-a:movie:false")).toContain("A private title");
 } finally {
   await act(async () => root.unmount()); vi.unstubAllGlobals();
   localStorage.clear(); sessionStorage.clear(); globalThis.IS_REACT_ACT_ENVIRONMENT=false;
 }
});

it("same-user refresh keeps a confirmation; changing account resets it and prevents the old action's next write", async () => {
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 state.userId="account-a";
 let finish!: (value:Response)=>void;
 const network=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 vi.stubGlobal("fetch",network);
 let action!:()=>Promise<void>;
 function Form() {
   const fetch=useAccountFetch();
   const [confirmed,setConfirmed]=useState(false);
   useEffect(()=>{ action=async()=>{await fetch("/prerequisite"); await fetch("/mutation",{method:"POST"});}; },[fetch]);
   return <button onClick={()=>setConfirmed(true)}>{confirmed?"confirmed":"unconfirmed"}</button>;
 }
 const host=document.createElement("div");const root=createRoot(host);
 const render=()=>act(async()=>root.render(<AuthProvider><Form/></AuthProvider>));
 try {
   await render();
   await act(async()=>host.querySelector("button")!.click());
   await render(); expect(host.textContent).toBe("confirmed");
   const pending=action().catch(error=>error);
   state.userId="account-b"; await render();
   expect(host.textContent).toBe("unconfirmed");
   finish(Response.json({}));
   expect((await pending).name).toBe("AbortError");
   expect(network).toHaveBeenCalledTimes(1);
 } finally {await act(async()=>root.unmount());vi.unstubAllGlobals();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
