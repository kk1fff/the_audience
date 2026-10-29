import { syncAgents,recoverJobs,scheduleFeedChecks,claimJob,getContext,completeJob,failJob,recordPayload,markDelivered,isStoppedPeer } from '@social/db';
import { buildMessages,decide } from '@social/llm';
import { shouldMiss } from '@social/core';
syncAgents();recoverJobs();console.log('Agent worker ready');
async function tick(){scheduleFeedChecks();const job=claimJob();if(!job)return;try{
  const provider=process.env.LLM_PROVIDER||'mock';
  if(isStoppedPeer(job)){markDelivered(job);completeJob(job,null,'stopped');console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome:'stopped'}));return;}
  const missed=(job.source==='notification'||job.source==='peer')&&shouldMiss(provider,Boolean(job.mockMiss));
  if(missed){completeJob(job,null,'missed');console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome:'missed'}));return;}
  markDelivered(job);
  const context=getContext(job);const messages=buildMessages(context,job.kind,job.source);
  recordPayload(job,{...messages,imageIds:context.images.map(image=>image.id),provider,model:provider==='mock'?'mock':process.env.LLM_MODEL||'',memoryBefore:context.memory});
  const decision=await decide(context,job.kind,messages,job.source);const outcome=completeJob(job,decision);
  console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome}));
}catch(error){failJob(job,error);console.error(JSON.stringify({event:`${job.source}_error`,jobId:job.id,agentId:job.agentId,error:String(error)}));}}
let busy=false;setInterval(()=>{if(busy)return;busy=true;void tick().finally(()=>{busy=false;});},1000);
