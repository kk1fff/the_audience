import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { delayMs, pickAgents, type AgentProfile, type Decision } from '@social/core';
const repoRoot = resolve(process.cwd(), '../..');
const path = resolve(repoRoot, process.env.DATABASE_PATH || 'data/social.sqlite');
const uploadsDir = join(dirname(path), 'uploads');
mkdirSync(dirname(path), { recursive: true });
let connection: DatabaseSync | null = null;
function getDb(): DatabaseSync {
  if (connection) return connection;
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, handle TEXT NOT NULL, persona TEXT NOT NULL, avatar_color TEXT NOT NULL, enabled INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS memories (agent_id TEXT PRIMARY KEY REFERENCES agents(id), content TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id), parent_id INTEGER REFERENCES comments(id), author_type TEXT NOT NULL CHECK(author_type IN ('owner','agent')), agent_id TEXT REFERENCES agents(id), text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS likes (post_id INTEGER NOT NULL REFERENCES posts(id), agent_id TEXT NOT NULL REFERENCES agents(id), PRIMARY KEY(post_id, agent_id));
  CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('post','reply')), post_id INTEGER NOT NULL REFERENCES posts(id), source_comment_id INTEGER REFERENCES comments(id), agent_id TEXT NOT NULL REFERENCES agents(id), due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(kind, source_comment_id, agent_id), UNIQUE(kind, post_id, agent_id, source_comment_id));`);
  db.exec(`CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, post_id INTEGER REFERENCES posts(id), comment_id INTEGER REFERENCES comments(id), mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, file_name TEXT NOT NULL, description TEXT);
  CREATE TABLE IF NOT EXISTS job_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id), started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, error TEXT, prompt_text TEXT, image_ids TEXT);`);
  if (!(db.prepare('PRAGMA table_info(images)').all() as {name:string}[]).some(column=>column.name==='description')) db.exec('ALTER TABLE images ADD COLUMN description TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS images_for_post_preview ON images(post_id,comment_id)');
  db.exec('CREATE INDEX IF NOT EXISTS jobs_by_post ON jobs(post_id DESC)');
  const columns = new Set((db.prepare('PRAGMA table_info(jobs)').all() as any[]).map(row => row.name));
  for (const [name, type] of [['outcome','TEXT'],['completed_at','INTEGER']] as const) if (!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  const attemptColumns = new Set((db.prepare('PRAGMA table_info(job_attempts)').all() as any[]).map(row=>row.name));
  for(const name of ['system_text','user_text','provider','model','model_response','memory_before','memory_after','memory_evaluation']) if(!attemptColumns.has(name)) db.exec(`ALTER TABLE job_attempts ADD COLUMN ${name} TEXT`);
  for(const [name,type] of [['mock_miss','INTEGER NOT NULL DEFAULT 0'],['memory_before','TEXT'],['memory_after','TEXT']] as const) if(!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  if(!columns.has('source')) db.exec("ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'notification'");
  if(!columns.has('discovered_at')) db.exec('ALTER TABLE jobs ADD COLUMN discovered_at INTEGER');
  if(!columns.has('mentioned_handle')) db.exec('ALTER TABLE jobs ADD COLUMN mentioned_handle TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS one_feed_job_per_post_agent ON jobs(post_id,agent_id) WHERE kind='post' AND source='feed';
  CREATE TABLE IF NOT EXISTS agent_feed_checks (agent_id TEXT PRIMARY KEY REFERENCES agents(id), interval_ms INTEGER NOT NULL, next_check_at INTEGER NOT NULL);`);
  connection = db;
  return db;
}
function transaction<T>(fn: () => T): T { getDb().exec('BEGIN IMMEDIATE'); try { const result = fn(); getDb().exec('COMMIT'); return result; } catch (e) { getDb().exec('ROLLBACK'); throw e; } }
export function syncAgents(directory = resolve(repoRoot, process.env.AGENTS_DIR || 'agents')) {
  const profiles=readdirSync(directory).flatMap(id=>{const file=join(directory,id,'profile.json');return existsSync(file)?[{id,profile:JSON.parse(readFileSync(file,'utf8')) as Omit<AgentProfile,'id'>}]:[];});
  const reservedIntervals=new Set(profiles.map(({profile})=>profile.feedCheckIntervalMinutes).filter((minutes):minutes is number=>minutes!==undefined));
  for (const {id,profile} of profiles) {
    if (!/^[a-z0-9_-]+$/.test(id) || !profile.name || !profile.handle || !profile.persona) throw new Error(`Invalid agent profile: ${id}`);
    getDb().prepare(`INSERT INTO agents(id,name,handle,persona,avatar_color,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,handle=excluded.handle,persona=excluded.persona,avatar_color=excluded.avatar_color,enabled=excluded.enabled`).run(id, profile.name, profile.handle, profile.persona, profile.avatarColor || '#777', profile.enabled === false ? 0 : 1);
    const seed = join(directory, id, 'memory.md');
    getDb().prepare('INSERT OR IGNORE INTO memories(agent_id,content) VALUES(?,?)').run(id, existsSync(seed) ? readFileSync(seed, 'utf8').trim() : '');
    const configuredInterval = (profile as AgentProfile).feedCheckIntervalMinutes;
    if (configuredInterval !== undefined && (!Number.isInteger(configuredInterval) || configuredInterval < 1 || configuredInterval > 1440)) throw new Error(`Invalid feed check interval: ${id}`);
    const current = getDb().prepare('SELECT interval_ms AS intervalMs FROM agent_feed_checks WHERE agent_id=?').get(id) as { intervalMs: number } | undefined;
    const usedIntervals = !current && configuredInterval === undefined ? (getDb().prepare('SELECT interval_ms AS intervalMs FROM agent_feed_checks').all() as {intervalMs:number}[]).map(row=>row.intervalMs) : [];
    let defaultMinutes=5;while(usedIntervals.includes(defaultMinutes*60_000)||reservedIntervals.has(defaultMinutes)) defaultMinutes++;
    const intervalMs = (configuredInterval ?? (current?.intervalMs ? current.intervalMs/60_000 : defaultMinutes)) * 60_000;
    if (!current) getDb().prepare('INSERT INTO agent_feed_checks(agent_id,interval_ms,next_check_at) VALUES(?,?,?)').run(id,intervalMs,Date.now()+intervalMs);
    else if (current.intervalMs !== intervalMs) getDb().prepare('UPDATE agent_feed_checks SET interval_ms=?,next_check_at=? WHERE agent_id=?').run(intervalMs,Date.now()+intervalMs,id);
  }
}
export function scheduleFeedChecks(now = Date.now()): number { return transaction(() => {
  const due=getDb().prepare(`SELECT f.agent_id AS agentId,f.interval_ms AS intervalMs,f.next_check_at AS nextCheckAt FROM agent_feed_checks f JOIN agents a ON a.id=f.agent_id WHERE a.enabled=1 AND f.next_check_at<=? ORDER BY f.next_check_at,f.agent_id`).all(now) as {agentId:string;intervalMs:number;nextCheckAt:number}[];
  let scheduled=0;
  for(const check of due){
    const post=getDb().prepare(`SELECT p.id FROM posts p JOIN jobs n ON n.post_id=p.id AND n.agent_id=? AND n.kind='post' AND n.source='notification' WHERE (n.status='not_selected' OR (n.status='done' AND n.outcome='missed')) AND NOT EXISTS(SELECT 1 FROM jobs f WHERE f.post_id=p.id AND f.agent_id=? AND f.kind='post' AND f.source='feed') ORDER BY p.id DESC LIMIT 1`).get(check.agentId,check.agentId) as {id:number}|undefined;
    if(post){const memory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(check.agentId) as {content:string}|undefined)?.content||'';
      getDb().prepare(`INSERT INTO jobs(kind,post_id,agent_id,due_at,status,outcome,mock_miss,memory_before,memory_after,source,discovered_at) VALUES('post',?,?,?,'pending',NULL,0,?,?,'feed',?)`).run(post.id,check.agentId,now,memory,memory,now);scheduled++;
    }
    const periods=Math.floor((now-check.nextCheckAt)/check.intervalMs)+1;
    getDb().prepare('UPDATE agent_feed_checks SET next_check_at=? WHERE agent_id=?').run(check.nextCheckAt+periods*check.intervalMs,check.agentId);
  }
  return scheduled;
}); }
export function getAgents(): AgentProfile[] { return (getDb().prepare('SELECT id,name,handle,persona,avatar_color AS avatarColor,enabled FROM agents WHERE enabled=1 ORDER BY name').all() as any[]).map(a => ({ ...a, enabled: Boolean(a.enabled) })); }
function hydratePost(post:any) {
  return { ...post,
    images: getImagesForPost(post.id).map(({id,mimeType,byteSize,description})=>({id,mimeType,byteSize,description})),
    likes: getDb().prepare('SELECT agent_id AS agentId FROM likes WHERE post_id=?').all(post.id),
    comments: getDb().prepare(`SELECT c.id,c.post_id AS postId,c.parent_id AS parentId,c.author_type AS authorType,c.agent_id AS agentId,c.text,c.created_at AS createdAt,a.name,a.handle,a.avatar_color AS avatarColor FROM comments c LEFT JOIN agents a ON a.id=c.agent_id WHERE c.post_id=? ORDER BY c.id`).all(post.id).map((c:any) => ({...c, images:getImagesForComment(c.id).map(({id,mimeType,byteSize,description})=>({id,mimeType,byteSize,description}))}))
  };
}
export function getFeed() {
  const posts = getDb().prepare('SELECT id,text,created_at AS createdAt FROM posts ORDER BY id DESC LIMIT 100').all() as any[];
  return posts.map(hydratePost);
}
export function getPost(id:number) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const post = getDb().prepare('SELECT id,text,created_at AS createdAt FROM posts WHERE id=?').get(id);
  return post ? hydratePost(post) : null;
}
function mentionedAgents(text:string, agents:AgentProfile[]) {
  const byHandle=new Map(agents.map(agent=>[agent.handle.toLowerCase(),agent]));
  const matches=new Map<string,{agent:AgentProfile;handle:string}>();
  for(const match of text.matchAll(/(^|[^a-z0-9_-])@([a-z0-9_-]+)/gi)) {
    const agent=byHandle.get(match[2].toLowerCase());
    if(agent) matches.set(agent.id,{agent,handle:match[2]});
  }
  return matches;
}
export function createPost(text: string, imageIds: string[] = []) { return transaction(() => {
  const id = Number(getDb().prepare('INSERT INTO posts(text) VALUES(?)').run(text).lastInsertRowid);
  attachImages(imageIds, id, null);
  const agents = getAgents();
  const selected=pickAgents(agents);const selectedIds=new Set(selected.map(a=>a.id));const mentions=mentionedAgents(text,agents);
  for(const agent of agents){const memory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(agent.id) as any)?.content||'';const mention=mentions.get(agent.id);const notified=selectedIds.has(agent.id);getDb().prepare('INSERT INTO jobs(kind,post_id,agent_id,due_at,status,outcome,mock_miss,memory_before,memory_after,source,mentioned_handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('post',id,agent.id,mention?Date.now():notified?Date.now()+delayMs('post'):Date.now(),mention||notified?'pending':'not_selected',mention||notified?null:'not_selected',mention?0:notified&&agent.id===selected[0]?.id?1:0,memory,memory,mention?'mention':'notification',mention?.handle??null);}
  return { id, text };
}); }
export function createOwnerReply(parentId: number, text: string, imageIds: string[] = []) { return transaction(() => {
  const parent = getDb().prepare('SELECT id,post_id AS postId,agent_id AS agentId,author_type AS authorType FROM comments WHERE id=?').get(parentId) as any;
  if (!parent || parent.authorType !== 'agent') return null;
  const id = Number(getDb().prepare(`INSERT INTO comments(post_id,parent_id,author_type,text) VALUES(?,?,'owner',?)`).run(parent.postId,parentId,text).lastInsertRowid);
  attachImages(imageIds, parent.postId, id);
  const mentions=mentionedAgents(text,getAgents());
  const targets=new Set([parent.agentId,...mentions.keys()]);
  for(const agentId of targets){const memory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(agentId) as any)?.content||'';const mention=mentions.get(agentId);
    getDb().prepare('INSERT INTO jobs(kind,post_id,source_comment_id,agent_id,due_at,mock_miss,memory_before,memory_after,source,mentioned_handle) VALUES(?,?,?,?,?,?,?,?,?,?)').run('reply',parent.postId,id,agentId,mention?Date.now():Date.now()+delayMs('reply'),mention?0:id%2===0?1:0,memory,memory,mention?'mention':'notification',mention?.handle??null);
  }
  return { id, postId: parent.postId, parentId, text };
}); }
export type Job = { id: number; kind: 'post'|'reply'; source: 'notification'|'feed'|'mention'; postId: number; sourceCommentId: number|null; agentId: string; attempts: number; mockMiss: boolean; mentionedHandle:string|null };
export function claimJob(): Job | null { return transaction(() => {
  const job = getDb().prepare(`SELECT id,kind,source,post_id AS postId,source_comment_id AS sourceCommentId,agent_id AS agentId,attempts,mock_miss AS mockMiss,mentioned_handle AS mentionedHandle FROM jobs WHERE status='pending' AND due_at<=? ORDER BY due_at,id LIMIT 1`).get(Date.now()) as Job | undefined;
  if (!job) return null;
  getDb().prepare(`UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=?`).run(job.id);
  getDb().prepare(`INSERT INTO job_attempts(job_id,started_at,status) VALUES(?,?,'running')`).run(job.id,Date.now());
  return job;
}); }
export function getContext(job: Job) {
  const agent = getDb().prepare('SELECT id,name,persona FROM agents WHERE id=?').get(job.agentId) as any;
  const memory = getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any;
  const post = getDb().prepare('SELECT text FROM posts WHERE id=?').get(job.postId) as any;
  const comments = getDb().prepare('SELECT author_type AS authorType,agent_id AS agentId,text,id,parent_id AS parentId FROM comments WHERE post_id=? ORDER BY id').all(job.postId);
  const reply=job.sourceCommentId ? getDb().prepare(`SELECT c.text,p.agent_id AS parentAgentId,a.name AS parentAgentName FROM comments c LEFT JOIN comments p ON p.id=c.parent_id LEFT JOIN agents a ON a.id=p.agent_id WHERE c.id=?`).get(job.sourceCommentId) as {text:string;parentAgentId:string|null;parentAgentName:string|null}|undefined : undefined;
  return { agent, memory: memory?.content || '', post: post?.text || '', comments, sourceCommentId: job.sourceCommentId, mentionedHandle:job.mentionedHandle, mentionText:job.kind==='post'?post?.text||'':reply?.text||'',replyToAgentName:reply?.parentAgentName||null,replyToOwnComment:reply?.parentAgentId===job.agentId, images: [...getImagesForPost(job.postId), ...(job.sourceCommentId ? getImagesForComment(job.sourceCommentId) : [])] };
}
export function completeJob(job: Job, decision: Decision | null, forcedOutcome?: 'missed') { transaction(() => {
  const current = getDb().prepare('SELECT status FROM jobs WHERE id=?').get(job.id) as any;
  if (current?.status !== 'running') return;
  const oldMemory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any)?.content||'';
  if (decision) {
    if (job.kind === 'post' && decision.like) getDb().prepare('INSERT OR IGNORE INTO likes(post_id,agent_id) VALUES(?,?)').run(job.postId,job.agentId);
    if (decision.comment?.trim()) getDb().prepare(`INSERT INTO comments(post_id,parent_id,author_type,agent_id,text) VALUES(?,?,'agent',?,?)`).run(job.postId,job.kind === 'reply' ? job.sourceCommentId : null,job.agentId,decision.comment.trim().slice(0,280));
    if (decision.memory?.trim()) { const old = (getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any)?.content || ''; getDb().prepare('UPDATE memories SET content=? WHERE agent_id=?').run((old+'\n'+decision.memory.trim()).trim().slice(-2000),job.agentId); }
  }
  const outcome = forcedOutcome || (!decision || (!decision.like && !decision.comment?.trim()) ? 'ignored' : decision.like && decision.comment?.trim() ? 'liked_and_commented' : decision.like ? 'liked' : 'commented');
  const afterMemory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any)?.content||'';
  getDb().prepare(`UPDATE jobs SET status='done',outcome=?,completed_at=?,memory_before=?,memory_after=?,error=NULL WHERE id=?`).run(outcome,Date.now(),oldMemory,afterMemory,job.id);
  getDb().prepare(`UPDATE job_attempts SET status=?,finished_at=?,model_response=?,memory_before=?,memory_after=?,memory_evaluation=? WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?)`).run(outcome,Date.now(),decision?JSON.stringify(decision):null,oldMemory,afterMemory,decision?.memoryEvaluation||null,job.id);
}); }
export function failJob(job: Job, error: unknown) { const attempts = job.attempts + 1; const failed = job.source !== 'mention' && attempts >= 3; transaction(() => { getDb().prepare('UPDATE jobs SET status=?,outcome=?,completed_at=?,attempts=?,due_at=?,error=? WHERE id=?').run(failed ? 'failed' : 'pending',failed ? 'failed' : null,failed ? Date.now() : null,attempts,Date.now()+Math.min(job.source==='mention'?300000:60000,1000*2**Math.min(attempts,20)),String(error).slice(0,500),job.id); getDb().prepare(`UPDATE job_attempts SET status='failed',finished_at=?,error=? WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?)`).run(Date.now(),String(error).slice(0,500),job.id); }); }

