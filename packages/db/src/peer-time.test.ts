import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('peer attempt uses owner ancestor time and saves a corrected minute',async()=>{
  const root=mkdtempSync(join(tmpdir(),'social-peer-time-'));const agents=join(root,'agents');
  for(const id of ['mira','leo']){mkdirSync(join(agents,id),{recursive:true});writeFileSync(join(agents,id,'profile.json'),JSON.stringify({name:id,handle:id,persona:'Friendly',enabled:true,city:'Nashville',timeZone:'America/Chicago'}));}
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=agents;
  const store=await import('./index.ts');const {createBackgroundBuilder,buildMessages,decide}=await import('../../llm/src/index.ts');
  store.syncAgents();const db=new DatabaseSync(process.env.DATABASE_PATH);const post=store.createPost('A walk today');
  db.prepare("UPDATE jobs SET due_at=9999999999999 WHERE status='pending'").run();
  const add=(parent:number|null,author:'owner'|'agent',text:string,agent:string|null=null)=>Number(db.prepare('INSERT INTO comments(post_id,parent_id,author_type,agent_id,text) VALUES(?,?,?,?,?)').run(post.id,parent,author,agent,text).lastInsertRowid);
  const question=add(null,'owner','What time is it in Springfield?');
  const clarification=add(question,'agent','Which Springfield do you mean—what state or country?','mira');
  const exact=add(clarification,'owner','Springfield, Illinois. What time is it there right now?');
  const source=add(exact,'agent','I think it is noon.','mira');
  const nested=add(source,'agent','Let me check.','mira');
  const id=Number(db.prepare("INSERT INTO jobs(kind,post_id,source_comment_id,agent_id,due_at,status,source) VALUES('reply',?,?,?,0,'pending','peer')").run(post.id,nested,'leo').lastInsertRowid);
  const job=store.claimJob();assert.equal(job?.id,id);assert.ok(job);
  const context=store.getContext(job);assert.equal(context.source,'peer');assert.equal(context.sourceCommentId,nested);
  const instant=Date.UTC(2026,9,29,18,59,4);
  const background=await createBackgroundBuilder({now:()=>instant,fetcher:(async()=>{throw new Error('offline');}) as typeof fetch})(context);
  const messages=buildMessages(context,job.kind,job.source,background);
  assert.equal(background.requestedTime?.place,'Springfield, Illinois');assert.match(background.requestedTime!.localDateTime,/1:59 PM/);
  assert.match(messages.user,/"answerRequired":true/);assert.match(messages.user,/"place":"Springfield, Illinois"/);
  const old={provider:process.env.LLM_PROVIDER,base:process.env.LLM_BASE_URL,model:process.env.LLM_MODEL};const originalFetch=globalThis.fetch;
  process.env.LLM_PROVIDER='openai_compatible';process.env.LLM_BASE_URL='http://fake-model.test';process.env.LLM_MODEL='deterministic';
  globalThis.fetch=(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({like:false,comment:'Springfield, Illinois is 12:15 PM CDT.',memory:'Wrong clock'})}}]}),{status:200})) as typeof fetch;
  let decision;
  try{decision=await decide(context,job.kind,messages,job.source,background);}finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries({LLM_PROVIDER:old.provider,LLM_BASE_URL:old.base,LLM_MODEL:old.model})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  store.recordPayload(job,{...messages,imageIds:[],provider:'openai_compatible',model:'deterministic',memoryBefore:context.memory,background});
  assert.equal(store.completeJob(job,decision,undefined,()=>0.99),'commented');
  const saved=db.prepare("SELECT parent_id AS parentId,text FROM comments WHERE post_id=? AND author_type='agent' ORDER BY id DESC LIMIT 1").get(post.id) as {parentId:number;text:string};
  assert.equal(saved.parentId,nested);assert.equal(saved.text,'As of Thursday, October 29, 2026, the local time in Springfield, Illinois is 1:59 PM CDT.');
  const attempt=store.getActivityAttempts(job.id)[0] as {backgroundJson:string;userText:string};
  assert.equal(JSON.parse(attempt.backgroundJson).requestedTime.place,'Springfield, Illinois');assert.match(attempt.userText,/"answerRequired":true/);
});
