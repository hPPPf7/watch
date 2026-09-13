// @vitest-environment jsdom
import {expect,it,vi} from "vitest";
import {openWatchEventSource} from "./sharedWatchEventSource";
it("shares one connection and replays an update missed by a temporarily unsubscribed view",async()=>{
 class Source {
   static instances:Source[]=[];
   onopen:((event:Event)=>void)|null=null;
   onmessage:((event:MessageEvent)=>void)|null=null;
   onerror:((event:Event)=>void)|null=null;
   close=vi.fn();
   constructor(){Source.instances.push(this);}
 }
 vi.stubGlobal("EventSource",Source);
 const header=openWatchEventSource();const page=openWatchEventSource();
 try{
   expect(Source.instances).toHaveLength(1);
   const transport=Source.instances[0];
   transport.onopen!(new Event("open"));
   page.close();
   transport.onmessage!(new MessageEvent("message",{data:JSON.stringify({type:"watchlist_update",reason:"history_upsert",at:42})}));
   const resumed=openWatchEventSource();const received=vi.fn();
   resumed.onmessage=received;
   await Promise.resolve();
   expect(received).toHaveBeenCalledTimes(1);
   expect(JSON.parse(received.mock.calls[0][0].data).at).toBe(42);
   resumed.close();
   expect(transport.close).not.toHaveBeenCalled();
 }finally{page.close();header.close();vi.unstubAllGlobals();}
 expect(Source.instances[0].close).toHaveBeenCalledTimes(1);
});
