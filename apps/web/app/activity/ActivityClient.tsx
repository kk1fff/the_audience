'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { organizePostActivity } from '../../lib/activity';

type Attempt = {id:number;status:string;error:string|null;systemText:string|null;userText:string|null;legacyPromptText:string|null;provider:string|null;model:string|null;modelResponse:string|null;memoryBefore:string|null;memoryAfter:string|null;memoryEvaluation:string|null;imageIds:string[];images:{id:string;description:string|null;context:'post'|'reply'}[];startedAt:number;finishedAt:number|null};
type Item = {id:number;kind:'post'|'reply';source:'notification'|'feed'|'mention'|'browse'|'peer';mentionedHandle:string|null;replyToAgentName:string|null;sourceAgentName:string|null;deliveredAt:number|null;overloadCount:number|null;overloadChance:number|null;discoveredAt:number|null;visitedAt:number|null;browseReason:string|null;followState:number|null;postId:number;postText:string|null;postImageId:string|null;postImageDescription:string|null;sourceCommentId:number|null;agentName:string;agentId:string;status:string;outcome:string|null;dueAt:number;completedAt:number|null;error:string|null;memoryBefore:string|null;memoryAfter:string|null;attemptHistory:Attempt[]};
type BrowseScheduleItem={agentId:string;agentName:string;avatarColor:string;nextBrowseAt:number};
type EmptyBrowse={id:number;agentId:string;agentName:string;completedAt:number};
type ActivityPage = {items:Item[];nextCursor:number|null;cursors:(number|null)[];browseSchedule:BrowseScheduleItem[];recentEmptyBrowses:EmptyBrowse[]};
type PageRequest = {cursor:number|null;direction:'initial'|'next'|'previous';id:number};

function conversationHref(postId:number,cursors:(number|null)[],commentId?:number|null) {
  const history=cursors.slice(1).join(',');
  return `/posts/${postId}${history?`?activityCursors=${encodeURIComponent(history)}`:''}${commentId?`#comment-${commentId}`:''}`;
}

function label(value: string) { const text = value.replaceAll('_', ' '); return text.charAt(0).toUpperCase() + text.slice(1); }
function otherCounts(counts: Map<string, number>) {
  const order = ['not selected', 'missed', 'ignored', 'overload suppressed', 'stopped', 'pending', 'failed', 'running'];
  return [...counts].sort(([a],[b]) => (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) - (order.indexOf(b) < 0 ? order.length : order.indexOf(b))).map(([name,count]) => `${count} ${name}`).join(' · ');
}

function PostPreview({postId,postText,postImageId,postImageDescription,href}:{postId:number;postText:string|null;postImageId:string|null;postImageDescription:string|null;href:string|null}) {
  const [imageUnavailable,setImageUnavailable] = useState(false);
  const excerpt = postText?.replace(/\s+/g,' ').trim() || '';
  const unavailable = postText === null;
  const imageOnly = !unavailable && !excerpt && !!postImageId;
  return <div className="postPreview">
    <div className="postPreviewCopy"><h2>Post #{postId}</h2>{href?<Link className="postPreviewLink" href={href}><span className="postPreviewText">{excerpt || (imageOnly?'Photo post':'Post preview unavailable')}</span><span className="postPreviewCue">View post and replies</span></Link>:<><p className="postPreviewText unavailable">Post unavailable</p><p className="postPreviewMeta">Activity records are still available below.</p></>}</div>
    {!unavailable&&postImageId&&(imageUnavailable?<div className="postThumbFallback" role="img" aria-label={`Image from post #${postId} unavailable`}>Image unavailable</div>:<img className="postThumb" src={`/api/images/${postImageId}`} alt={postImageDescription||'Image attached to post'} onError={()=>setImageUnavailable(true)}/>)}
  </div>;
}

function countdown(target:number,now:number) {
  const seconds=Math.max(0,Math.ceil((target-now)/1000));
  return seconds===0?'Due now':`in ${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s`;
}
function BrowseSchedule({items,now}:{items:BrowseScheduleItem[];now:number}) {
  const row=(item:BrowseScheduleItem)=><div className="browseScheduleRow" key={item.agentId}><strong>{item.agentName}</strong><span className="browseWhen"><strong>{countdown(item.nextBrowseAt,now)}</strong><small>at {new Date(item.nextBrowseAt).toLocaleString()}</small></span></div>;
  return <section className="browseSchedule"><h2>Upcoming browses</h2><p>Next general browse for each enabled friend · times shown locally</p>{items.length===0?<p>No browse schedules yet.</p>:<><div className="browseScheduleFull">{items.map(row)}</div><div className="browseScheduleCompact">{items.slice(0,2).map(row)}{items.length>2&&<details><summary><span className="browseShow">Show all {items.length} agents ▾</span><span className="browseHide">Hide agents ▴</span></summary><div>{items.slice(2).map(row)}</div></details>}</div></>}</section>;
}
function RecentEmptyBrowses({items}:{items:EmptyBrowse[]}) {
  if(!items.length) return null;
  return <section className="recentBrowses"><h2>Recent browses</h2><div className="recentBrowseList">{items.map(item=><article key={item.id} className="recentBrowse"><div><strong>{item.agentName}</strong><span className="browseVisitLabel">General browse</span></div><p>No new content</p><small>Checked at {new Date(item.completedAt).toLocaleString()} · no threads to visit</small><small>Next browse remains scheduled above.</small></article>)}</div></section>;
}

