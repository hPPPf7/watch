// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
const auth=vi.hoisted(()=>({session:{user:{id:"recovery-user"}},loading:false}));
vi.mock("@/hooks/useAuth",()=>({default:()=>auth}));
vi.mock("@/hooks/useProfileNames",()=>({default:()=>({})}));
vi.mock("@/hooks/useWatchRealtimeRefresh",()=>({default:()=>{}}));
vi.mock("@/hooks/useFriendNoticeRealtimeRefresh",()=>({default:()=>{}}));
vi.mock("@/components/SiteHeader",()=>({default:()=>null}));
vi.mock("@/components/SiteFooter",()=>({default:()=>null}));
import CalendarPage from "./calendar/page";
import FriendsPage from "./friends/page";
it.each([["calendar",CalendarPage],["friends",FriendsPage]] as const)("%s shows a recoverable read error and exits loading",async(_,Page)=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let failing=true;
 vi.stubGlobal("fetch",vi.fn(async()=>{
   if(failing)throw new TypeError("offline");
   return Response.json({rows:[],friends:[],incoming:[],outgoing:[]});
 }));
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{
   await act(async()=>root.render(<Page/>));
   expect(host.querySelector('[role="alert"]')).not.toBeNull();
   const retry=[...host.querySelectorAll("button")].find(button=>button.textContent==="重試")!;
   expect(retry.disabled).toBe(false);
   failing=false;
   await act(async()=>retry.click());
   expect(host.querySelector('[role="alert"]')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
