import { syncAgents,recoverJobs,claimJob,getContext,completeJob,failJob,recordPayload } from '@social/db';
import { buildMessages,decide } from '@social/llm';
import { shouldMiss } from '@social/core';
syncAgents();recoverJobs();console.log('Agent worker ready');
async function tick(){const job=claimJob();if(!job)return;try{
  const provider=process.env.LLM_PROVIDER||'mock';
  const missed=shouldMiss(provider,Boolean(job.mockMiss));
  if(missed){completeJob(job,null,'missed');console.log(JSON.stringify({event:'notification',jobId:job.id,agentId:job.agentId,outcome:'missed'}));return;}
  const context=getContext(job);const messages=buildMessages(context,job.kind);
  recordPayload(job,{...messages,imageIds:context.images.map(image=>image.id),provider,model:provider==='mock'?'mock':process.env.LLM_MODEL||'',memoryBefore:context.memory});
  const decision=await decide(context,job.kind,messages);completeJob(job,decision);
  console.log(JSON.stringify({event:'notification',jobId:job.id,agentId:job.agentId,outcome:decision.like&&decision.comment?'liked_and_commented':decision.like?'liked':decision.comment?'commented':'ignored'}));
}catch(error){failJob(job,error);console.error(JSON.stringify({event:'notification_error',jobId:job.id,agentId:job.agentId,error:String(error)}));}}
let busy=false;setInterval(()=>{if(busy)return;busy=true;void tick().finally(()=>{busy=false;});},1000);
