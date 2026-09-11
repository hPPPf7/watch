// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import useEpisodeDataClock from "./useEpisodeDataClock";
import { setDetailCache } from "@/lib/tmdbDetailCache";
afterEach(()=>{vi.useRealTimers();});
it("advances the local date and refresh epoch only while active and reacts to shared cache writes", async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-11T15:59:30Z"));
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement("div"),root=createRoot(host);let renders=0;
 function Probe({active}:{active:boolean}){const value=useEpisodeDataClock(active);renders++;return <span>{value.today}:{value.refreshEpoch}</span>;}
 try{
  await act(async()=>root.render(<Probe active={true}/>));
  await act(async()=>vi.advanceTimersByTime(60000));expect(host.textContent).toContain("2026-09-12");
  const before=renders;await act(async()=>setDetailCache("tv:99881:season:1",[],1000));expect(renders).toBeGreaterThan(before);
  await act(async()=>root.render(<Probe active={false}/>));const paused=host.textContent;
  await act(async()=>vi.advanceTimersByTime(24*3600000));expect(host.textContent).toBe(paused);
  await act(async()=>root.render(<Probe active={true}/>));await act(async()=>vi.advanceTimersByTime(1));expect(host.textContent).toContain("2026-09-13");
 }finally{await act(async()=>root.unmount());globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
