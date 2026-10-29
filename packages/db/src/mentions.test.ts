import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('enabled exact mentions route once, persist retries, and retain reply context', async () => {
  const root=mkdtempSync(join(tmpdir(),'social-mentions-'));
  const agents=join(root,'agents');
  for(const [id,enabled] of [['mira',true],['aya',true],['off',false]] as const){
    mkdirSync(join(agents,id),{recursive:true});
    writeFileSync(join(agents,id,'profile.json'),JSON.stringify({name:id==='mira'?'Mira':id==='aya'?'Aya':'Off',handle:id,persona:'Friendly',avatarColor:'#123456',enabled}));
  }
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=agents;
  const store=await import('./index.ts');store.syncAgents();
  const sql=new DatabaseSync(process.env.DATABASE_PATH);
  const post=store.createPost('Hello @MIRA, @mira! @mirage @off @unknown');
  const rows=sql.prepare('SELECT id,agent_id AS agentId,source,mentioned_handle AS mentionedHandle,status,mock_miss AS mockMiss FROM jobs WHERE post_id=? ORDER BY agent_id').all(post.id) as any[];
  assert.equal(rows.length,2);
  assert.deepEqual(rows.find(row=>row.agentId==='mira')&&{source:rows.find(row=>row.agentId==='mira').source,handle:rows.find(row=>row.agentId==='mira').mentionedHandle,miss:rows.find(row=>row.agentId==='mira').mockMiss},{source:'mention',handle:'mira',miss:0});
  assert.equal(rows.find(row=>row.agentId==='aya')?.source,'notification');
  assert.equal(store.getActivity().filter((row:any)=>row.postId===post.id&&row.source==='mention').length,1);
  let mention=store.claimJob();assert.ok(mention);assert.equal(mention.agentId,'mira');assert.equal(mention.source,'mention');
  for(let attempt=1;attempt<=4;attempt++){
    store.failJob(mention,'model unavailable');
    const state=sql.prepare('SELECT status,attempts,due_at AS dueAt,error FROM jobs WHERE id=?').get(mention.id) as any;
    assert.equal(state.status,'pending');assert.equal(state.attempts,attempt);assert.match(state.error,/model unavailable/);assert.ok(state.dueAt>Date.now());
    if(attempt<4){sql.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(mention.id);const next=store.claimJob();assert.equal(next?.id,mention.id);assert.ok(next);mention=next;}
  }
  assert.equal(store.getActivityAttempts(mention.id).length,4);
  sql.prepare('UPDATE jobs SET due_at=0,attempts=20 WHERE id=?').run(mention.id);
  const capped=store.claimJob();assert.ok(capped);assert.equal(capped.id,mention.id);store.failJob(capped,'still unavailable');
  const afterCap=sql.prepare('SELECT status,due_at AS dueAt FROM jobs WHERE id=?').get(mention.id) as any;
  assert.equal(afterCap.status,'pending');assert.ok(afterCap.dueAt-Date.now()<=300000);
  sql.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(mention.id);
  const recovered=store.claimJob();assert.equal(recovered?.id,mention.id);
  store.completeJob(recovered,{like:false,comment:'I saw your mention',memory:null});
  assert.equal((sql.prepare('SELECT status,outcome,error FROM jobs WHERE id=?').get(mention.id) as any).outcome,'commented');
  assert.equal(store.getActivityAttempts(mention.id).length,6);
  const miraComment=Number(sql.prepare("SELECT id FROM comments WHERE post_id=? AND agent_id='mira'").get(post.id)?.id);
  const reply=store.createOwnerReply(miraComment,'Thanks @AYA and @aya, also @mira and @off');assert.ok(reply);
  const replyJobs=sql.prepare('SELECT agent_id AS agentId,source,source_comment_id AS commentId FROM jobs WHERE source_comment_id=? ORDER BY agent_id').all(reply.id) as any[];
  assert.deepEqual(replyJobs.map(job=>job.agentId),['aya','mira']);
  assert.ok(replyJobs.every(job=>job.source==='mention'&&job.commentId===reply.id));
  sql.prepare("UPDATE jobs SET due_at=9999999999999 WHERE source_comment_id=? AND agent_id='mira'").run(reply.id);
  const ayaJob=store.claimJob();assert.equal(ayaJob?.agentId,'aya');
  const context=store.getContext(ayaJob);assert.equal(context.replyToAgentName,'Mira');assert.equal(context.replyToOwnComment,false);assert.equal(context.mentionText,reply.text);
  store.completeJob(ayaJob,{like:false,comment:null,memory:null});
  assert.equal((sql.prepare('SELECT outcome FROM jobs WHERE id=?').get(ayaJob.id) as any).outcome,'ignored');
  const later=store.createOwnerReply(miraComment,'New message @aya');assert.ok(later);
  assert.equal((sql.prepare("SELECT COUNT(*) AS count FROM jobs WHERE agent_id='aya' AND source='mention' AND kind='reply'").get() as any).count,2);
  assert.equal((sql.prepare("SELECT source FROM jobs WHERE source_comment_id=? AND agent_id='mira'").get(later.id) as any).source,'notification');
  const plain=store.createPost('@mirage @mira-extra @off');
  assert.equal((sql.prepare("SELECT COUNT(*) AS count FROM jobs WHERE post_id=? AND source='mention'").get(plain.id) as any).count,0);
});
