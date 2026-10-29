import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { delayMs, isReliableDelivery, pickAgents, stripLinks, type AgentProfile, type Decision } from '@social/core';
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
  const agentColumns=new Set((db.prepare('PRAGMA table_info(agents)').all() as {name:string}[]).map(row=>row.name));
  for(const [name,type] of [['city','TEXT'],['time_zone','TEXT'],['latitude','REAL'],['longitude','REAL']] as const) if(!agentColumns.has(name)) db.exec(`ALTER TABLE agents ADD COLUMN ${name} ${type}`);
  for (const [name, type] of [['outcome','TEXT'],['completed_at','INTEGER']] as const) if (!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  const attemptColumns = new Set((db.prepare('PRAGMA table_info(job_attempts)').all() as any[]).map(row=>row.name));
  for(const name of ['system_text','user_text','provider','model','model_response','memory_before','memory_after','memory_evaluation','background_json']) if(!attemptColumns.has(name)) db.exec(`ALTER TABLE job_attempts ADD COLUMN ${name} TEXT`);
  for(const [name,type] of [['mock_miss','INTEGER NOT NULL DEFAULT 0'],['memory_before','TEXT'],['memory_after','TEXT']] as const) if(!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  if(!columns.has('source')) db.exec("ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'notification'");
  if(!columns.has('discovered_at')) db.exec('ALTER TABLE jobs ADD COLUMN discovered_at INTEGER');
  if(!columns.has('mentioned_handle')) db.exec('ALTER TABLE jobs ADD COLUMN mentioned_handle TEXT');
  for(const [name,type] of [['browse_id','INTEGER'],['browse_reason','TEXT'],['browse_seen_comment_id','INTEGER'],['follow_state','INTEGER'],['visited_at','INTEGER']] as const) if(!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  for(const [name,type] of [['delivered_at','INTEGER'],['overload_count','INTEGER'],['overload_chance','REAL']] as const) if(!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS one_feed_job_per_post_agent ON jobs(post_id,agent_id) WHERE kind='post' AND source='feed';
  CREATE TABLE IF NOT EXISTS agent_feed_checks (agent_id TEXT PRIMARY KEY REFERENCES agents(id), interval_ms INTEGER NOT NULL, next_check_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS browse_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,agent_id TEXT NOT NULL REFERENCES agents(id),scheduled_at INTEGER NOT NULL,started_at INTEGER NOT NULL,completed_at INTEGER,visit_count INTEGER NOT NULL DEFAULT 0,UNIQUE(agent_id,scheduled_at));
  CREATE TABLE IF NOT EXISTS agent_thread_state (agent_id TEXT NOT NULL REFERENCES agents(id),post_id INTEGER NOT NULL REFERENCES posts(id),last_seen_comment_id INTEGER NOT NULL DEFAULT 0,last_seen_at INTEGER NOT NULL,following INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(agent_id,post_id));
  CREATE UNIQUE INDEX IF NOT EXISTS one_browse_visit_per_run_post ON jobs(browse_id,post_id,agent_id) WHERE source='browse';
  CREATE UNIQUE INDEX IF NOT EXISTS one_peer_notification_per_comment_agent ON jobs(source_comment_id,agent_id) WHERE source='peer';`);
  db.prepare(`INSERT OR IGNORE INTO agent_thread_state(agent_id,post_id,last_seen_comment_id,last_seen_at,following)
    SELECT c.agent_id,c.post_id,(SELECT COALESCE(MAX(id),0) FROM comments WHERE post_id=c.post_id),?,1
    FROM comments c WHERE c.author_type='agent' AND c.agent_id IS NOT NULL GROUP BY c.agent_id,c.post_id`).run(Date.now());
  connection = db;
  return db;
}
function transaction<T>(fn: () => T): T { getDb().exec('BEGIN IMMEDIATE'); try { const result = fn(); getDb().exec('COMMIT'); return result; } catch (e) { getDb().exec('ROLLBACK'); throw e; } }
export function syncAgents(directory = resolve(repoRoot, process.env.AGENTS_DIR || 'agents')) {
  const profiles=readdirSync(directory).flatMap(id=>{const file=join(directory,id,'profile.json');return existsSync(file)?[{id,profile:JSON.parse(readFileSync(file,'utf8')) as Omit<AgentProfile,'id'>}]:[];});
  const reservedIntervals=new Set(profiles.map(({profile})=>profile.feedCheckIntervalMinutes).filter((minutes):minutes is number=>minutes!==undefined));
  for (const {id,profile} of profiles) {
    if (!/^[a-z0-9_-]+$/.test(id) || !profile.name || !profile.handle || !profile.persona) throw new Error(`Invalid agent profile: ${id}`);
    if(profile.timeZone){try{new Intl.DateTimeFormat('en',{timeZone:profile.timeZone});}catch{throw new Error(`Invalid agent time zone: ${id}`);}}
    if((profile.latitude===undefined)!==(profile.longitude===undefined)||profile.latitude!==undefined&&(!Number.isFinite(profile.latitude)||Math.abs(profile.latitude)>90||!Number.isFinite(profile.longitude)||Math.abs(profile.longitude!)>180))throw new Error(`Invalid agent coordinates: ${id}`);
    getDb().prepare(`INSERT INTO agents(id,name,handle,persona,avatar_color,enabled,city,time_zone,latitude,longitude) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,handle=excluded.handle,persona=excluded.persona,avatar_color=excluded.avatar_color,enabled=excluded.enabled,city=excluded.city,time_zone=excluded.time_zone,latitude=excluded.latitude,longitude=excluded.longitude`).run(id, profile.name, profile.handle, profile.persona, profile.avatarColor || '#777', profile.enabled === false ? 0 : 1,profile.city||null,profile.timeZone||'UTC',profile.latitude??null,profile.longitude??null);
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
type BrowseCandidate={id:number;latestCommentId:number;latestExternalCommentId:number;joinedCount:number;notificationStatus:string|null;notificationOutcome:string|null;priorFeedCount:number;outstandingCount:number;lastSeenCommentId:number|null;following:number|null};
function browseCandidates(agentId:string) {
  const rows=getDb().prepare(`SELECT p.id,
    (SELECT COALESCE(MAX(c.id),0) FROM comments c WHERE c.post_id=p.id) AS latestCommentId,
    (SELECT COALESCE(MAX(c.id),0) FROM comments c WHERE c.post_id=p.id AND NOT(c.author_type='agent' AND c.agent_id=?)) AS latestExternalCommentId,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.author_type='agent' AND c.agent_id=?) AS joinedCount,
    (SELECT n.status FROM jobs n WHERE n.post_id=p.id AND n.agent_id=? AND n.kind='post' AND n.source='notification' ORDER BY n.id LIMIT 1) AS notificationStatus,
    (SELECT n.outcome FROM jobs n WHERE n.post_id=p.id AND n.agent_id=? AND n.kind='post' AND n.source='notification' ORDER BY n.id LIMIT 1) AS notificationOutcome,
    (SELECT COUNT(*) FROM jobs f WHERE f.post_id=p.id AND f.agent_id=? AND f.source='feed') AS priorFeedCount,
    (SELECT COUNT(*) FROM jobs j WHERE j.post_id=p.id AND j.agent_id=? AND j.status IN ('pending','running')) AS outstandingCount,
    s.last_seen_comment_id AS lastSeenCommentId,s.following
    FROM (SELECT id FROM posts ORDER BY id DESC LIMIT 20) p
    LEFT JOIN agent_thread_state s ON s.agent_id=? AND s.post_id=p.id ORDER BY p.id DESC`).all(agentId,agentId,agentId,agentId,agentId,agentId,agentId) as BrowseCandidate[];
  const joined:{post:BrowseCandidate;reason:'new_reply';target:number}[]=[];
  const missed:{post:BrowseCandidate;reason:'missed_post';target:null}[]=[];
  for(const post of rows){
    if(post.outstandingCount || post.following===0) continue;
    const follows=post.following===1 || (post.following===null && post.joinedCount>0);
    if(follows && post.latestExternalCommentId>(post.lastSeenCommentId??0)) joined.push({post,reason:'new_reply',target:post.latestExternalCommentId});
    else if(post.lastSeenCommentId===null && !post.priorFeedCount && (post.notificationStatus==='not_selected' || post.notificationOutcome==='missed')) missed.push({post,reason:'missed_post',target:null});
  }
  const picked=[...joined.slice(0,2),...missed.slice(0,1)];
  for(const candidate of [...joined.slice(2),...missed.slice(1)]) if(picked.length<3) picked.push(candidate);
  return picked;
}
export function scheduleFeedChecks(now = Date.now()): number { return transaction(() => {
  const due=getDb().prepare(`SELECT f.agent_id AS agentId,f.interval_ms AS intervalMs,f.next_check_at AS nextCheckAt FROM agent_feed_checks f JOIN agents a ON a.id=f.agent_id WHERE a.enabled=1 AND f.next_check_at<=? ORDER BY f.next_check_at,f.agent_id`).all(now) as {agentId:string;intervalMs:number;nextCheckAt:number}[];
  let scheduled=0;
  for(const check of due){
    const candidates=browseCandidates(check.agentId);
    const run=getDb().prepare('INSERT OR IGNORE INTO browse_runs(agent_id,scheduled_at,started_at,completed_at,visit_count) VALUES(?,?,?,?,?)').run(check.agentId,check.nextCheckAt,now,candidates.length?null:now,candidates.length);
    if(run.changes){
      const browseId=Number(run.lastInsertRowid);
      const memory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(check.agentId) as {content:string}|undefined)?.content||'';
      for(const candidate of candidates){getDb().prepare(`INSERT INTO jobs(kind,post_id,source_comment_id,agent_id,due_at,status,mock_miss,memory_before,memory_after,source,discovered_at,browse_id,browse_reason,browse_seen_comment_id) VALUES('post',?,?,?,?,'pending',0,?,?,'browse',?,?,?,?)`).run(candidate.post.id,candidate.target,check.agentId,now,memory,memory,now,browseId,candidate.reason,candidate.post.latestCommentId);scheduled++;}
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
function reactivateThread(agentId:string,postId:number) {
  getDb().prepare(`INSERT INTO agent_thread_state(agent_id,post_id,last_seen_comment_id,last_seen_at,following) VALUES(?,?,0,?,1)
    ON CONFLICT(agent_id,post_id) DO UPDATE SET following=1`).run(agentId,postId,Date.now());
}
export function createPost(text: string, imageIds: string[] = []) { return transaction(() => {
  const id = Number(getDb().prepare('INSERT INTO posts(text) VALUES(?)').run(text).lastInsertRowid);
  attachImages(imageIds, id, null);
  const agents = getAgents();
  const selected=pickAgents(agents);const selectedIds=new Set(selected.map(a=>a.id));const mentions=mentionedAgents(text,agents);
  for(const agent of agents){const memory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(agent.id) as any)?.content||'';const mention=mentions.get(agent.id);const notified=selectedIds.has(agent.id);getDb().prepare('INSERT INTO jobs(kind,post_id,agent_id,due_at,status,outcome,mock_miss,memory_before,memory_after,source,mentioned_handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('post',id,agent.id,mention?Date.now():notified?Date.now()+delayMs('post'):Date.now(),mention||notified?'pending':'not_selected',mention||notified?null:'not_selected',mention?0:notified&&agent.id===selected[0]?.id?1:0,memory,memory,mention?'mention':'notification',mention?.handle??null);}
  for(const agentId of mentions.keys()) reactivateThread(agentId,id);
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
    getDb().prepare('INSERT INTO jobs(kind,post_id,source_comment_id,agent_id,due_at,mock_miss,memory_before,memory_after,source,mentioned_handle) VALUES(?,?,?,?,?,?,?,?,?,?)').run('reply',parent.postId,id,agentId,mention?Date.now():Date.now()+delayMs('reply'),0,memory,memory,mention?'mention':'notification',mention?.handle??null);
  }
  for(const agentId of mentions.keys()) reactivateThread(agentId,parent.postId);
  return { id, postId: parent.postId, parentId, text };
}); }
export type Job = { id: number; kind: 'post'|'reply'; source: 'notification'|'feed'|'mention'|'browse'|'peer'; postId: number; sourceCommentId: number|null; agentId: string; attempts: number; mockMiss: boolean; mentionedHandle:string|null; browseId:number|null; browseReason:string|null; seenCommentId:number };
export function claimJob(): Job | null { return transaction(() => {
  const job = getDb().prepare(`SELECT j.id,j.kind,j.source,j.post_id AS postId,j.source_comment_id AS sourceCommentId,j.agent_id AS agentId,j.attempts,j.mock_miss AS mockMiss,j.mentioned_handle AS mentionedHandle,j.browse_id AS browseId,j.browse_reason AS browseReason,(SELECT COALESCE(MAX(c.id),0) FROM comments c WHERE c.post_id=j.post_id) AS seenCommentId FROM jobs j WHERE j.status='pending' AND j.due_at<=? ORDER BY j.due_at,j.id LIMIT 1`).get(Date.now()) as unknown as Job | undefined;
  if (!job) return null;
  getDb().prepare("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=?").run(job.id);
  getDb().prepare(`INSERT INTO job_attempts(job_id,started_at,status) VALUES(?,?,'running')`).run(job.id,Date.now());
  return job;
}); }
export function getContext(job: Job) {
  const agent = getDb().prepare('SELECT id,name,persona,city,time_zone AS timeZone,latitude,longitude FROM agents WHERE id=?').get(job.agentId) as any;
  const memory = getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any;
  const post = getDb().prepare('SELECT text FROM posts WHERE id=?').get(job.postId) as any;
  const commentRows = getDb().prepare('SELECT author_type AS authorType,agent_id AS agentId,text,id,parent_id AS parentId FROM comments WHERE post_id=? ORDER BY id').all(job.postId) as {id:number}[];
  const fullThread=job.source==='browse'||job.source==='peer';
  const commentImages=fullThread?commentRows.flatMap(comment=>getImagesForComment(comment.id).map(image=>({commentId:comment.id,image}))):[];
  const comments=fullThread?commentRows.map(comment=>({...comment,images:commentImages.filter(entry=>entry.commentId===comment.id).map(({image})=>({id:image.id,description:image.description}))})):commentRows;
  const reply=job.sourceCommentId ? getDb().prepare(`SELECT c.text,c.agent_id AS sourceAgentId,source.name AS sourceAgentName,p.agent_id AS parentAgentId,a.name AS parentAgentName FROM comments c LEFT JOIN agents source ON source.id=c.agent_id LEFT JOIN comments p ON p.id=c.parent_id LEFT JOIN agents a ON a.id=p.agent_id WHERE c.id=?`).get(job.sourceCommentId) as {text:string;sourceAgentId:string|null;sourceAgentName:string|null;parentAgentId:string|null;parentAgentName:string|null}|undefined : undefined;
  const context={ agent, memory: memory?.content || '', post: post?.text || '', comments, source:job.source, sourceCommentId: job.sourceCommentId, sourceAgentName:reply?.sourceAgentName||null,mentionedHandle:job.mentionedHandle, mentionText:job.kind==='post'?post?.text||'':reply?.text||'',replyToAgentName:reply?.parentAgentName||null,replyToOwnComment:reply?.parentAgentId===job.agentId,browseReason:job.browseReason, images: [...getImagesForPost(job.postId), ...(fullThread?commentImages.map(entry=>entry.image):job.sourceCommentId ? getImagesForComment(job.sourceCommentId) : [])] };
  // A claimed job may fail before reading the thread; record the read only after context loads.
  if(job.source==='browse') getDb().prepare("UPDATE jobs SET visited_at=COALESCE(visited_at,?) WHERE id=? AND status='running'").run(Date.now(),job.id);
  return context;
}
export function markDelivered(job:Job,now=Date.now()) { getDb().prepare('UPDATE jobs SET delivered_at=COALESCE(delivered_at,?) WHERE id=?').run(now,job.id); }
export function isStoppedPeer(job:Job) { return job.source==='peer' && (getDb().prepare('SELECT following FROM agent_thread_state WHERE agent_id=? AND post_id=?').get(job.agentId,job.postId) as {following:number}|undefined)?.following===0; }
export function completeJob(job: Job, decision: Decision | null, forcedOutcome?: 'missed'|'stopped', random=Math.random) { return transaction(() => {
  const current = getDb().prepare('SELECT status FROM jobs WHERE id=?').get(job.id) as any;
  if (current?.status !== 'running') return null;
  const oldMemory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any)?.content||'';
  const modelDecision=decision;
  let overloadCount:number|null=null,overloadChance:number|null=null,overloadSuppressed=false;
  if(job.source==='peer' && decision?.comment && stripLinks(decision.comment) && !forcedOutcome){
    overloadCount=(getDb().prepare(`SELECT COUNT(*) AS count FROM jobs WHERE agent_id=? AND id<>? AND source IN ('notification','peer') AND delivered_at>? AND delivered_at<=? AND outcome IS NOT 'missed' AND status<>'not_selected'`).get(job.agentId,job.id,Date.now()-3600000,Date.now()) as {count:number}).count;
    overloadChance=Math.min(.75,.1*Math.max(0,overloadCount-2));
    if(random()<overloadChance) {overloadSuppressed=true;decision={...decision,comment:null,memory:null};}
  }
  let liked=false,commentId=0;
  if (decision && !forcedOutcome) {
    if (job.kind === 'post' && decision.like) liked=getDb().prepare('INSERT OR IGNORE INTO likes(post_id,agent_id) VALUES(?,?)').run(job.postId,job.agentId).changes>0;
    const safeComment=decision.comment?stripLinks(decision.comment).slice(0,280):'';
    if (safeComment) commentId=Number(getDb().prepare(`INSERT INTO comments(post_id,parent_id,author_type,agent_id,text) VALUES(?,?,'agent',?,?)`).run(job.postId,job.kind === 'reply'||job.source==='browse' ? job.sourceCommentId : null,job.agentId,safeComment).lastInsertRowid);
    if (decision.memory?.trim()) { const old = (getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any)?.content || ''; getDb().prepare('UPDATE memories SET content=? WHERE agent_id=?').run((old+'\n'+decision.memory.trim()).trim().slice(-2000),job.agentId); }
  }
  const commented = commentId>0;
  const outcome = forcedOutcome || (overloadSuppressed ? 'overload_suppressed' : liked && commented ? 'liked_and_commented' : liked ? 'liked' : commented ? 'commented' : 'ignored');
  const afterMemory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(job.agentId) as any)?.content||'';
  getDb().prepare(`UPDATE jobs SET status='done',outcome=?,completed_at=?,memory_before=?,memory_after=?,overload_count=?,overload_chance=?,error=NULL WHERE id=?`).run(outcome,Date.now(),oldMemory,afterMemory,overloadCount,overloadChance,job.id);
  if(decision&&!forcedOutcome){
    const prior=getDb().prepare('SELECT following FROM agent_thread_state WHERE agent_id=? AND post_id=?').get(job.agentId,job.postId) as {following:number}|undefined;
    const following=decision.follow===true?1:decision.follow===false?0:commented?1:prior?.following??0;
    getDb().prepare(`INSERT INTO agent_thread_state(agent_id,post_id,last_seen_comment_id,last_seen_at,following) VALUES(?,?,?,?,?)
      ON CONFLICT(agent_id,post_id) DO UPDATE SET last_seen_comment_id=MAX(last_seen_comment_id,excluded.last_seen_comment_id),last_seen_at=excluded.last_seen_at,following=excluded.following`).run(job.agentId,job.postId,Math.max(job.seenCommentId,commentId),Date.now(),following);
    if(job.source==='browse') getDb().prepare('UPDATE jobs SET follow_state=? WHERE id=?').run(following,job.id);
  }
  getDb().prepare(`UPDATE job_attempts SET status=?,finished_at=?,model_response=?,memory_before=?,memory_after=?,memory_evaluation=? WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?)`).run(outcome,Date.now(),modelDecision?JSON.stringify(modelDecision):null,oldMemory,afterMemory,modelDecision?.memoryEvaluation||null,job.id);
  if(commentId && job.source!=='peer') fanOutPeerComment(commentId,job.postId,job.agentId);
  if(job.browseId) finishBrowseIfDone(job.browseId);
  return outcome;
}); }
function fanOutPeerComment(commentId:number,postId:number,authorId:string) {
  for(const agent of getAgents().filter(agent=>agent.id!==authorId)) {
    const memory=(getDb().prepare('SELECT content FROM memories WHERE agent_id=?').get(agent.id) as {content:string}|undefined)?.content||'';
    getDb().prepare(`INSERT OR IGNORE INTO jobs(kind,post_id,source_comment_id,agent_id,due_at,mock_miss,memory_before,memory_after,source) VALUES('reply',?,?,?,?,?,?,?,'peer')`).run(postId,commentId,agent.id,Date.now()+delayMs('reply'),Math.random()<.25?1:0,memory,memory);
  }
}
function finishBrowseIfDone(browseId:number) {
  const remaining=getDb().prepare("SELECT 1 FROM jobs WHERE browse_id=? AND status IN ('pending','running') LIMIT 1").get(browseId);
  if(!remaining) getDb().prepare('UPDATE browse_runs SET completed_at=COALESCE(completed_at,?) WHERE id=?').run(Date.now(),browseId);
}
export function failJob(job: Job, error: unknown) { const attempts = job.attempts + 1; const reliable=isReliableDelivery(job);const failed = !reliable && attempts >= 3; transaction(() => { getDb().prepare('UPDATE jobs SET status=?,outcome=?,completed_at=?,attempts=?,due_at=?,error=? WHERE id=?').run(failed ? 'failed' : 'pending',failed ? 'failed' : null,failed ? Date.now() : null,attempts,Date.now()+Math.min(reliable?300000:60000,1000*2**Math.min(attempts,20)),String(error).slice(0,500),job.id); getDb().prepare(`UPDATE job_attempts SET status='failed',finished_at=?,error=? WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?)`).run(Date.now(),String(error).slice(0,500),job.id); if(failed&&job.browseId) finishBrowseIfDone(job.browseId); }); }

export type StoredImage = { id: string; mimeType: string; byteSize: number; path: string; description: string|null };
function imageRow(row:any): StoredImage { return { id:row.id, mimeType:row.mime_type, byteSize:row.byte_size, path:join(uploadsDir,row.file_name), description:row.description??null }; }
export function getImage(id:string): StoredImage | null { const row=getDb().prepare('SELECT * FROM images WHERE id=? AND (post_id IS NOT NULL OR comment_id IS NOT NULL)').get(id); return row ? imageRow(row) : null; }
export function getImageAccessibility(id:string) { const row=getDb().prepare('SELECT description,comment_id AS commentId FROM images WHERE id=? AND (post_id IS NOT NULL OR comment_id IS NOT NULL)').get(id) as {description:string|null;commentId:number|null}|undefined;return {id,description:row?.description??null,context:row?.commentId?'reply':'post'}; }
function getImagesForPost(id:number): StoredImage[] { return (getDb().prepare('SELECT * FROM images WHERE post_id=? AND comment_id IS NULL ORDER BY rowid').all(id) as any[]).map(imageRow); }
function getImagesForComment(id:number): StoredImage[] { return (getDb().prepare('SELECT * FROM images WHERE comment_id=? ORDER BY rowid').all(id) as any[]).map(imageRow); }
function attachImages(ids:string[], postId:number, commentId:number|null) { for (const id of ids) { const result=getDb().prepare('UPDATE images SET post_id=?,comment_id=? WHERE id=? AND post_id IS NULL AND comment_id IS NULL').run(postId,commentId,id); if(result.changes!==1) throw new Error('Invalid image attachment'); } }
export function storeImage(bytes:Buffer,mimeType:string,description:string|null=null): StoredImage { mkdirSync(uploadsDir,{recursive:true}); const id=randomUUID();const ext=mimeType==='image/png'?'png':mimeType==='image/webp'?'webp':'jpg';const fileName=`${id}.${ext}`;const filePath=join(uploadsDir,fileName);writeFileSync(filePath,bytes);try { getDb().prepare('INSERT INTO images(id,mime_type,byte_size,file_name,description) VALUES(?,?,?,?,?)').run(id,mimeType,bytes.length,fileName,description); } catch(error) { unlinkSync(filePath);throw error; }return {id,mimeType,byteSize:bytes.length,path:filePath,description}; }
export function deleteUnattachedImages(ids:string[]) { for(const id of ids){const row=getDb().prepare('SELECT * FROM images WHERE id=? AND post_id IS NULL AND comment_id IS NULL').get(id) as any;if(row){getDb().prepare('DELETE FROM images WHERE id=?').run(id);try{unlinkSync(join(uploadsDir,row.file_name));}catch{}}} }
export function recordPayload(job:Job,payload:{system:string;user:string;imageIds:string[];provider:string;model:string;memoryBefore:string;background?:unknown}) { getDb().prepare(`UPDATE job_attempts SET system_text=?,user_text=?,image_ids=?,provider=?,model=?,memory_before=?,background_json=? WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?)`).run(payload.system,payload.user,JSON.stringify(payload.imageIds),payload.provider,payload.model,payload.memoryBefore,payload.background===undefined?null:JSON.stringify(payload.background),job.id); }
export function getActivity(limit=50,offset=0) { return getDb().prepare(`SELECT j.id,j.kind,j.source,j.discovered_at AS discoveredAt,j.visited_at AS visitedAt,j.browse_reason AS browseReason,j.follow_state AS followState,j.post_id AS postId,p.text AS postText,pi.id AS postImageId,pi.description AS postImageDescription,j.source_comment_id AS sourceCommentId,source_agent.name AS sourceAgentName,j.delivered_at AS deliveredAt,j.overload_count AS overloadCount,j.overload_chance AS overloadChance,j.mentioned_handle AS mentionedHandle,(SELECT a2.name FROM comments c2 JOIN comments parent ON parent.id=c2.parent_id JOIN agents a2 ON a2.id=parent.agent_id WHERE c2.id=j.source_comment_id) AS replyToAgentName,j.agent_id AS agentId,a.name AS agentName,j.due_at AS dueAt,j.status,j.outcome,j.error,j.completed_at AS completedAt,j.attempts,j.mock_miss AS mockMiss,j.memory_before AS memoryBefore,j.memory_after AS memoryAfter,t.image_ids AS imageIds FROM jobs j JOIN agents a ON a.id=j.agent_id LEFT JOIN comments source_comment ON source_comment.id=j.source_comment_id LEFT JOIN agents source_agent ON source_agent.id=source_comment.agent_id LEFT JOIN posts p ON p.id=j.post_id LEFT JOIN images pi ON pi.id=(SELECT i.id FROM images i WHERE i.post_id=j.post_id AND i.comment_id IS NULL ORDER BY i.rowid LIMIT 1) LEFT JOIN job_attempts t ON t.id=(SELECT MAX(id) FROM job_attempts WHERE job_id=j.id) ORDER BY j.id DESC LIMIT ? OFFSET ?`).all(Math.min(100,Math.max(1,limit)),Math.max(0,offset)); }
export function getActivityPage(beforePostId: number | null = null, pageSize = 5) {
  if (beforePostId !== null && (!Number.isSafeInteger(beforePostId) || beforePostId <= 0)) throw new Error('Invalid activity cursor');
  const size = Math.min(20, Math.max(1, Math.trunc(pageSize)));
  const groups = (beforePostId === null
    ? getDb().prepare('SELECT DISTINCT post_id AS postId FROM jobs ORDER BY post_id DESC LIMIT ?').all(size+1)
    : getDb().prepare('SELECT DISTINCT post_id AS postId FROM jobs WHERE post_id < ? ORDER BY post_id DESC LIMIT ?').all(beforePostId,size+1)) as {postId:number}[];
  const selected = groups.slice(0,size).map(group=>group.postId);
  if (selected.length === 0) return {items:[],nextCursor:null};
  const placeholders = selected.map(()=>'?').join(',');
  const items = getDb().prepare(`SELECT j.id,j.kind,j.source,j.discovered_at AS discoveredAt,j.visited_at AS visitedAt,j.browse_reason AS browseReason,j.follow_state AS followState,j.post_id AS postId,p.text AS postText,pi.id AS postImageId,pi.description AS postImageDescription,j.source_comment_id AS sourceCommentId,source_agent.name AS sourceAgentName,j.delivered_at AS deliveredAt,j.overload_count AS overloadCount,j.overload_chance AS overloadChance,j.mentioned_handle AS mentionedHandle,(SELECT a2.name FROM comments c2 JOIN comments parent ON parent.id=c2.parent_id JOIN agents a2 ON a2.id=parent.agent_id WHERE c2.id=j.source_comment_id) AS replyToAgentName,j.agent_id AS agentId,a.name AS agentName,j.due_at AS dueAt,j.status,j.outcome,j.error,j.completed_at AS completedAt,j.attempts,j.mock_miss AS mockMiss,j.memory_before AS memoryBefore,j.memory_after AS memoryAfter,t.image_ids AS imageIds FROM jobs j JOIN agents a ON a.id=j.agent_id LEFT JOIN comments source_comment ON source_comment.id=j.source_comment_id LEFT JOIN agents source_agent ON source_agent.id=source_comment.agent_id LEFT JOIN posts p ON p.id=j.post_id LEFT JOIN images pi ON pi.id=(SELECT i.id FROM images i WHERE i.post_id=j.post_id AND i.comment_id IS NULL ORDER BY i.rowid LIMIT 1) LEFT JOIN job_attempts t ON t.id=(SELECT MAX(id) FROM job_attempts WHERE job_id=j.id) WHERE j.post_id IN (${placeholders}) ORDER BY j.post_id DESC,j.id DESC`).all(...selected);
  return {items,nextCursor:groups.length>size?selected[selected.length-1]:null};
}
export function getActivityAttempts(jobId:number) { return getDb().prepare('SELECT id,started_at AS startedAt,finished_at AS finishedAt,status,error,system_text AS systemText,user_text AS userText,prompt_text AS legacyPromptText,provider,model,model_response AS modelResponse,memory_before AS memoryBefore,memory_after AS memoryAfter,memory_evaluation AS memoryEvaluation,image_ids AS imageIds,background_json AS backgroundJson FROM job_attempts WHERE job_id=? ORDER BY id').all(jobId); }
export function getBrowseSchedule() { return getDb().prepare(`SELECT a.id AS agentId,a.name AS agentName,a.avatar_color AS avatarColor,f.next_check_at AS nextBrowseAt FROM agent_feed_checks f JOIN agents a ON a.id=f.agent_id WHERE a.enabled=1 ORDER BY f.next_check_at,a.name`).all(); }
export function getRecentBrowseResults(limit=5) {
  const runs=getDb().prepare(`SELECT b.id,b.agent_id AS agentId,a.name AS agentName,b.started_at AS startedAt,b.completed_at AS completedAt FROM browse_runs b JOIN agents a ON a.id=b.agent_id ORDER BY b.started_at DESC,b.id DESC LIMIT ?`).all(Math.min(20,Math.max(1,limit))) as {id:number;agentId:string;agentName:string;startedAt:number;completedAt:number|null}[];
  if(!runs.length) return [];
  const jobs=getDb().prepare(`SELECT j.browse_id AS browseId,j.post_id AS postId,j.status,j.visited_at AS visitedAt,p.text AS postText,
    (SELECT i.id FROM images i WHERE i.post_id=j.post_id AND i.comment_id IS NULL ORDER BY i.rowid LIMIT 1) AS postImageId
    FROM jobs j LEFT JOIN posts p ON p.id=j.post_id WHERE j.browse_id IN (${runs.map(()=>'?').join(',')}) ORDER BY j.id`).all(...runs.map(run=>run.id)) as {browseId:number;postId:number;status:string;visitedAt:number|null;postText:string|null;postImageId:string|null}[];
  return runs.map(run=>{
    const entries=jobs.filter(job=>job.browseId===run.id);
    return {...run,queuedCount:entries.length,pendingCount:entries.filter(job=>job.status==='pending').length,runningCount:entries.filter(job=>job.status==='running').length,
      completedCount:entries.filter(job=>job.status==='done').length,failedBeforeReadCount:entries.filter(job=>job.status==='failed'&&job.visitedAt===null).length,
      failedAfterReadCount:entries.filter(job=>job.status==='failed'&&job.visitedAt!==null).length,
      visits:entries.filter(job=>job.status==='done'&&job.visitedAt!==null&&job.postText!==null).map(job=>({postId:job.postId,postText:job.postText!,postImageId:job.postImageId,visitedAt:job.visitedAt!}))};
  });
}
export function recoverJobs() { transaction(() => { const running=getDb().prepare("SELECT id FROM jobs WHERE status='running'").all() as {id:number}[];for(const job of running){getDb().prepare("UPDATE job_attempts SET status='interrupted',finished_at=?,error='Worker restarted' WHERE id=(SELECT MAX(id) FROM job_attempts WHERE job_id=?) AND status='running'").run(Date.now(),job.id);getDb().prepare("UPDATE jobs SET status='pending',due_at=? WHERE id=?").run(Date.now(),job.id);} }); }
