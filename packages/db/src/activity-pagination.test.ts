import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('activity pages keep complete posts and stable keyset navigation', async () => {
  const root = mkdtempSync(join(tmpdir(),'activity-pages-'));
  const agents = join(root,'agents');
  mkdirSync(join(agents,'one'),{recursive:true});
  writeFileSync(join(agents,'one','profile.json'),JSON.stringify({name:'One',handle:'one',persona:'Friendly',enabled:true}));
  process.env.DATABASE_PATH = join(root,'social.sqlite');
  process.env.AGENTS_DIR = agents;
  const store = await import('./index.ts');
  store.syncAgents();
  const posts = Array.from({length:7},(_,index)=>store.createPost(`Post ${index+1}`));
  const sql = new DatabaseSync(process.env.DATABASE_PATH);
  // A single older post has more activity than the old 50-job page could hold.
  for (let index=0;index<55;index++) sql.prepare("INSERT INTO jobs(kind,post_id,agent_id,due_at,status,source) VALUES('post',?,'one',0,'not_selected','notification')").run(posts[0].id);
  sql.exec('PRAGMA foreign_keys=OFF');
  sql.prepare('DELETE FROM posts WHERE id=?').run(posts[1].id);

  const first = store.getActivityPage();
  assert.deepEqual([...new Set((first.items as any[]).map(item=>item.postId))],[7,6,5,4,3]);
  assert.equal(first.nextCursor,3);
  const older = store.getActivityPage(first.nextCursor);
  assert.deepEqual([...new Set((older.items as any[]).map(item=>item.postId))],[2,1]);
  assert.equal(older.nextCursor,null);
  assert.equal((older.items as any[]).filter(item=>item.postId===1).length,56);
  assert.equal((older.items as any[]).find(item=>item.postId===2).postText,null);
  assert.equal(new Set([...(first.items as any[]),...(older.items as any[])].map(item=>item.id)).size,62);
  assert.deepEqual(store.getActivityPage().items,first.items); // Previous uses the saved null cursor.

  const newJob = Number(sql.prepare("INSERT INTO jobs(kind,post_id,agent_id,due_at,status,source) VALUES('post',7,'one',0,'not_selected','notification')").run().lastInsertRowid);
  const polled = store.getActivityPage();
  assert.equal(polled.nextCursor,first.nextCursor);
  assert.ok((polled.items as any[]).some(item=>item.id===newJob));
  assert.equal((store.getActivityPage(first.nextCursor).items as any[]).filter(item=>item.postId===1).length,56);
  assert.throws(()=>store.getActivityPage(0),/Invalid activity cursor/);
  assert.throws(()=>store.getActivityPage(Number.MAX_SAFE_INTEGER+1),/Invalid activity cursor/);
});
