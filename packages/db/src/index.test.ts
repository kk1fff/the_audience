import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
test('post, reply, and per-agent memory persist without duplicate reactions', async () => {
  const root=mkdtempSync(join(tmpdir(),'social-test-')); const agents=join(root,'agents');mkdirSync(join(agents,'one'),{recursive:true});mkdirSync(join(agents,'two'));
  for(const id of ['one','two','three','four','five','six','seven','eight']) { mkdirSync(join(agents,id),{recursive:true});writeFileSync(join(agents,id,'profile.json'),JSON.stringify({name:id,handle:id,persona:'Friendly',avatarColor:'#123456',enabled:true}));writeFileSync(join(agents,id,'memory.md'),'Initial'); }
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=agents;
  const store=await import('./index.ts');store.syncAgents();
  const image=store.storeImage(Buffer.from([0xff,0xd8,0xff]),'image/jpeg');
  const post=store.createPost('A first post',[image.id]);assert.equal(post.id,1);const audience=store.getActivity().filter((item:any)=>item.postId===post.id) as any[];assert.equal(audience.length,8);assert.ok(audience.filter(item=>item.status==='pending').length>=2&&audience.filter(item=>item.status==='pending').length<=4);assert.equal(audience.filter(item=>item.mockMiss).length,1);assert.ok(audience.some(item=>item.status==='not_selected'));assert.equal(audience.filter(item=>item.status==='not_selected')[0].memoryBefore,'Initial');
  const sql=new DatabaseSync(process.env.DATABASE_PATH);sql.prepare('UPDATE jobs SET due_at=0').run();
  const job=store.claimJob();assert.ok(job);const context=store.getContext(job);assert.equal(context.images[0].id,image.id);store.recordPayload(job,{system:'System',user:'Exact prompt',imageIds:[image.id],provider:'mock',model:'mock',memoryBefore:context.memory});store.completeJob(job,{like:true,comment:'Hello',memory:'Learned something',memoryEvaluation:'Worth remembering'});
  store.completeJob(job,{like:true,comment:'Hello',memory:'Learned something',memoryEvaluation:'Worth remembering'});
  assert.equal(store.getFeed()[0].images[0].id,image.id);assert.equal((store.getActivity().find((item:any)=>item.id===job.id) as any).outcome,'liked_and_commented');assert.equal((store.getActivityAttempts(job.id)[0] as any).userText,'Exact prompt');
  const completedAttempt=store.getActivityAttempts(job.id)[0] as any;assert.equal(completedAttempt.memoryBefore,'Initial');assert.match(completedAttempt.memoryAfter,/Learned something/);assert.match(completedAttempt.modelResponse,/Learned something/);assert.equal(completedAttempt.memoryEvaluation,'Worth remembering');assert.equal(completedAttempt.systemText,'System');
  assert.equal(store.getFeed()[0].likes.length,1);assert.equal(store.getFeed()[0].comments.length,1);
  const agent=job.agentId;const other=['one','two','three','four','five','six','seven','eight'].find(id=>id!==agent)!;
  assert.match((sql.prepare('SELECT content FROM memories WHERE agent_id=?').get(agent) as any).content,/Learned something/);
  assert.equal((sql.prepare('SELECT content FROM memories WHERE agent_id=?').get(other) as any).content,'Initial');
  const comment=store.getFeed()[0].comments[0];const replyImage=store.storeImage(Buffer.from([0xff,0xd8,0xff]),'image/jpeg');const reply=store.createOwnerReply(comment.id,'',[replyImage.id]);assert.ok(reply);
  assert.equal((sql.prepare("SELECT agent_id FROM jobs WHERE kind='reply'").get() as any).agent_id,agent);
  sql.prepare("UPDATE jobs SET due_at=9999999999999 WHERE kind='post' AND status='pending'").run();sql.prepare('UPDATE jobs SET due_at=0 WHERE kind=\'reply\'').run();const replyJob=store.claimJob();assert.ok(replyJob);assert.deepEqual(store.getContext(replyJob).images.map(i=>i.id),[image.id,replyImage.id]);store.completeJob(replyJob,{like:false,comment:'You are welcome',memory:null});
  assert.equal(store.getFeed()[0].comments.length,3);
  assert.equal(store.createOwnerReply(reply.id,'Invalid'),null);
  const agentResponse=store.getFeed()[0].comments.find((c:any)=>c.parentId===reply.id);assert.ok(agentResponse);
  const followup=store.createOwnerReply(agentResponse.id,'Another thought');assert.ok(followup);
  sql.prepare("UPDATE jobs SET due_at=0 WHERE kind='reply' AND status='pending'").run();const missed=store.claimJob();assert.ok(missed);store.completeJob(missed,null,'missed');
  assert.equal((store.getActivity().find((item:any)=>item.id===missed.id) as any).outcome,'missed');assert.equal((store.getActivityAttempts(missed.id)[0] as any).systemText,null);
  sql.prepare("UPDATE jobs SET due_at=0 WHERE kind='post' AND status='pending'").run();const ignored=store.claimJob();assert.ok(ignored);store.completeJob(ignored,{like:false,comment:null,memory:null});
  assert.equal((store.getActivity().find((item:any)=>item.id===ignored.id) as any).outcome,'ignored');
  sql.prepare("UPDATE jobs SET due_at=9999999999999 WHERE status='pending'").run();const failedPost=store.createPost('Failure case');sql.prepare('UPDATE jobs SET due_at=0 WHERE post_id=?').run(failedPost.id);
  for(let attempt=0;attempt<3;attempt++){const failing=store.claimJob();assert.ok(failing);store.failJob(failing,'model unavailable');sql.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(failing.id);if(attempt===2){assert.equal((store.getActivity().find((item:any)=>item.id===failing.id) as any).outcome,'failed');assert.equal(store.getActivityAttempts(failing.id).length,3);}}

});
