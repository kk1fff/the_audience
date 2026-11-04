import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('persistent overlays merge atomically, preserve history, and stop disabled agent work', async () => {
  const root=mkdtempSync(join(tmpdir(),'social-overlay-'));
  const base=join(root,'bundled'), overlay=join(root,'agents');
  const put=(dir:string,id:string,profile:unknown) => {mkdirSync(join(dir,id),{recursive:true});writeFileSync(join(dir,id,'profile.json'),JSON.stringify(profile));};
  const profile=(name:string) => ({name,handle:name,persona:'Friendly',enabled:true,feedCheckIntervalMinutes:7});
  for(const id of ['aya','leo']) {put(base,id,profile(id));writeFileSync(join(base,id,'memory.md'),'Bundled seed');}
  process.env.DATABASE_PATH=join(root,'social.sqlite');process.env.AGENTS_DIR=base;
  const store=await import('./index.ts');
  store.syncAgents();
  const sql=new DatabaseSync(process.env.DATABASE_PATH);
  const snapshot=()=>JSON.stringify(['agents','memories','agent_feed_checks','jobs'].map(table=>sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
  const initial=snapshot();mkdirSync(overlay);store.syncAgents();assert.equal(snapshot(),initial);
  put(overlay,'aya',{persona:'Curious',feedCheckIntervalMinutes:9});
  put(overlay,'new',profile('new'));writeFileSync(join(overlay,'new','memory.md'),'Overlay seed');
  writeFileSync(join(overlay,'aya','memory.md'),'Must not replace learned memory');
  sql.prepare("UPDATE memories SET content='Learned memory' WHERE agent_id='aya'").run();
  store.syncAgents();
  assert.equal(store.getAgents().find(a=>a.id==='aya')?.persona,'Curious');
  assert.equal(store.getAgents().find(a=>a.id==='aya')?.name,'aya');
  assert.equal((sql.prepare("SELECT content FROM memories WHERE agent_id='aya'").get() as any).content,'Learned memory');
  assert.equal((sql.prepare("SELECT content FROM memories WHERE agent_id='new'").get() as any).content,'Overlay seed');
  assert.equal((sql.prepare("SELECT interval_ms FROM agent_feed_checks WHERE agent_id='aya'").get() as any).interval_ms,540000);
  const stable=snapshot();store.syncAgents();assert.equal(snapshot(),stable);
  // Every effective profile is validated before any database mutation.
  for(const invalid of [{enabled:'false'},{feedCheckIntervalMinutes:0},{latitude:500,longitude:0},{timeZone:'invalid/zone'},null,[]]) {
    put(overlay,'z-invalid',invalid && !Array.isArray(invalid) ? {...profile('z-invalid'),...invalid} : invalid);assert.throws(()=>store.syncAgents(),/Invalid.*z-invalid/);assert.equal(snapshot(),stable);
  }
  writeFileSync(join(overlay,'z-invalid','profile.json'),'{');assert.throws(()=>store.syncAgents(),/z-invalid/);assert.equal(snapshot(),stable);
  rmSync(join(overlay,'z-invalid'),{recursive:true});
  sql.exec("CREATE TRIGGER reject_profile BEFORE UPDATE ON agents WHEN NEW.id='leo' AND NEW.enabled=1 BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  assert.throws(()=>store.syncAgents(),/simulated write failure/);assert.equal(snapshot(),stable);
  sql.exec('DROP TRIGGER reject_profile');
  // Initial seeds prefer the overlay, even for a bundled profile with a memory-only override.
  put(base,'seed',profile('seed'));writeFileSync(join(base,'seed','memory.md'),'Base');
  mkdirSync(join(overlay,'seed'));writeFileSync(join(overlay,'seed','memory.md'),'Override');store.syncAgents();
  assert.equal((sql.prepare("SELECT content FROM memories WHERE agent_id='seed'").get() as any).content,'Override');
  // Create historical reactions plus pending and interrupted work for Aya.
  const post=store.createPost('@aya hello');sql.prepare('UPDATE jobs SET due_at=0').run();
  let job=store.claimJob();while(job && job.agentId!=='aya'){store.completeJob(job,null,'stopped');job=store.claimJob();}
  assert.ok(job);store.completeJob(job,{like:true,comment:'Hello',memory:null});
  const comment=store.getPost(post.id).comments.find((c:any)=>c.agentId==='aya');assert.ok(comment);
  store.createOwnerReply(comment.id,'Reply');sql.prepare("UPDATE jobs SET due_at=9999999999999 WHERE agent_id<>'aya'").run();sql.prepare("UPDATE jobs SET due_at=0 WHERE agent_id='aya'").run();
  const interrupted=store.claimJob();assert.equal(interrupted?.agentId,'aya');
  const queued=store.createPost('@aya queued');
  const browseId=Number(sql.prepare("INSERT INTO browse_runs(agent_id,scheduled_at,started_at,visit_count) VALUES('aya',1,1,1)").run().lastInsertRowid);
  sql.prepare("INSERT INTO jobs(kind,post_id,agent_id,due_at,source,browse_id) VALUES('post',?,'aya',0,'browse',?)").run(queued.id,browseId);
  put(overlay,'aya',{enabled:false});rmSync(join(overlay,'new'),{recursive:true});store.syncAgents();store.recoverJobs();
  assert.ok(!store.getAgents().some(a=>['aya','new'].includes(a.id)));
  assert.equal((sql.prepare("SELECT COUNT(*) AS n FROM jobs WHERE agent_id IN ('aya','new') AND status IN ('pending','running')").get() as any).n,0);
  assert.equal((sql.prepare('SELECT outcome FROM jobs WHERE id=?').get(interrupted!.id) as any).outcome,'stopped');
  assert.equal(store.getActivityAttempts(interrupted!.id)[0].status,'stopped');
  assert.ok((sql.prepare('SELECT completed_at FROM browse_runs WHERE id=?').get(browseId) as any).completed_at);
  const stoppedIds=(sql.prepare("SELECT id FROM jobs WHERE agent_id='aya' AND outcome='stopped'").all() as any[]).map(row=>row.id);
  assert.ok(stoppedIds.length>=2);
  assert.equal(store.getPost(post.id).comments.filter((c:any)=>c.agentId==='aya').length,1);assert.equal(store.getPost(post.id).likes.length,1);
  const disabledCount=(sql.prepare("SELECT COUNT(*) AS n FROM jobs WHERE agent_id='aya'").get() as any).n;
  store.createOwnerReply(comment.id,'@aya are you there?');
  const fresh=store.createPost('@aya @leo fresh');
  sql.prepare('UPDATE agent_feed_checks SET next_check_at=0').run();store.scheduleFeedChecks();
  assert.equal((sql.prepare("SELECT COUNT(*) AS n FROM jobs WHERE agent_id='aya'").get() as any).n,disabledCount);
  sql.prepare("UPDATE jobs SET due_at=0 WHERE agent_id='leo'").run();
  const active=store.claimJob();assert.ok(active);assert.notEqual(active.agentId,'aya');
  store.completeJob(active,{like:true,comment:'Still active',memory:null});
  assert.equal((sql.prepare("SELECT COUNT(*) AS n FROM jobs WHERE agent_id='aya'").get() as any).n,disabledCount);
  assert.ok((sql.prepare("SELECT 1 FROM jobs WHERE post_id=? AND agent_id='leo'").get(fresh.id)));
  rmSync(join(overlay,'aya'),{recursive:true});store.syncAgents();
  assert.equal(store.getAgents().find(a=>a.id==='aya')?.persona,'Friendly');
  assert.equal((sql.prepare("SELECT content FROM memories WHERE agent_id='aya'").get() as any).content,'Learned memory');
  for(const id of stoppedIds) assert.equal((sql.prepare('SELECT status FROM jobs WHERE id=?').get(id) as any).status,'done');
  put(overlay,'new',profile('new'));store.syncAgents();assert.ok(store.getAgents().some(a=>a.id==='new'));
  assert.equal((sql.prepare("SELECT content FROM memories WHERE agent_id='new'").get() as any).content,'Overlay seed');
  sql.close();
});
