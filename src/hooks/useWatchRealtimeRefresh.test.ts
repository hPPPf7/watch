// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({inactive:false}));
vi.mock('@/hooks/usePageActivityState',()=>({default:()=>m.inactive}));
import useWatchRealtimeRefresh from '@/hooks/useWatchRealtimeRefresh';
class Events {
 static instances:Events[]=[];
 onopen: (() => void) | null = null;
 onmessage: ((event: {data:string}) => void) | null = null;
 onerror: (() => void) | null = null;
 constructor(){Events.instances.push(this)}
 close(){}
}
it.each(['after resume', 'before pause', 'finish inactive'])('preserves a queued update: %s',async(timing)=>{
 m.inactive=false; Events.instances=[]; globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.stubGlobal('EventSource',Events);
 let resolveOld!:()=>void;const old=new Promise<void>(r=>resolveOld=r);
 const refresh=vi.fn().mockReturnValueOnce(old).mockResolvedValue(undefined);
 function Test(){useWatchRealtimeRefresh(refresh,{pauseWhenHidden:true,fallbackIntervalMs:1000});return null}
 const root=createRoot(document.createElement('div'));
 try {
  await act(async()=>root.render(createElement(Test)));expect(refresh).toHaveBeenCalledTimes(1);
  await act(async()=>Events.instances[0].onopen?.());
  if(timing!=="after resume")await act(async()=>Events.instances[0].onmessage?.({data:JSON.stringify({type:"watchlist_update",reason:"history",at:100})}));
  m.inactive=true;await act(async()=>root.render(createElement(Test)));
  if(timing==="finish inactive")await act(async()=>{resolveOld();await Promise.resolve()});
  m.inactive=false;await act(async()=>root.render(createElement(Test)));
  await act(async()=>{Events.instances.at(-1)!.onopen?.();Events.instances.at(-1)!.onmessage?.({data:JSON.stringify({type:'watchlist_update',reason:'history',at:100})})});
  await act(async()=>{resolveOld();await Promise.resolve()});
  await act(async()=>vi.advanceTimersByTimeAsync(10000));
  expect(refresh).toHaveBeenCalledTimes(2);
 }finally{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();globalThis.IS_REACT_ACT_ENVIRONMENT=false;}
});
