import { getAgentConfiguration } from '@social/db';
import { loadBehaviorPrompt, buildMessages, makeRequest } from '@social/llm';

async function main() {
  const behavior = loadBehaviorPrompt();
  const agents = getAgentConfiguration();
  if (process.argv[2] === 'config') {
    console.log(JSON.stringify({version:1, behavior, agents}));
    return;
  }
  if (process.argv[2] !== 'probe') throw new Error('Use config or probe');
  const provider = process.env.LLM_PROVIDER;
  if (provider !== 'ollama' && provider !== 'openai_compatible') throw new Error('A real LLM provider is required');
  const model = process.env.LLM_MODEL, base = process.env.LLM_BASE_URL?.replace(/\/$/, '');
  if (!model || !base) throw new Error('LLM_MODEL and LLM_BASE_URL are required');
  const agent = agents.find(a=>a.profile.enabled!==false);
  if (!agent) throw new Error('At least one enabled agent is required');
  const messages = buildMessages({agent:{id:agent.id,...agent.profile},memory:agent.memory,post:'Hello. Please acknowledge this connection test briefly.',comments:[],sourceCommentId:null,images:[]}, 'post');
  const headers: Record<string,string> = {'Content-Type':'application/json'};
  if (provider==='openai_compatible' && process.env.LLM_API_KEY) headers.Authorization=`Bearer ${process.env.LLM_API_KEY}`;
  const response=await fetch(`${base}${provider==='ollama'?'/api/chat':'/chat/completions'}`,{method:'POST',headers,body:JSON.stringify(makeRequest(provider,model,messages,[],process.env.LLM_THINK==='true'?true:process.env.LLM_THINK==='false'?false:undefined)),signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`LLM connection test returned HTTP ${response.status}`);
  const payload=await response.json() as any;
  const raw=provider==='ollama'?payload.message?.content:payload.choices?.[0]?.message?.content;
  let decision: any;
  try {decision=JSON.parse(raw);} catch {throw new Error('LLM connection test did not return a JSON object');}
  if(!decision || typeof decision.like!=='boolean' || !['comment','memory','memoryEvaluation'].every(k=>decision[k]===null||typeof decision[k]==='string') || !(decision.follow===null||typeof decision.follow==='boolean')) throw new Error('LLM connection test returned an invalid decision schema');
  console.log(JSON.stringify({provider,model,valid:true,returnedModel:payload.model||null}));
}
main().catch(error=>{console.error(error instanceof Error ? error.message : 'Tuning command failed');process.exitCode=1;});
