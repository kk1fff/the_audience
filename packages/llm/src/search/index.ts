import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export type SearchResult={title:string;url:string;snippet:string;source:string;publishedAt:number|null};
export interface SearchProvider {readonly name:string;search(query:string,limit:number):Promise<SearchResult[]>}
export const APPROVED_PUBLIC_QUERIES=new Set(['aurora borealis science','astronomy science','museum history','architecture history','wildlife nature','gardening plants','hiking nature','photography technique','cooking technique','railway history','literature history','music history','science technology']);
function assertPublicQuery(query:string){if(!APPROVED_PUBLIC_QUERIES.has(query))throw new Error('Unapproved public search topic');}
const helper=fileURLToPath(new URL('./ddgs_helper.py',import.meta.url));
function cleanUrl(value:unknown):string|null {if(typeof value!=='string')return null;try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}
function cleanResult(value:any):SearchResult|null {
  const url=cleanUrl(value?.url??value?.href);if(!url)return null;
  const title=String(value?.title||'Untitled source').slice(0,180);
  const snippet=String(value?.snippet??value?.body??value?.summary??value?.highlights?.[0]??'').slice(0,300);
  const source=String(value?.source||new URL(url).hostname).slice(0,90);
  const publishedAt=value?.publishedAt||value?.publishedDate?Date.parse(value.publishedAt??value.publishedDate):NaN;
  return {title,url,snippet,source,publishedAt:Number.isFinite(publishedAt)?publishedAt:null};
}
export function normalizeSearchResults(raw:unknown,limit:number):SearchResult[] {return (Array.isArray(raw)?raw:[]).map(cleanResult).filter((x):x is SearchResult=>!!x).slice(0,Math.min(3,Math.max(1,limit)));}
export class DdgsSearchProvider implements SearchProvider {
  readonly name='DDGS';
  private python:string;
  constructor(python=process.env.BACKGROUND_PYTHON||'python3'){this.python=python;}
  search(query:string,limit:number):Promise<SearchResult[]> {assertPublicQuery(query);return new Promise((resolve,reject)=>{
    const child=spawn(this.python,[helper],{stdio:['pipe','pipe','pipe']});
    let output='';let error='';let settled=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Search timed out'));},2200);
    const finish=(failure?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(failure){reject(failure);return;}try{resolve(normalizeSearchResults(JSON.parse(output),limit));}catch{reject(new Error('Invalid search response'));}};
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>30000){child.kill('SIGKILL');finish(new Error('Search response too large'));}});
    child.stderr.on('data',chunk=>{error+=chunk.slice(0,300);});
    child.stdin.on('error',()=>{});
    child.on('error',()=>finish(new Error('Search helper unavailable')));
    child.on('close',code=>finish(code===0?undefined:new Error(error.includes('ModuleNotFoundError')?'DDGS is not installed':'Search unavailable')));
    child.stdin.end(JSON.stringify({query,limit:Math.min(2,Math.max(1,limit))}));
  });}
}
export class ExaSearchProvider implements SearchProvider {
  readonly name='Exa';
  private key:string;private fetcher:typeof fetch;
  constructor(key:string,fetcher:typeof fetch=fetch){this.key=key;this.fetcher=fetcher;}
  async search(query:string,limit:number):Promise<SearchResult[]> {
    assertPublicQuery(query);
    const response=await this.fetcher('https://api.exa.ai/search',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':this.key},body:JSON.stringify({query,type:'auto',numResults:Math.min(2,Math.max(1,limit)),contents:{highlights:true}}),signal:AbortSignal.timeout(1800)});
    if(!response.ok)throw new Error(`Exa HTTP ${response.status}`);
    const data=await response.json() as any;
    return normalizeSearchResults(data.results,limit);
  }
}
export function createSearchProvider(env:NodeJS.ProcessEnv=process.env):SearchProvider {return env.EXA_API_KEY?new ExaSearchProvider(env.EXA_API_KEY):new DdgsSearchProvider(env.BACKGROUND_PYTHON||'python3');}
