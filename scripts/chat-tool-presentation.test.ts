import {test} from "node:test";
import assert from "node:assert/strict";
import {toolPresentation, toolGroupSummary, type ToolRecord} from "../frontend/features/conversations/model/tool-presentation";

test("native command actions distinguish reads and exploration while compound commands remain commands", () => {
  const read = {args:{command:"/bin/zsh -lc 'cat src/app.ts'",actions:[{type:"read",path:"/repo/src/app.ts"}]}, result:{status:"completed"}};
  assert.equal(toolPresentation(read).kind,"read");
  assert.equal(toolPresentation(read).detail,"app.ts");
  assert.equal(toolPresentation(read).label,"已读取文件");
  assert.equal(toolPresentation({...read,args:{command:"rg value src",actions:[{type:"search"},{type:"read",path:"src/app.ts"}]}}).kind,"explore");
  for (const command of ["cat file; rm file", "cat file | sh", "cat $(execute)", "npm test", "bash -lc 'cat file'"]) assert.equal(toolPresentation({args:{command}}).kind,"command");
  assert.equal(toolPresentation({args:{command:"cat 'a file.ts'"}}).kind,"read");
  assert.equal(toolPresentation({args:{command:"rg value src"}}).kind,"explore");
});

test("summaries retain category counts and failures without claiming unknown tools succeeded", () => {
  const parts: ToolRecord[] = [
    {args:{command:"cat a"},result:{status:"completed"}},
    {args:{changes:"a\n+new",files:[{path:"src/a.ts"}]},result:{status:"completed"}},
    {args:{command:"npm test"},result:{status:"completed",exit_code:1}},
    {toolName:"查看图片",args:{activity:"/tmp/preview.png",images:["/tmp/preview.png"]}},
  ];
  assert.equal(toolGroupSummary(parts),"读取文件 1 次 · 编辑文件 1 次 · 运行命令 1 次 · 查看图片 1 次 · 1 项失败");
  assert.equal(toolPresentation(parts[1]).detail,"a.ts");
  assert.equal(toolPresentation(parts[2]).label,"运行命令失败");
  assert.equal(toolPresentation(parts[3]).label,"查看图片");
  assert.deepEqual(toolPresentation(parts[3]).images,["/tmp/preview.png"]);
  assert.equal(toolPresentation({toolName:"repo · inspect",args:{activity:""},result:{status:"unknown"}}).label,"调用 repo · inspect");
  assert.equal(toolPresentation({args:{command:"npm test"},status:{type:"running"}}).label,"正在运行命令");
  assert.equal(toolPresentation({args:{command:"npm test"},status:{type:"incomplete",reason:"cancelled"}}).state,"cancelled");
});
