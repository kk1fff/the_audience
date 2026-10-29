import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('agent comments fan out once, peers see full context, and peer replies do not rebroadcast', async () => {
  const root=mkdtempSync(join(tmpdir(),'social-peer-'));
  const agents=join(root,'agents');
  for (const id of ['one','two','three','four']) {
    mkdirSync(join(agents,id),{recursive:true});
    writeFileSync(join(agents,id,'profile.json'),JSON.stringify({name:id,handle:id,persona:'Friendly',enabled:true}));
  }
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=agents;
  const store=await import('./index.ts');store.syncAgents();
  const db=new DatabaseSync(process.env.DATABASE_PATH);
  const post=store.createPost('Peer thread');
  db.prepare("UPDATE jobs SET due_at=9999999999999 WHERE status='pending'").run();
  const first=(db.prepare("SELECT id FROM jobs WHERE post_id=? AND status='pending' ORDER BY id LIMIT 1").get(post.id) as {id:number}).id;
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(first);
  const source=store.claimJob();assert.ok(source);
  const commentImage=store.storeImage(Buffer.from([0xff,0xd8,0xff]),'image/jpeg','A small dog');
  const older=Number(db.prepare("INSERT INTO comments(post_id,author_type,text) VALUES(?,'owner','Earlier')").run(post.id).lastInsertRowid);
  db.prepare('UPDATE images SET post_id=?,comment_id=? WHERE id=?').run(post.id,older,commentImage.id);
  assert.equal(store.completeJob(source,{like:false,comment:'Hello peers',memory:null}),'commented');
  assert.equal(store.completeJob(source,{like:false,comment:'Hello peers',memory:null}),null);
  const peerRows=db.prepare("SELECT id,agent_id AS agentId,source_comment_id AS sourceCommentId FROM jobs WHERE source='peer' ORDER BY agent_id").all() as {id:number;agentId:string;sourceCommentId:number}[];
  assert.equal(peerRows.length,3);
  assert.equal(new Set(peerRows.map(row=>row.agentId)).size,3);
  const sourceComment=peerRows[0].sourceCommentId;
  assert.ok(peerRows.every(row=>row.sourceCommentId===sourceComment));
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(peerRows[0].id);
  const peer=store.claimJob();assert.ok(peer);assert.equal(peer.source,'peer');
  const context=store.getContext(peer);assert.equal(context.sourceAgentName,source.agentId);
  assert.ok(context.comments.some((comment:any)=>comment.id===older&&comment.images[0].description==='A small dog'));
  assert.ok(context.images.some(image=>image.id===commentImage.id));
  store.markDelivered(peer);
  assert.equal(store.completeJob(peer,{like:true,comment:'Hi back',memory:null},undefined,()=>0.99),'commented');
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE source='peer'").get() as {count:number}).count,3);
  assert.equal((db.prepare("SELECT parent_id AS parentId FROM comments WHERE text='Hi back'").get() as {parentId:number}).parentId,sourceComment);
  const activity=store.getActivityPage().items.find((row:any)=>row.id===peer.id) as any;
  assert.equal(activity.sourceAgentName,source.agentId);
  assert.ok(activity.deliveredAt);
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(peerRows[1].id);
  const missed=store.claimJob();assert.ok(missed);assert.equal(store.completeJob(missed,null,'missed'),'missed');
  assert.equal((db.prepare('SELECT delivered_at AS deliveredAt FROM jobs WHERE id=?').get(missed.id) as any).deliveredAt,null);
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(peerRows[2].id);
  const ignored=store.claimJob();assert.ok(ignored);store.markDelivered(ignored);
  assert.equal(store.completeJob(ignored,{like:false,comment:null,memory:null}),'ignored');
  assert.ok((db.prepare('SELECT delivered_at AS deliveredAt FROM jobs WHERE id=?').get(ignored.id) as any).deliveredAt);
});

test('stopped peer stays stopped; overload records count and suppresses only an interested reply',async()=>{
  const root=mkdtempSync(join(tmpdir(),'social-peer-overload-'));
  const agents=join(root,'agents');for(const id of ['alpha','beta','gamma']){mkdirSync(join(agents,id),{recursive:true});writeFileSync(join(agents,id,'profile.json'),JSON.stringify({name:id,handle:id,persona:'Friendly',enabled:true}));}
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=agents;
  const store=await import(`./index.ts?overload=${Date.now()}`);store.syncAgents();const db=new DatabaseSync(process.env.DATABASE_PATH);
  const post=store.createPost('A post');db.prepare("UPDATE jobs SET due_at=9999999999999 WHERE status='pending'").run();
  const sourceId=(db.prepare("SELECT id FROM jobs WHERE status='pending' ORDER BY id LIMIT 1").get() as {id:number}).id;
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(sourceId);const source=store.claimJob();assert.ok(source);
  store.completeJob(source,{like:false,comment:'A new thought',memory:null});
  const peers=db.prepare("SELECT id,agent_id AS agentId FROM jobs WHERE source='peer' ORDER BY agent_id").all() as {id:number;agentId:string}[];
  assert.equal(peers.length,2);
  db.prepare('INSERT INTO agent_thread_state(agent_id,post_id,last_seen_comment_id,last_seen_at,following) VALUES(?,?,?,?,0)').run(peers[0].agentId,post.id,0,Date.now());
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(peers[0].id);const stopped=store.claimJob();assert.ok(stopped);assert.equal(store.isStoppedPeer(stopped),true);
  store.markDelivered(stopped);assert.equal(store.completeJob(stopped,null,'stopped'),'stopped');
  assert.equal((db.prepare('SELECT following FROM agent_thread_state WHERE agent_id=? AND post_id=?').get(stopped.agentId,post.id) as {following:number}).following,0);
  const now=Date.now();for(let i=0;i<5;i++) db.prepare("INSERT INTO jobs(kind,post_id,agent_id,due_at,status,source,delivered_at,outcome) VALUES('reply',?,?,0,'done','notification',?,'ignored')").run(post.id,peers[1].agentId,now-1000-i);
  db.prepare("INSERT INTO jobs(kind,post_id,agent_id,due_at,status,source,delivered_at,outcome) VALUES('reply',?,?,0,'done','mention',?,'commented')").run(post.id,peers[1].agentId,now);
  for(const [status,sourceKind,outcome,at] of [['done','notification','missed',now],['not_selected','notification','not_selected',now],['done','browse','commented',now],['done','notification','ignored',now-3600001]] as const)
    db.prepare('INSERT INTO jobs(kind,post_id,agent_id,due_at,status,source,delivered_at,outcome) VALUES(?,?,?,0,?,?,?,?)').run('reply',post.id,peers[1].agentId,status,sourceKind,at,outcome);
  db.prepare('UPDATE jobs SET due_at=0 WHERE id=?').run(peers[1].id);const interested=store.claimJob();assert.ok(interested);store.markDelivered(interested);
  assert.equal(store.completeJob(interested,{like:false,comment:'I would answer',memory:null},undefined,()=>0.2),'overload_suppressed');
  const record=db.prepare('SELECT overload_count AS count,overload_chance AS chance,outcome FROM jobs WHERE id=?').get(interested.id) as any;
  assert.equal(record.count,5);assert.equal(record.chance,0.30000000000000004);assert.equal(record.outcome,'overload_suppressed');
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM comments WHERE text='I would answer'").get() as {count:number}).count,0);
});
