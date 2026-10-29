import { readFileSync } from 'node:fs';
import type { Decision } from '@social/core';
export type ImageInput={id:string;mimeType:string;path:string};
export type Context={agent:{id:string;name:string;persona:string};memory:string;post:string;comments:unknown[];sourceCommentId:number|null;images:ImageInput[]};
export type Messages={system:string;user:string};
export function buildMessages(context:Context,kind:'post'|'reply'):Messages { return {
  system:`You are ${context.agent.name}. Persona: ${context.agent.persona}. Private memory: ${context.memory}. You are a friend in The Audience. Decide whether to like or comment, and evaluate whether this interaction is worth remembering. Return only JSON: {"like":boolean,"comment":string|null,"memory":string|null,"memoryEvaluation":string|null}. Keep comments under 280 characters and memory updates short. Do not create top-level posts or repost.`,
  user:`Post: ${context.post}. Thread: ${JSON.stringify(context.comments)}. Attached images: ${context.images.map(i=>i.id).join(', ')||'none'}. ${kind==='reply'?`The owner replied to your comment. Target comment ID: ${context.sourceCommentId}. You may decide not to reply.`:'You were notified about this post. You may decide not to react.'}`
}; }
export function makeRequest(provider:'ollama'|'openai_compatible',model:string,messages:Messages,images:ImageInput[]) {
  const encoded=images.map(image=>({mimeType:image.mimeType,base64:readFileSync(image.path).toString('base64')}));
  return provider==='ollama'
    ? {model,stream:false,messages:[{role:'system',content:messages.system},{role:'user',content:messages.user,images:encoded.map(i=>i.base64)}],format:'json'}
    : {model,messages:[{role:'system',content:messages.system},{role:'user',content:[{type:'text',text:messages.user},...encoded.map(i=>({type:'image_url',image_url:{url:`data:${i.mimeType};base64,${i.base64}`}}))]}]};
}
function parseDecision(raw:string):Decision {const match=raw?.match(/\{[\s\S]*\}/);if(!match)throw new Error('Model did not return JSON');const value=JSON.parse(match[0]);return {like:value.like===true,comment:typeof value.comment==='string'?value.comment.slice(0,280):null,memory:typeof value.memory==='string'?value.memory.slice(0,500):null,memoryEvaluation:typeof value.memoryEvaluation==='string'?value.memoryEvaluation.slice(0,500):null};}
export async function decide(context:Context,kind:'post'|'reply',messages=buildMessages(context,kind)):Promise<Decision> {
  const provider=process.env.LLM_PROVIDER||'mock';
  if(provider==='mock')return kind==='post'
    ? {like:true,comment:`${context.agent.name} here — ${context.post||'your image'} caught my attention. What happened next?`.slice(0,280),memory:`Saw a post: ${(context.post||`${context.images.length} image(s)`).slice(0,100)}`,memoryEvaluation:'This post may be useful context for future conversations.'}
    : {like:false,comment:'Thanks for replying! I\'d like to hear more.',memory:'The owner replied to me.',memoryEvaluation:'The owner continued our conversation.'};
  if(provider!=='ollama'&&provider!=='openai_compatible')throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  const base=(process.env.LLM_BASE_URL||'').replace(/\/$/,'');const model=process.env.LLM_MODEL;
  if(!base||!model)throw new Error('LLM_BASE_URL and LLM_MODEL are required');
  const url=provider==='ollama'?`${base}/api/chat`:`${base}/chat/completions`;
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(provider==='openai_compatible'&&process.env.LLM_API_KEY)headers.Authorization=`Bearer ${process.env.LLM_API_KEY}`;
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(makeRequest(provider,model,messages,context.images)),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`LLM request failed: ${response.status}`);
  const data=await response.json() as any;
  return parseDecision(provider==='ollama'?data.message?.content:data.choices?.[0]?.message?.content);
}
