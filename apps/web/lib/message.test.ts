import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
function image(name:string) { return new File([png],name,{type:'image/png'}); }
function request(files:File[], descriptions?:FormDataEntryValue[], parentId?:number) {
  const form=new FormData();form.set('text','');if(parentId!==undefined)form.set('parentId',String(parentId));
  for(const file of files)form.append('images',file);
  for(const description of descriptions||[])form.append('imageDescriptions',description);
  return new Request('http://localhost/api/posts',{method:'POST',body:form});
}

test('image descriptions migrate, validate, and stay aligned through posts and replies', async () => {
  const root=mkdtempSync(join(tmpdir(),'image-descriptions-'));
  process.env.DATABASE_PATH=join(root,'social.sqlite');
  process.env.AGENTS_DIR=join(root,'agents');
  mkdirSync(join(process.env.AGENTS_DIR,'one'),{recursive:true});
  writeFileSync(join(process.env.AGENTS_DIR,'one','profile.json'),JSON.stringify({name:'One',handle:'one',persona:'Friendly',enabled:true}));
  const legacy=new DatabaseSync(process.env.DATABASE_PATH);
  legacy.exec('CREATE TABLE images (id TEXT PRIMARY KEY, post_id INTEGER, comment_id INTEGER, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, file_name TEXT NOT NULL)');
  legacy.prepare("INSERT INTO images(id,mime_type,byte_size,file_name) VALUES('existing','image/png',1,'existing.png')").run();
  legacy.close();
  const {parseMessage}=await import('./message.ts');
  const store=await import('@social/db');
  store.syncAgents();
  const sql=new DatabaseSync(process.env.DATABASE_PATH);
  assert.ok((sql.prepare('PRAGMA table_info(images)').all() as {name:string}[]).some(column=>column.name==='description'));
  assert.equal((sql.prepare("SELECT description FROM images WHERE id='existing'").get() as {description:string|null}).description,null);

  const legacyMessage=await parseMessage(request([image('old.png')]));
  const legacyPost=store.createPost('',legacyMessage.imageIds);
  assert.equal(store.getFeed().find((post:any)=>post.id===legacyPost.id)?.images[0].description,null);
  const first='A red door beside a flower pot', second='Clouds over the market';
  const described=await parseMessage(request([image('same.png'),image('same.png')],[first,second]));
  const post=store.createPost('',described.imageIds);
  const feedPost=store.getFeed().find((item:any)=>item.id===post.id)!;
  assert.deepEqual(feedPost.images.map((item:any)=>item.description),[first,second]);
  assert.deepEqual(feedPost.images.map((item:any)=>item.id),described.imageIds);
  assert.equal((store.getActivityPage().items as any[]).find(item=>item.postId===post.id).postImageDescription,first);
  assert.deepEqual(store.getImageAccessibility(described.imageIds[0]),{id:described.imageIds[0],description:first,context:'post'});

  await assert.rejects(parseMessage(request([image('a.png'),image('b.png')],['only one'])),/must match/);
  await assert.rejects(parseMessage(request([image('a.png')],['x'.repeat(1001)])),/1000 characters/);
  await assert.rejects(parseMessage(request([image('a.png')],[new File(['bad'],'metadata.txt')])),/must match/);
  const agentComment=Number(sql.prepare("INSERT INTO comments(post_id,author_type,agent_id,text) VALUES(?,'agent','one','Reply here')").run(post.id).lastInsertRowid);
  const replyMessage=await parseMessage(request([image('reply.png')],['A blue bicycle'],agentComment));
  const reply=store.createOwnerReply(agentComment,'',replyMessage.imageIds);
  assert.ok(reply);
  const replyImage=store.getFeed().find((item:any)=>item.id===post.id)!.comments.find((comment:any)=>comment.id===reply.id)!.images[0];
  assert.equal(replyImage.description,'A blue bicycle');
  assert.deepEqual(store.getImageAccessibility(replyImage.id),{id:replyImage.id,description:'A blue bicycle',context:'reply'});
});