function Entry({item,conversation}:{item:Item;conversation:string|null}) {
  const feedCheck = item.source === 'feed';
  const mention = item.source === 'mention';
  const browseVisit=item.source==='browse';
  const peer=item.source==='peer';
  const source = peer ? 'Peer notification' : mention ? 'Mention' : browseVisit ? 'Browse visit' : feedCheck ? 'Feed check' : item.kind === 'reply' ? 'Reply notification' : 'Post notification';
  const mentionState = item.status === 'done' && item.outcome === 'ignored' ? 'Ignored' : item.status === 'done' ? 'Responded' : item.error ? 'Retrying' : 'Pending';
  const outcome = peer ? item.outcome==='overload_suppressed'?'Overload suppressed':item.outcome==='stopped'?'Ignored · stopped following':item.outcome==='ignored'?'Ignored · not interested':item.outcome==='commented'?'Responded · commented':item.outcome==='missed'?'Missed':label(item.outcome||item.status) : browseVisit&&item.browseReason==='new_reply'&&item.followState===0&&item.outcome==='ignored'?'Stopped following':browseVisit&&item.browseReason==='new_reply'&&item.outcome==='commented'?'Commented on a new reply':label(item.outcome || item.status);
  const timing = peer
    ? `From ${item.sourceAgentName||'a peer'}'s reply · comment #${item.sourceCommentId}${item.deliveredAt?` · Delivered at ${new Date(item.deliveredAt).toLocaleString()}`:''}`
    : mention
    ? `${item.kind==='post'?'Mentioned in your post':`In your reply to ${item.replyToAgentName||'a friend'}`} · @${item.mentionedHandle||item.agentId}`
    : browseVisit
      ? `${item.visitedAt?`Visited at ${new Date(item.visitedAt).toLocaleString()}`:`Visit queued at ${new Date(item.dueAt).toLocaleString()}`} · ${item.browseReason==='new_reply'?'Joined thread with a new reply':'Previously missed post'}`
    : feedCheck
    ? `Found post at ${new Date(item.discoveredAt ?? item.dueAt).toLocaleString()}`
    : item.status === 'not_selected'
      ? 'No notification sent · post remains eligible for a feed check'
      : `${item.kind === 'reply' ? `Owner reply #${item.sourceCommentId} · ` : ''}Notification at ${new Date(item.dueAt).toLocaleString()}`;
  return <article className={`activityItem${mention?' mentionItem':browseVisit?' browseVisit':''}`}>
    <div className="activityTop"><strong>{item.agentName}</strong><span className={peer?'peerLabel':mention?'mentionLabel':browseVisit?'browseVisitLabel':feedCheck ? 'feedCheckLabel' : 'notificationLabel'}>{source}</span></div>
    <p className="activityOutcome" aria-live={mention?'polite':undefined}>{mention?<><span className={`mentionState mention${mentionState}`}>{mentionState}</span>{mentionState==='Responded'&&<> · {outcome}</>}</>:outcome}</p>
    <p className="activityTiming">{timing}</p>
    {peer&&item.outcome==='overload_suppressed'&&item.overloadCount!==null&&<p className="activityTiming">{item.overloadCount} prior notifications · {Math.round((item.overloadChance||0)*100)}% suppression chance</p>}
    {peer&&item.outcome==='stopped'&&<p className="activityTiming">{item.agentName} remains stopped · an owner @mention can bring them back</p>}
    {browseVisit&&<p className={`browseFollow${item.followState===1?' isFollowing':''}`}>{item.followState===1?'Following':item.followState===0?item.browseReason==='new_reply'&&item.outcome==='ignored'?`Ignored · a new @mention can bring ${item.agentName} back`:'Stopped following':'Follow decision pending'}</p>}
    {mention&&mentionState==='Pending'&&<p className="activityTiming">Queued at {new Date(item.dueAt).toLocaleString()} · waiting for decision</p>}
    {mention&&mentionState==='Retrying'&&<p className="activityTiming">{item.error} · {item.status==='pending'?`next retry ${new Date(item.dueAt).toLocaleString()}`:'retry in progress'}</p>}
    {mention&&mentionState==='Ignored'&&<p className="activityTiming">Delivered · chose not to respond</p>}
    {conversation&&<Link className="conversationLink" href={conversation}>{peer?`Open ${item.sourceAgentName||'peer'}'s reply`:mention&&item.kind==='reply'?'Open your reply':'Open conversation'} →</Link>}
    {item.error && !mention && <p className="error">{item.error}</p>}
    {item.attemptHistory.length === 0 && !mention && !browseVisit && !peer && <p className="noAttempt">No model request or memory evaluation.</p>}
    {item.attemptHistory.filter(attempt=>!peer||attempt.systemText||attempt.error).map((attempt, index) => <details className="activityDetails" key={attempt.id}>
      <summary>{item.attemptHistory.length === 1 && attempt.systemText ? 'View model request and memory' : `Attempt ${index + 1}: ${label(attempt.status)}`}</summary>
      {attempt.error && <p className="error">{attempt.error}</p>}
      {attempt.systemText ? <><p><strong>Provider:</strong> {attempt.provider} · <strong>Model:</strong> {attempt.model}</p><h3>System message</h3><pre>{attempt.systemText}</pre><h3>User message</h3><pre>{attempt.userText}</pre>{attempt.imageIds.length > 0 && <p>Images: {attempt.images.map(image => <a key={image.id} href={`/api/images/${image.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${image.description||`Image attached to ${image.context}`}`}>{image.id}</a>)}</p>}<h3>Model result</h3><pre>{attempt.modelResponse || 'No model result'}</pre><h3>Memory evaluation</h3><p>{attempt.memoryEvaluation || 'No evaluation returned.'}</p><div className="memoryComparison"><div><strong>Before</strong><pre>{attempt.memoryBefore || '(empty)'}</pre></div><div><strong>After</strong><pre>{attempt.memoryAfter || attempt.memoryBefore || '(empty)'}</pre></div></div></> : <><p>{attempt.legacyPromptText ? 'Legacy model prompt (memory evaluation was not recorded):' : 'No model request or memory evaluation.'}</p>{attempt.legacyPromptText && <><pre>{attempt.legacyPromptText}</pre><div className="memoryComparison"><div><strong>Before</strong><pre>{item.memoryBefore || '(empty)'}</pre></div><div><strong>After</strong><pre>{item.memoryAfter || '(empty)'}</pre></div></div></>}</>}
    </details>)}
  </article>;
}

