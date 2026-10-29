'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { organizePostActivity } from '../../lib/activity';

type Attempt = {id:number;status:string;error:string|null;systemText:string|null;userText:string|null;legacyPromptText:string|null;provider:string|null;model:string|null;modelResponse:string|null;memoryBefore:string|null;memoryAfter:string|null;memoryEvaluation:string|null;imageIds:string[];images:{id:string;description:string|null;context:'post'|'reply'}[];startedAt:number;finishedAt:number|null};
type Item = {id:number;kind:'post'|'reply';source:'notification'|'feed';discoveredAt:number|null;postId:number;postText:string|null;postImageId:string|null;postImageDescription:string|null;sourceCommentId:number|null;agentName:string;agentId:string;status:string;outcome:string|null;dueAt:number;completedAt:number|null;error:string|null;memoryBefore:string|null;memoryAfter:string|null;attemptHistory:Attempt[]};
type ActivityPage = {items:Item[];nextCursor:number|null;cursors:(number|null)[]};
type PageRequest = {cursor:number|null;direction:'initial'|'next'|'previous';id:number};

function label(value: string) { const text = value.replaceAll('_', ' '); return text.charAt(0).toUpperCase() + text.slice(1); }
function otherCounts(counts: Map<string, number>) {
  const order = ['not selected', 'missed', 'pending', 'ignored', 'failed', 'running'];
  return [...counts].sort(([a],[b]) => (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) - (order.indexOf(b) < 0 ? order.length : order.indexOf(b))).map(([name,count]) => `${count} ${name}`).join(' · ');
}

function PostPreview({postId,postText,postImageId,postImageDescription}:{postId:number;postText:string|null;postImageId:string|null;postImageDescription:string|null}) {
  const [imageUnavailable,setImageUnavailable] = useState(false);
  const excerpt = postText?.replace(/\s+/g,' ').trim() || '';
  const unavailable = postText === null;
  const imageOnly = !unavailable && !excerpt && !!postImageId;
  return <div className="postPreview">
    <div className="postPreviewCopy"><h2>Post #{postId}</h2><p className={`postPreviewText${unavailable?' unavailable':''}`}>{unavailable?'Post unavailable':excerpt || (imageOnly?'Photo post':'Post preview unavailable')}</p>{unavailable&&<p className="postPreviewMeta">Activity records are still available below.</p>}</div>
    {!unavailable&&postImageId&&(imageUnavailable?<div className="postThumbFallback" role="img" aria-label={`Image from post #${postId} unavailable`}>Image unavailable</div>:<img className="postThumb" src={`/api/images/${postImageId}`} alt={postImageDescription||'Image attached to post'} onError={()=>setImageUnavailable(true)}/>)}
  </div>;
}

function Entry({item}:{item:Item}) {
  const feedCheck = item.source === 'feed';
  const source = feedCheck ? 'Feed check' : item.kind === 'reply' ? 'Reply notification' : 'Post notification';
  const outcome = label(item.outcome || item.status);
  const timing = feedCheck
    ? `Found post at ${new Date(item.discoveredAt ?? item.dueAt).toLocaleString()}`
    : item.status === 'not_selected'
      ? 'No notification sent · post remains eligible for a feed check'
      : `${item.kind === 'reply' ? `Owner reply #${item.sourceCommentId} · ` : ''}Notification at ${new Date(item.dueAt).toLocaleString()}`;
  return <article className="activityItem">
    <div className="activityTop"><strong>{item.agentName}</strong><span className={feedCheck ? 'feedCheckLabel' : 'notificationLabel'}>{source}</span></div>
    <p className="activityOutcome">{outcome}</p>
    <p className="activityTiming">{timing}</p>
    {item.error && <p className="error">{item.error}</p>}
    {item.attemptHistory.length === 0 && <p className="noAttempt">No model request or memory evaluation.</p>}
    {item.attemptHistory.map((attempt, index) => <details className="activityDetails" key={attempt.id}>
      <summary>{item.attemptHistory.length === 1 && attempt.systemText ? 'View model request and memory' : `Attempt ${index + 1}: ${label(attempt.status)}`}</summary>
      {attempt.error && <p className="error">{attempt.error}</p>}
      {attempt.systemText ? <><p><strong>Provider:</strong> {attempt.provider} · <strong>Model:</strong> {attempt.model}</p><h3>System message</h3><pre>{attempt.systemText}</pre><h3>User message</h3><pre>{attempt.userText}</pre>{attempt.imageIds.length > 0 && <p>Images: {attempt.images.map(image => <a key={image.id} href={`/api/images/${image.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${image.description||`Image attached to ${image.context}`}`}>{image.id}</a>)}</p>}<h3>Model result</h3><pre>{attempt.modelResponse || 'No model result'}</pre><h3>Memory evaluation</h3><p>{attempt.memoryEvaluation || 'No evaluation returned.'}</p><div className="memoryComparison"><div><strong>Before</strong><pre>{attempt.memoryBefore || '(empty)'}</pre></div><div><strong>After</strong><pre>{attempt.memoryAfter || attempt.memoryBefore || '(empty)'}</pre></div></div></> : <><p>{attempt.legacyPromptText ? 'Legacy model prompt (memory evaluation was not recorded):' : 'No model request or memory evaluation.'}</p>{attempt.legacyPromptText && <><pre>{attempt.legacyPromptText}</pre><div className="memoryComparison"><div><strong>Before</strong><pre>{item.memoryBefore || '(empty)'}</pre></div><div><strong>After</strong><pre>{item.memoryAfter || '(empty)'}</pre></div></div></>}</>}
    </details>)}
  </article>;
}