export type StoredImage = { id: string; mimeType: string; byteSize: number; path: string; description: string|null };
function imageRow(row:any): StoredImage { return { id:row.id, mimeType:row.mime_type, byteSize:row.byte_size, path:join(uploadsDir,row.file_name), description:row.description??null }; }
export function getImage(id:string): StoredImage | null { const row=getDb().prepare('SELECT * FROM images WHERE id=? AND (post_id IS NOT NULL OR comment_id IS NOT NULL)').get(id); return row ? imageRow(row) : null; }
export function getImageAccessibility(id:string) { const row=getDb().prepare('SELECT description,comment_id AS commentId FROM images WHERE id=? AND (post_id IS NOT NULL OR comment_id IS NOT NULL)').get(id) as {description:string|null;commentId:number|null}|undefined;return {id,description:row?.description??null,context:row?.commentId?'reply':'post'}; }
function getImagesForPost(id:number): StoredImage[] { return (getDb().prepare('SELECT * FROM images WHERE post_id=? AND comment_id IS NULL ORDER BY rowid').all(id) as any[]).map(imageRow); }
function getImagesForComment(id:number): StoredImage[] { return (getDb().prepare('SELECT * FROM images WHERE comment_id=? ORDER BY rowid').all(id) as any[]).map(imageRow); }
function attachImages(ids:string[], postId:number, commentId:number|null) { for (const id of ids) { const result=getDb().prepare('UPDATE images SET post_id=?,comment_id=? WHERE id=? AND post_id IS NULL AND comment_id IS NULL').run(postId,commentId,id); if(result.changes!==1) throw new Error('Invalid image attachment'); } }
export function storeImage(bytes:Buffer,mimeType:string,description:string|null=null): StoredImage { mkdirSync(uploadsDir,{recursive:true}); const id=randomUUID();const ext=mimeType==='image/png'?'png':mimeType==='image/webp'?'webp':'jpg';const fileName=`${id}.${ext}`;const filePath=join(uploadsDir,fileName);writeFileSync(filePath,bytes);try { getDb().prepare('INSERT INTO images(id,mime_type,byte_size,file_name,description) VALUES(?,?,?,?,?)').run(id,mimeType,bytes.length,fileName,description); } catch(error) { unlinkSync(filePath);throw error; }return {id,mimeType,byteSize:bytes.length,path:filePath,description}; }
export function deleteUnattachedImages(ids:string[]) { for(const id of ids){const row=getDb().prepare('SELECT * FROM images WHERE id=? AND post_id IS NULL AND comment_id IS NULL').get(id) as any;if(row){getDb().prepare('DELETE FROM images WHERE id=?').run(id);try{unlinkSync(join(uploadsDir,row.file_name));}catch{}}} }
export function recordPayload(job:Job,payload:{system:string;user:string;imageIds:string[];provider:string;model:string;memoryBefore:string}) { getDb().prepare(`UPDATE job_attempts SET system_text=?,user_text=?,image_ids=?,provider=?,model=?,memory_before=? WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?)`).run(payload.system,payload.user,JSON.stringify(payload.imageIds),payload.provider,payload.model,payload.memoryBefore,job.id); }
export function getActivity(limit=50,offset=0) { return getDb().prepare(`SELECT j.id,j.kind,j.source,j.discovered_at AS discoveredAt,j.post_id AS postId,p.text AS postText,pi.id AS postImageId,pi.description AS postImageDescription,j.source_comment_id AS sourceCommentId,j.mentioned_handle AS mentionedHandle,(SELECT a2.name FROM comments c2 JOIN comments parent ON parent.id=c2.parent_id JOIN agents a2 ON a2.id=parent.agent_id WHERE c2.id=j.source_comment_id) AS replyToAgentName,j.agent_id AS agentId,a.name AS agentName,j.due_at AS dueAt,j.status,j.outcome,j.error,j.completed_at AS completedAt,j.attempts,j.mock_miss AS mockMiss,j.memory_before AS memoryBefore,j.memory_after AS memoryAfter,t.image_ids AS imageIds FROM jobs j JOIN agents a ON a.id=j.agent_id LEFT JOIN posts p ON p.id=j.post_id LEFT JOIN images pi ON pi.id=(SELECT i.id FROM images i WHERE i.post_id=j.post_id AND i.comment_id IS NULL ORDER BY i.rowid LIMIT 1) LEFT JOIN job_attempts t ON t.id=(SELECT MAX(id) FROM job_attempts WHERE job_id=j.id) ORDER BY j.id DESC LIMIT ? OFFSET ?`).all(Math.min(100,Math.max(1,limit)),Math.max(0,offset)); }
export function getActivityPage(beforePostId: number | null = null, pageSize = 5) {
  if (beforePostId !== null && (!Number.isSafeInteger(beforePostId) || beforePostId <= 0)) throw new Error('Invalid activity cursor');
  const size = Math.min(20, Math.max(1, Math.trunc(pageSize)));
  const groups = (beforePostId === null
    ? getDb().prepare('SELECT DISTINCT post_id AS postId FROM jobs ORDER BY post_id DESC LIMIT ?').all(size+1)
    : getDb().prepare('SELECT DISTINCT post_id AS postId FROM jobs WHERE post_id < ? ORDER BY post_id DESC LIMIT ?').all(beforePostId,size+1)) as {postId:number}[];
  const selected = groups.slice(0,size).map(group=>group.postId);
  if (selected.length === 0) return {items:[],nextCursor:null};
  const placeholders = selected.map(()=>'?').join(',');
  const items = getDb().prepare(`SELECT j.id,j.kind,j.source,j.discovered_at AS discoveredAt,j.post_id AS postId,p.text AS postText,pi.id AS postImageId,pi.description AS postImageDescription,j.source_comment_id AS sourceCommentId,j.mentioned_handle AS mentionedHandle,(SELECT a2.name FROM comments c2 JOIN comments parent ON parent.id=c2.parent_id JOIN agents a2 ON a2.id=parent.agent_id WHERE c2.id=j.source_comment_id) AS replyToAgentName,j.agent_id AS agentId,a.name AS agentName,j.due_at AS dueAt,j.status,j.outcome,j.error,j.completed_at AS completedAt,j.attempts,j.mock_miss AS mockMiss,j.memory_before AS memoryBefore,j.memory_after AS memoryAfter,t.image_ids AS imageIds FROM jobs j JOIN agents a ON a.id=j.agent_id LEFT JOIN posts p ON p.id=j.post_id LEFT JOIN images pi ON pi.id=(SELECT i.id FROM images i WHERE i.post_id=j.post_id AND i.comment_id IS NULL ORDER BY i.rowid LIMIT 1) LEFT JOIN job_attempts t ON t.id=(SELECT MAX(id) FROM job_attempts WHERE job_id=j.id) WHERE j.post_id IN (${placeholders}) ORDER BY j.post_id DESC,j.id DESC`).all(...selected);
  return {items,nextCursor:groups.length>size?selected[selected.length-1]:null};
}
export function getActivityAttempts(jobId:number) { return getDb().prepare('SELECT id,started_at AS startedAt,finished_at AS finishedAt,status,error,system_text AS systemText,user_text AS userText,prompt_text AS legacyPromptText,provider,model,model_response AS modelResponse,memory_before AS memoryBefore,memory_after AS memoryAfter,memory_evaluation AS memoryEvaluation,image_ids AS imageIds FROM job_attempts WHERE job_id=? ORDER BY id').all(jobId); }
export function recoverJobs() { transaction(() => { const running=getDb().prepare("SELECT id FROM jobs WHERE status='running'").all() as {id:number}[];for(const job of running){getDb().prepare("UPDATE job_attempts SET status='interrupted',finished_at=?,error='Worker restarted' WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?) AND status='running'").run(Date.now(),job.id);getDb().prepare("UPDATE jobs SET status='pending',due_at=? WHERE id=?").run(Date.now(),job.id);} }); }
