import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('non-mentioned direct clarification retries past three failures and survives restart',async()=>{
  const root=mkdtempSync(join(tmpdir(),'social-reliable-reply-'));const agents=join(root,'agents');mkdirSync(join(agents,'river'),{recursive:true});
  writeFileSync(join(agents,'river','profile.json'),JSON.stringify({name:'River',handle:'river_sounds',persona:'Friendly',enabled:true,city:'Nashville',timeZone:'America/Chicago'}));
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=agents;
  const store=await import('./index.ts');const {createBackgroundBuilder,buildMessages,decide}=await import('../../llm/src/index.ts');
  store.syncAgents();const db=new DatabaseSync(process.env.DATABASE_PATH);
  const post=store.createPost('@river_sounds What time is it in Springfield?');const first=store.claimJob();assert.ok(first);
  store.completeJob(first,{like:false,comment:'Which Springfield do you mean—what state or country? I need that to give its current local time.',memory:null});
  const riverComment=db.prepare("SELECT id FROM comments WHERE post_id=? AND agent_id='river'").get(post.id) as {id:number};
  const owner=store.createOwnerReply(riverComment.id,'Springfield, Illinois. What time is it there right now?');assert.ok(owner);
  const row=db.prepare('SELECT id,source,kind,mock_miss AS mockMiss FROM jobs WHERE source_comment_id=?').get(owner.id) as {id:number;source:string;kind:string;mockMiss:number};
  assert.deepEqual({source:row.source,kind:row.kind,mockMiss:row.mockMiss},{source:'notification',kind:'reply',mockMiss:0});
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(row.id);
  for(let attempt=1;attempt<=4;attempt++){
    const job=store.claimJob();assert.equal(job?.id,row.id);assert.ok(job);
    store.markDelivered(job);
    const context=store.getContext(job);
    const background=await createBackgroundBuilder({now:()=>Date.UTC(2026,9,29,18,59,4),fetcher:(async()=>{throw new Error('offline');}) as typeof fetch})(context);
    const messages=buildMessages(context,job.kind,job.source,background);
    store.recordPayload(job,{...messages,imageIds:[],provider:'ollama',model:'offline',memoryBefore:context.memory,background});
    store.failJob(job,'temporary model outage');
    const activity=store.getActivityPage().items.find((item:any)=>item.id===job.id) as any;
    assert.equal(activity.status,'pending');assert.equal(activity.outcome,null);assert.equal(activity.attempts,attempt);
    assert.match(activity.error,/temporary model outage/);
    assert.equal(store.getActivityAttempts(job.id).length,attempt);
    db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(job.id);
  }
  const interrupted=store.claimJob();assert.equal(interrupted?.id,row.id);
  store.recoverJobs();
  assert.equal((store.getActivityAttempts(row.id).at(-1) as {status:string}).status,'interrupted');
  const recovered=store.claimJob();assert.equal(recovered?.id,row.id);assert.ok(recovered);
  const context=store.getContext(recovered);
  const background=await createBackgroundBuilder({now:()=>Date.UTC(2026,9,29,18,59,4),fetcher:(async()=>{throw new Error('offline');}) as typeof fetch})(context);
  const messages=buildMessages(context,recovered.kind,recovered.source,background);
  assert.equal(background.requestedTime?.place,'Springfield, Illinois');assert.match(messages.user,/"answerRequired":true/);
  store.recordPayload(recovered,{...messages,imageIds:[],provider:'openai_compatible',model:'recovered',memoryBefore:context.memory,background});
  const old={provider:process.env.LLM_PROVIDER,base:process.env.LLM_BASE_URL,model:process.env.LLM_MODEL};const originalFetch=globalThis.fetch;
  process.env.LLM_PROVIDER='openai_compatible';process.env.LLM_BASE_URL='http://fake-model.test';process.env.LLM_MODEL='recovered';
  globalThis.fetch=(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({like:false,comment:'Springfield, Illinois is 12:15 PM CDT.',memory:null})}}]}),{status:200})) as typeof fetch;
  let decision;
  try{decision=await decide(context,recovered.kind,messages,recovered.source,background);}finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries({LLM_PROVIDER:old.provider,LLM_BASE_URL:old.base,LLM_MODEL:old.model})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  assert.equal(store.completeJob(recovered,decision),'commented');assert.equal(store.completeJob(recovered,decision),null);
  const saved=db.prepare("SELECT parent_id AS parentId,text FROM comments WHERE parent_id=? AND agent_id='river'").all(owner.id) as {parentId:number;text:string}[];
  assert.equal(saved.length,1);assert.equal(saved[0].text,'As of Thursday, October 29, 2026, the local time in Springfield, Illinois is 1:59 PM CDT.');
  const final=store.getActivityPage().items.find((item:any)=>item.id===row.id) as any;
  assert.equal(final.source,'notification');assert.equal(final.status,'done');assert.equal(final.outcome,'commented');assert.equal(final.attempts,6);
  assert.deepEqual((store.getActivityAttempts(row.id) as {status:string}[]).map(attempt=>attempt.status),['failed','failed','failed','failed','interrupted','commented']);
});