export default function Activity() {
  const [page,setPage] = useState<ActivityPage|null>(null);
  const [request,setRequest] = useState<PageRequest|null>({cursor:null,direction:'initial',id:0});
  const [error,setError] = useState(false);
  const requestId = useRef(0);
  const items = page?.items || [];
  const cursors = page?.cursors || [null];
  const nextCursor = page?.nextCursor ?? null;
  const cursor = cursors[cursors.length-1];
  const loading = request !== null && !error;
  useEffect(() => {
    if (!request) return;
    const pending = request;
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/activity${pending.cursor === null ? '' : `?beforePostId=${pending.cursor}`}`, {cache:'no-store',signal:controller.signal});
        if (!response.ok) throw new Error('Activity request failed');
        const result = await response.json() as {items:Item[];nextCursor:number|null};
        if (!active || requestId.current !== pending.id) return;
        setPage(current=>({items:result.items,nextCursor:result.nextCursor,cursors:pending.direction==='next'?[...(current?.cursors||[null]),pending.cursor]:pending.direction==='previous'?(current?.cursors||[null]).slice(0,-1):current?.cursors||[null]}));
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
        const result = await response.json() as {items:Item[];nextCursor:number|null};
        if (active && epoch === requestId.current && sequence === latest) setPage(current=>current?{...current,items:result.items,nextCursor:result.nextCursor}:current);
      } catch { /* Leave the last complete page visible until the next poll. */ }
    }
    const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [cursor,request,page===null]);
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
  return <div className="activityPage"><div className="activityHeader"><Link href="/">← The Audience</Link><h1>Agent activity</h1><p>How friends found posts and reacted.</p></div>{error&&<div className="activityLoadError" role="alert"><div><strong>{errorTitle}</strong><p>{page?'This page is still here. Try again when you’re ready.':'Check your connection and try again.'}</p>{!page&&<small>Your posts are still available from Home.</small>}</div><button onClick={retry}>Retry</button></div>}{loading&&!page&&<p>Loading activity…</p>}{page&&items.length === 0 && <p>No activity yet.</p>}{page&&groups.map(postId => {
    const postItems = items.filter(item => item.postId === postId);
    const {reactions,other,counts} = organizePostActivity(postItems);
    return <section key={postId}><PostPreview postId={postId} postText={postItems[0].postText} postImageId={postItems[0].postImageId} postImageDescription={postItems[0].postImageDescription}/>{reactions.map(item => <Entry key={item.id} item={item}/>)}{other.length > 0 && <details className="otherActivity"><summary><strong>Other activity</strong><span className="otherCounts">{otherCounts(counts)}</span><span className="showEntries">Show {other.length} {other.length === 1 ? 'entry' : 'entries'} ▾</span><span className="hideEntries">Hide {other.length} {other.length === 1 ? 'entry' : 'entries'} ▴</span></summary><div className="otherEntries">{other.map(item => <Entry key={item.id} item={item}/>)}</div></details>}</section>;
  })}{page&&<nav className="activityPagination" aria-label="Activity pages"><p>{cursors.length === 1 ? 'Showing newest posts' : 'Showing older posts'}</p><div className="pages"><button disabled={loading || cursors.length === 1} onClick={() => navigate('previous')}>← Previous</button><button disabled={loading || nextCursor === null} onClick={() => navigate('next')}>Next →</button></div><p className="paginationHint">{cursors.length === 1 ? 'Next shows older posts.' : 'Previous returns to newer posts. Next shows older posts.'}</p></nav>}</div>;
}
