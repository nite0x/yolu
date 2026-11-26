// Deterministic Cursor ACP process used by browser integration tests.
const fs = require('node:fs');
const readline = require('node:readline');
const {randomUUID} = require('node:crypto');
const file = process.argv[2];
const args = process.argv.slice(3);
if (args.includes('--version')) {console.log('cursor-fixture-1'); process.exit(0);}
if (args.includes('models')) {console.log('Available models\n\nauto - Auto (current, default)\nfixture-model - Fixture Model'); process.exit(0);}
if (!args.includes('acp')) process.exit(2);
const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {sessions:[]};
const save = state => fs.writeFileSync(file,JSON.stringify(state));
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const result = (id,value={}) => send({id,result:value});
let pending;
let approval;
const setup = s => ({sessionId:s.sessionId,models:{currentModelId:s.model,availableModels:[{modelId:'auto',name:'Auto'},{modelId:'fixture-model',name:'Fixture Model'}]},modes:{currentModeId:s.mode,availableModes:[{id:'agent',name:'Agent'},{id:'plan',name:'Plan'},{id:'ask',name:'Ask'}]}});
const emit = (id,update) => send({method:'session/update',params:{sessionId:id,update}});
const finish = reason => {
 if (!pending) return;
 const current=pending;pending=undefined;approval=undefined;
 const state=read();const s=state.sessions.find(s=>s.sessionId===current.sessionId);
 if(reason!=='cancelled') {
  const text={sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Cursor fixture completed the request.'}};
  s.updates.push(text);save(state);emit(s.sessionId,text);
 }
 result(current.id,{stopReason:reason});
};
readline.createInterface({input:process.stdin}).on('line',line=>{
 try {
  const m=JSON.parse(line),p=m.params||{};
  if(!m.method) {if(approval===m.id)finish('end_turn');return;}
  switch(m.method){
   case 'initialize': result(m.id,{protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{list:{}}},authMethods:[{id:'cursor_login',name:'Cursor Login'}]});break;
   case 'authenticate': result(m.id);break;
   case 'session/list': result(m.id,{sessions:read().sessions.map(({updates,...s})=>s)});break;
   case 'session/new': {
    const state=read();const s={sessionId:'cursor-'+randomUUID(),cwd:p.cwd,title:'Cursor fixture',updatedAt:new Date().toISOString(),model:'auto',mode:'agent',updates:[]};state.sessions.push(s);save(state);result(m.id,setup(s));break;
   }
   case 'session/load': {
    const s=read().sessions.find(s=>s.sessionId===p.sessionId);if(!s)throw Error('Unknown session');for(const u of s.updates)emit(s.sessionId,u);result(m.id,setup(s));break;
   }
   case 'session/set_model': case 'session/set_mode': {
    const state=read(),s=state.sessions.find(s=>s.sessionId===p.sessionId);s[m.method.endsWith('model')?'model':'mode']=p.modelId||p.modeId;save(state);result(m.id);break;
   }
   case 'session/close': result(m.id);break;
   case 'session/prompt': {
    const text=p.prompt.filter(b=>b.type==='text').map(b=>b.text).join('\n');const state=read(),s=state.sessions.find(s=>s.sessionId===p.sessionId);
    const user={sessionUpdate:'user_message_chunk',content:{type:'text',text}};s.updates.push(user);save(state);emit(s.sessionId,user);pending={id:m.id,sessionId:p.sessionId};
    if(text.includes('[hold]'))break;
    if(text.includes('[approval]')){approval='cursor-permission';send({id:approval,method:'session/request_permission',params:{sessionId:s.sessionId,toolCall:{toolCallId:'fixture-command',title:'Run fixture command',kind:'execute',rawInput:{command:'printf cursor'}},options:[{optionId:'allow-once',name:'Allow once',kind:'allow_once'},{optionId:'reject-once',name:'Reject',kind:'reject_once'}]}});break;}
    if(text.includes('[question]')){approval='cursor-question';send({id:approval,method:'cursor/ask_question',params:{toolCallId:'fixture-question',questions:[{id:'choice',prompt:'Which checks should run?',allowMultiple:true,options:[{id:'unit',label:'Unit tests'},{id:'browser',label:'Browser tests'}]}]}});break;}
    if(text.includes('[plan]')){approval='cursor-plan';send({id:approval,method:'cursor/create_plan',params:{toolCallId:'fixture-plan',name:'Cursor fixture plan',plan:'Read, edit and verify the test worktree.',todos:[]}});break;}
    finish('end_turn');break;
   }
   case 'session/cancel':finish('cancelled');break;
   default:send({id:m.id,error:{code:-32601,message:'Method not found'}});
  }
 }catch(error){send({id:null,error:{code:-32603,message:error.message}});}
});
