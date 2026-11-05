import {test} from "node:test";
import assert from "node:assert/strict";
import {createDraftPersistence} from "../frontend/chat/draft-persistence";

function fixture(request: <T>(path:string,options?:RequestInit)=>Promise<T>) {
 let notice="";
 const persistence=createDraftPersistence({request,key:()=>"language-draft",enabled:()=>true,connected:()=>false,submitting:()=>false,
 capture:()=>({text:"用户草稿",images:[],settings:{},reading:{top:0,bottom:true,anchor:"",offset:0}}),restore(){},notice:value=>{notice=value}});
 return {persistence,notice:()=>notice};
}

test('language application waits for durable draft writes before permitting reload',async()=>{
 let complete!:()=>void;
 const {persistence}=fixture(async<T>()=>{await new Promise<void>(resolve=>{complete=resolve});return {} as T});
 let finished=false;
 const saved=persistence.flush().then(ok=>{finished=true;return ok});
 await Promise.resolve();assert.equal(finished,false);
 complete();assert.equal(await saved,true);
});

test('a failed draft write prevents a language reload without discarding the draft',async()=>{
 const {persistence,notice}=fixture(async()=>{throw new Error("offline")});
 assert.equal(await persistence.flush(),false);
 assert.ok(notice().length>0);
});
