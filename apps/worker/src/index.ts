import { syncAgents,recoverJobs,scheduleFeedChecks,claimJob,getContext,completeJob,failJob,recordPayload,markDelivered,isStoppedPeer } from '@social/db';
import { buildMessages,decide,buildBackground,backgroundUnavailable,loadBehaviorPrompt,tuningBudget } from '@social/llm';
import { shouldMissJob } from '@social/core';
const budget=tuningBudget();
if(budget){if(budget.deadline<=Date.now()){console.log('Tuning deadline reached');process.exit(0);}
setTimeout(()=>{console.log('Tuning deadline reached');process.exit(0);},Math.min(budget.deadline-Date.now(),2147483647));}
loadBehaviorPrompt();syncAgents();recoverJobs();console.log('Agent worker ready');
async function tick(){scheduleFeedChecks();const job=claimJob();if(!job)return;try{
  const provider=process.env.LLM_PROVIDER||'mock';
  if(isStoppedPeer(job)){markDelivered(job);completeJob(job,null,'stopped');console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome:'stopped'}));return;}
  const missed=shouldMissJob(job,provider,Boolean(job.mockMiss));
  if(missed){completeJob(job,null,'missed');console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome:'missed'}));return;}
  markDelivered(job);
  const context=getContext(job);
  const background=await buildBackground(context).catch(error=>backgroundUnavailable(context,error));
  const messages=buildMessages(context,job.kind,job.source,background);
  recordPayload(job,{...messages,imageIds:context.images.map(image=>image.id),provider,model:provider==='mock'?'mock':process.env.LLM_MODEL||'',memoryBefore:context.memory,background});
  const decision=await decide(context,job.kind,messages,job.source,background);const outcome=completeJob(job,decision);budget?.succeeded();
  console.log(JSON.stringify({event:job.source,jobId:job.id,agentId:job.agentId,outcome}));
}catch(error){failJob(job,error);console.error(JSON.stringify({event:`${job.source}_error`,jobId:job.id,agentId:job.agentId,error:String(error)}));if(budget?.failed()){console.error('Tuning stopped after repeated failures');process.exit(1);}}}
let busy=false;setInterval(()=>{if(busy)return;busy=true;void tick().finally(()=>{busy=false;});},1000);
