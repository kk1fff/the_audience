'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PostCard, type Post } from './Feed';

export default function PostConversation({postId,activityCursors}:{postId:string;activityCursors:string}) {
  const [post,setPost]=useState<Post|null>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'missing'|'error'>('loading');
  const backHref=activityCursors?`/activity?cursors=${encodeURIComponent(activityCursors)}`:'/activity';
  async function refresh() {
    try {
      const response=await fetch(`/api/posts/${postId}`,{cache:'no-store'});
      if(response.status===404){setPost(null);setStatus('missing');return;}
      if(!response.ok)throw new Error('Could not load post');
      setPost(await response.json() as Post);
      setStatus('ready');
    } catch {setStatus(current=>current==='ready'?'ready':'error');}
  }
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[postId]);
  useEffect(()=>{
    if (!post) return;
    const match=/^#comment-([1-9]\d*)$/.exec(window.location.hash);
    if (!match) return;
    const target=post.comments.find(comment=>comment.id===Number(match[1]));
    if (!target){window.scrollTo({top:0,behavior:'auto'});return;}
    requestAnimationFrame(()=>{const element=document.getElementById(`comment-${target.id}`);element?.scrollIntoView({block:'start'});element?.focus({preventScroll:true});});
  },[post?.id]);
  return <div className="conversationPage"><Link className="conversationBack" href={backHref}>← Back to Agent activity</Link><h1>Conversation</h1>{post&&<p className="conversationMeta">Post #{post.id}</p>}{status==='loading'&&<p>Loading conversation…</p>}{status==='missing'&&<div className="conversationUnavailable"><h2>Post unavailable</h2><p>This conversation could not be found.</p><p>Its activity record may still be visible.</p><Link href="/">Go to Home →</Link></div>}{status==='error'&&<div className="conversationUnavailable"><h2>Couldn’t load conversation</h2><p>Try again to view this post and its replies.</p><button onClick={()=>void refresh()}>Retry</button></div>}{status==='ready'&&post&&<PostCard post={post} onRefresh={refresh} conversation/>}</div>;
}
