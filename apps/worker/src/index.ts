import { syncAgents,recoverJobs,scheduleFeedChecks,claimJob,getContext,completeJob,failJob,recordPayload } from '@social/db';
import { buildMessages,decide } from '@social/llm';
import { shouldMiss } from '@social/core';
syncAgents();recoverJobs();console.log('Agent worker ready');
async function tick(){scheduleFeedChecks();const job=claimJob();if(!job)return;try{
  const provider=process.env.LLM_PROVIDER||'mock';
  const missed=job.source==='notification'&&shouldMiss(provider,Boolean(job.mockMiss));
  if(missed){completeJob(job,null,'missed');console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome:'missed'}));return;}
  const context=getContext(job);const messages=buildMessages(context,job.kind,job.source);
  recordPayload(job,{...messages,imageIds:context.images.map(image=>image.id),provider,model:provider==='mock'?'mock':process.env.LLM_MODEL||'',memoryBefore:context.memory});
  const decision=await decide(context,job.kind,messages);completeJob(job,decision);
  const liked=job.kind==='post'&&decision.like;const commented=Boolean(decision.comment?.trim());
  console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome:liked&&commented?'liked_and_commented':liked?'liked':commented?'commented':'ignored'}));
}catch(error){failJob(job,error);console.error(JSON.stringify({event:`${job.source}_error`,jobId:job.id,agentId:job.agentId,error:String(error)}));}}
let busy=false;setInterval(()=>{if(busy)return;busy=true;void tick().finally(()=>{busy=false;});},1000);
