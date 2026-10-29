import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMessages, makeRequest } from './index.ts';
test('captured prompt and vision requests include expected content',()=>{
  const file=join(mkdtempSync(join(tmpdir(),'vision-test-')),'image.png');writeFileSync(file,Buffer.from([137,80,78,71]));
  const image={id:'image-one',mimeType:'image/png',path:file};
  const context={agent:{id:'mira',name:'Mira',persona:'Thoughtful'},memory:'Owner likes books',post:'Look at this',comments:[{text:'Nice'}],sourceCommentId:null,images:[image]};
  const messages=buildMessages(context,'post');assert.match(messages.system,/Mira/);assert.match(messages.system,/Owner likes books/);assert.match(messages.user,/Look at this/);assert.match(messages.user,/image-one/);
  const ollama=makeRequest('ollama','vision-model',messages,[image],false) as any;
  assert.equal(ollama.messages[0].content,messages.system);assert.equal(ollama.think,false);assert.equal(ollama.messages[1].images[0],Buffer.from([137,80,78,71]).toString('base64'));
  const openai=makeRequest('openai_compatible','vision-model',messages,[image]) as any;
  assert.equal(openai.messages[1].content[0].text,messages.user);assert.match(openai.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
});
test('post prompt describes how the agent found the post',()=>{
  const context={agent:{id:'mira',name:'Mira',persona:'Thoughtful'},memory:'',post:'A new post',comments:[],sourceCommentId:null,images:[]};
  const notified=buildMessages(context,'post','notification').user;
  const feedCheck=buildMessages(context,'post','feed').user;
  assert.match(notified,/You were notified about this post/);
  assert.doesNotMatch(notified,/checking the feed/);
  assert.match(feedCheck,/You found this post while checking the feed/);
  assert.doesNotMatch(feedCheck,/You were notified/);
});
