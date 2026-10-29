import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'social-browse-'));
  const agents=join(root,'agents');mkdirSync(join(agents,'one'),{recursive:true});
  writeFileSync(join(agents,'one','profile.json'),JSON.stringify({name:'One',handle:'one',persona:'Friendly',avatarColor:'#123456',enabled:true,feedCheckIntervalMinutes:5}));
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=agents;
  return process.env.DATABASE_PATH;
}

test('browse selects joined new replies and a missed post from newest 20, then tracks follow choice',async()=>{
  const path=fixture();const store=await import('./index.ts');store.syncAgents();const db=new DatabaseSync(path);
  for(let id=1;id<=25;id++) store.createPost(`Post ${id}`);
  db.prepare("UPDATE jobs SET status='not_selected',outcome='not_selected',due_at=0 WHERE source='notification'").run();
  const joined=[] as {postId:number;agentCommentId:number;ownerCommentId:number}[];
  for(const postId of [24,23,22]){
    const agentCommentId=Number(db.prepare("INSERT INTO comments(post_id,author_type,agent_id,text) VALUES(?,'agent','one',?)").run(postId,`Joined ${postId}`).lastInsertRowid);
    const ownerCommentId=Number(db.prepare("INSERT INTO comments(post_id,parent_id,author_type,text) VALUES(?,?,'owner',?)").run(postId,agentCommentId,`New reply ${postId}`).lastInsertRowid);
    db.prepare('INSERT INTO agent_thread_state(agent_id,post_id,last_seen_comment_id,last_seen_at,following) VALUES(?,?,?,?,1)').run('one',postId,agentCommentId,Date.now());
    joined.push({postId,agentCommentId,ownerCommentId});
  }
  const replyImage=store.storeImage(Buffer.from([0xff,0xd8,0xff]),'image/jpeg','A market stall');
  db.prepare('UPDATE images SET post_id=?,comment_id=? WHERE id=?').run(24,joined[0].ownerCommentId,replyImage.id);
  const now=Date.now();db.prepare('UPDATE agent_feed_checks SET next_check_at=?').run(now-1);
  assert.equal(store.scheduleFeedChecks(now),3);
  assert.equal(store.scheduleFeedChecks(now),0);
  const visits=db.prepare("SELECT id,post_id AS postId,source_comment_id AS target,browse_reason AS reason,browse_id AS browseId FROM jobs WHERE source='browse' ORDER BY id").all() as any[];
  assert.deepEqual(visits.map(visit=>visit.postId),[24,23,25]);
  assert.deepEqual(visits.map(visit=>visit.reason),['new_reply','new_reply','missed_post']);
  assert.equal(visits[0].target,joined[0].ownerCommentId);
  assert.equal(new Set(visits.map(visit=>visit.browseId)).size,1);
  assert.equal((db.prepare('SELECT visit_count AS count FROM browse_runs').get() as any).count,3);
  const persistedNext=(store.getBrowseSchedule()[0] as any).nextBrowseAt;
  store.syncAgents();store.recoverJobs();assert.equal((store.getBrowseSchedule()[0] as any).nextBrowseAt,persistedNext);
  const first=store.claimJob();assert.ok(first);assert.equal(first.postId,24);
  const context=store.getContext(first);assert.equal(context.comments.length,2);assert.equal(context.post,'Post 24');assert.equal(context.browseReason,'new_reply');
  assert.ok(context.images.some(image=>image.id===replyImage.id));
  assert.deepEqual((context.comments[1] as any).images,[{id:replyImage.id,description:'A market stall'}]);
  assert.equal(store.completeJob(first,{like:true,comment:'I will stop here',memory:null,follow:false}),'liked_and_commented');
  const firstVisit=store.getActivityPage().items.find((item:any)=>item.id===first.id) as any;
  assert.equal(firstVisit.followState,0);assert.equal(firstVisit.outcome,'liked_and_commented');
  const reply=db.prepare("SELECT parent_id AS parentId FROM comments WHERE text='I will stop here'").get() as any;
  assert.equal(reply.parentId,joined[0].ownerCommentId);
  for(let i=0;i<2;i++){const job=store.claimJob();assert.ok(job);store.completeJob(job,{like:false,comment:null,memory:null,follow:false});}
  assert.ok((db.prepare('SELECT completed_at AS completedAt FROM browse_runs').get() as any).completedAt);
  assert.equal((db.prepare('SELECT following FROM agent_thread_state WHERE agent_id=? AND post_id=?').get('one',24) as any).following,0);
  db.prepare("INSERT INTO comments(post_id,parent_id,author_type,text) VALUES(24,?,'owner','Later reply')").run(joined[0].agentCommentId);
  db.prepare('UPDATE agent_feed_checks SET next_check_at=?').run(now+1);
  store.scheduleFeedChecks(now+2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE source='browse' AND post_id=24").get() as any).count,1);
  const mention=store.createOwnerReply(joined[0].agentCommentId,'Please return @one');assert.ok(mention);
  assert.equal((db.prepare('SELECT following FROM agent_thread_state WHERE agent_id=? AND post_id=?').get('one',24) as any).following,1);
  db.prepare("UPDATE jobs SET due_at=0 WHERE source='mention' AND source_comment_id=?").run(mention.id);
  const mentionJob=store.claimJob();assert.ok(mentionJob);assert.equal(mentionJob.source,'mention');store.completeJob(mentionJob,{like:false,comment:null,memory:null});
  db.prepare("INSERT INTO comments(post_id,parent_id,author_type,text) VALUES(24,?,'owner','Another new reply')").run(joined[0].agentCommentId);
  db.prepare('UPDATE agent_feed_checks SET next_check_at=?').run(now+3);
  store.scheduleFeedChecks(now+4);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE source='browse' AND post_id=24").get() as any).count,2);
  const revisit=db.prepare("SELECT id FROM jobs WHERE source='browse' AND post_id=24 ORDER BY id DESC LIMIT 1").get() as {id:number};
  db.prepare("UPDATE jobs SET due_at=9999999999999 WHERE source='browse' AND status='pending' AND id<>?").run(revisit.id);
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(revisit.id);
  const revisitJob=store.claimJob();assert.ok(revisitJob);assert.equal(revisitJob.id,revisit.id);
  assert.equal(store.completeJob(revisitJob,{like:true,comment:'A new reply to new content',memory:null,follow:true}),'commented');
  assert.equal(store.completeJob(revisitJob,{like:true,comment:'A new reply to new content',memory:null,follow:true}),null);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM likes WHERE post_id=24 AND agent_id='one'").get() as any).count,1);
  assert.equal((db.prepare('SELECT outcome FROM jobs WHERE id=?').get(revisit.id) as any).outcome,'commented');
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM comments WHERE text='A new reply to new content'").get() as any).count,1);
});

test('an empty browse is persisted once without creating a post group',async()=>{
  const path=fixture();
  const store=await import(`./index.ts?empty=${Date.now()}`);store.syncAgents();const db=new DatabaseSync(path);
  const now=Date.now();db.prepare('UPDATE agent_feed_checks SET next_check_at=?').run(now-1);
  assert.equal(store.scheduleFeedChecks(now),0);assert.equal(store.scheduleFeedChecks(now),0);
  const empty=store.getRecentBrowseResults() as any[];assert.equal(empty.length,1);assert.equal(empty[0].agentName,'One');assert.ok(empty[0].completedAt);
  assert.equal(empty[0].queuedCount,0);assert.deepEqual(store.getActivityPage().items,[]);
  db.prepare("UPDATE agents SET enabled=0 WHERE id='one'").run();
  assert.deepEqual(store.getBrowseSchedule(),[]);
  assert.equal((store.getRecentBrowseResults() as any[]).length,1);
});