export default function Activity({initialCursorIds}:{initialCursorIds:number[]}) {
  const [now,setNow]=useState(()=>Date.now());
  const [initialCursors] = useState<(number|null)[]>(()=>[null,...initialCursorIds]);
  const [page,setPage] = useState<ActivityPage|null>(null);
  const [request,setRequest] = useState<PageRequest|null>(()=>({cursor:initialCursors[initialCursors.length-1],direction:'initial',id:0}));
  const [error,setError] = useState(false);
  const requestId = useRef(0);
  const items = page?.items || [];
  const cursors = page?.cursors || [null];
  const nextCursor = page?.nextCursor ?? null;
  const cursor = cursors[cursors.length-1];
  const loading = request !== null && !error;
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(() => {
    if (!request) return;
    const pending = request;
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/activity${pending.cursor === null ? '' : `?beforePostId=${pending.cursor}`}`, {cache:'no-store',signal:controller.signal});
        if (!response.ok) throw new Error('Activity request failed');
        const result = await response.json() as Pick<ActivityPage,'items'|'nextCursor'|'browseSchedule'|'recentEmptyBrowses'>;
        if (!active || requestId.current !== pending.id) return;
        setPage(current=>({items:result.items,nextCursor:result.nextCursor,browseSchedule:result.browseSchedule,recentEmptyBrowses:result.recentEmptyBrowses,cursors:pending.direction==='next'?[...(current?.cursors||initialCursors),pending.cursor]:pending.direction==='previous'?(current?.cursors||initialCursors).slice(0,-1):current?.cursors||initialCursors}));
        setError(false);
        setRequest(current=>current?.id===pending.id?null:current);
      } catch {
        if (active && requestId.current === pending.id) setError(true);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [request]);
  useEffect(() => {
    if (!page || request) return;
    let active = true, latest = 0;
    const epoch = requestId.current;
    async function poll() {
      const sequence = ++latest;
      try {
        const response = await fetch(`/api/activity${cursor === null ? '' : `?beforePostId=${cursor}`}`, {cache:'no-store'});
        if (!response.ok) return;
        const result = await response.json() as Pick<ActivityPage,'items'|'nextCursor'|'browseSchedule'|'recentEmptyBrowses'>;
        if (active && epoch === requestId.current && sequence === latest) setPage(current=>current?{...current,items:result.items,nextCursor:result.nextCursor,browseSchedule:result.browseSchedule,recentEmptyBrowses:result.recentEmptyBrowses}:current);
      } catch { /* Leave the last complete page visible until the next poll. */ }
    }
    const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [cursor,request,page===null]);
  useEffect(()=>{
    if (!page) return;
    const url=new URL(window.location.href);
    const history=page.cursors.slice(1).join(',');
    if (history) url.searchParams.set('cursors',history); else url.searchParams.delete('cursors');
    window.history.replaceState(window.history.state,'',url);
  },[page?.cursors]);
  function navigate(direction:'previous'|'next') {
    if (!page || loading) return;
    const destination = direction === 'previous' ? cursors[cursors.length-2] : nextCursor;
    if (destination === undefined || (direction === 'next' && destination === null)) return;
    setRequest({cursor:destination,direction,id:++requestId.current});
    setError(false);
    window.scrollTo({top:0,behavior:'auto'});
  }
  function retry() {
    if (!request) return;
    setRequest({...request,id:++requestId.current});
    setError(false);
  }
  const groups = [...new Set(items.map(item => item.postId))];
  const errorTitle = !page ? 'Couldn’t load activity' : request?.direction === 'next' ? 'Couldn’t load older posts' : request?.direction === 'previous' ? 'Couldn’t load newer posts' : 'Couldn’t load activity';
  return <div className="activityPage"><div className="activityHeader"><Link href="/">← The Audience</Link><h1>Agent activity</h1><p>How friends found posts and reacted.</p></div>{error&&<div className="activityLoadError" role="alert"><div><strong>{errorTitle}</strong><p>{page?'This page is still here. Try again when you’re ready.':'Check your connection and try again.'}</p>{!page&&<small>Your posts are still available from Home.</small>}</div><button onClick={retry}>Retry</button></div>}{loading&&!page&&<p>Loading activity…</p>}{page&&<BrowseSchedule items={page.browseSchedule} now={now}/>} {page&&items.length === 0 && page.recentEmptyBrowses.length===0 && <p>No activity yet.</p>}{page&&groups.map(postId => {
    const postItems = items.filter(item => item.postId === postId);
    const {reactions,mentions,visits,other,counts} = organizePostActivity(postItems);
    const available=postItems[0].postText!==null;
    return <section key={postId}><PostPreview postId={postId} postText={postItems[0].postText} postImageId={postItems[0].postImageId} postImageDescription={postItems[0].postImageDescription} href={available?conversationHref(postId,cursors):null}/>{reactions.map(item => <Entry key={item.id} item={item} conversation={available?conversationHref(postId,cursors,item.kind==='reply'?item.sourceCommentId:null):null}/>)}{mentions.map(item => <Entry key={item.id} item={item} conversation={available?conversationHref(postId,cursors,item.kind==='reply'?item.sourceCommentId:null):null}/>)}{visits.map(item => <Entry key={item.id} item={item} conversation={available?conversationHref(postId,cursors):null}/>)}{other.length > 0 && <details className="otherActivity"><summary><strong>Other activity</strong><span className="otherCounts">{otherCounts(counts)}</span><span className="showEntries">Show {other.length} {other.length === 1 ? 'entry' : 'entries'} ▾</span><span className="hideEntries">Hide {other.length} {other.length === 1 ? 'entry' : 'entries'} ▴</span></summary><div className="otherEntries">{other.map(item => <Entry key={item.id} item={item} conversation={available?conversationHref(postId,cursors,item.kind==='reply'?item.sourceCommentId:null):null}/>)}</div></details>}</section>;
  })}{page&&<RecentEmptyBrowses items={page.recentEmptyBrowses}/>} {page&&<nav className="activityPagination" aria-label="Activity pages"><p>{cursors.length === 1 ? 'Showing newest posts' : 'Showing older posts'}</p><div className="pages"><button disabled={loading || cursors.length === 1} onClick={() => navigate('previous')}>← Previous</button><button disabled={loading || nextCursor === null} onClick={() => navigate('next')}>Next →</button></div><p className="paginationHint">{cursors.length === 1 ? 'Next shows older posts.' : 'Previous returns to newer posts. Next shows older posts.'}</p></nav>}</div>;
}
