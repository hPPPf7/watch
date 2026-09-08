import {afterEach, describe, expect, it, vi} from "vitest";
import NextAuth from "next-auth";
import {encode, getToken} from "@auth/core/jwt";
const state=vi.hoisted(()=>({cookie:""}));
vi.mock("next/headers",()=>({headers:async()=>new Headers({host:"local.test",cookie:state.cookie,"x-forwarded-proto":"https"}),cookies:async()=>({})}));
afterEach(()=>{vi.unstubAllEnvs();state.cookie="";});
const secret="local-dependency-security-test-only";
describe("Auth.js dependency security",()=>{
 it.each(["%","%ZZ","%E0%A4%A"])("rejects malformed bearer %s without throwing",async(value)=>{
  await expect(getToken({req:new Request("https://local.test",{headers:{authorization:"Bearer "+value}}),secret})).resolves.toBeNull();
 });
 it("returns no session for configuration errors",async()=>{
  vi.stubEnv("AUTH_SECRET","");vi.stubEnv("NEXTAUTH_SECRET","");
  const {auth}=NextAuth({providers:[],secret:"",trustHost:true,logger:{error:vi.fn()}});
  await expect(auth()).resolves.toBeNull();
 });
 it("preserves legitimate JWT session and rejects a tampered cookie",async()=>{
  const salt="__Secure-authjs.session-token";
  const token=await encode({token:{sub:"test-user",name:"Test",email:"test@example.test"},secret,salt});
  const {auth}=NextAuth({providers:[],secret,trustHost:true,session:{strategy:"jwt"},logger:{error:vi.fn()}});
  state.cookie=salt+"="+token;
  expect((await auth())?.user?.name).toBe("Test");
  state.cookie=salt+"="+token.slice(0,-5)+"xxxxx";
  await expect(auth()).resolves.toBeNull();
 });
});
