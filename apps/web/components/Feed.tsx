'use client';
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
type Image={id:string;mimeType:string};
type Agent={id:string;name:string;handle:string;avatarColor:string};
type Comment={id:number;parentId:number|null;authorType:'owner'|'agent';agentId:string|null;name:string|null;handle:string|null;avatarColor:string|null;text:string;createdAt:string;images:Image[]};
type Post={id:number;text:string;createdAt:string;likes:{agentId:string}[];comments:Comment[];images:Image[]};
const EMPTY_FILES: File[] = [];
function time(value:string){return new Date(value.replace(' ','T')+'Z').toLocaleString();}
function Gallery({images}:{images:Image[]}){return images.length?<div className="gallery">{images.map(image=><a key={image.id} href={`/api/images/${image.id}`} target="_blank" rel="noreferrer"><img src={`/api/images/${image.id}`} alt="Attached image"/></a>)}</div>:null;}
function FormImages({files,onChange,replyAction}:{files:File[];onChange:(files:File[])=>void;replyAction?:React.ReactNode}){
  const urls = useRef(new Map<File,string>());
  const [previews,setPreviews] = useState(new Map<File,string>());
  const [failed,setFailed] = useState(new Set<File>());
  useEffect(()=>{
    for(const [file,url] of urls.current) if(!files.includes(file)){URL.revokeObjectURL(url);urls.current.delete(file);}
    for(const file of files) if(!urls.current.has(file)) urls.current.set(file,URL.createObjectURL(file));
    setPreviews(new Map(urls.current));
    setFailed(current=>new Set([...current].filter(file=>files.includes(file))));
  },[files]);
  useEffect(()=>()=>{for(const url of urls.current.values())URL.revokeObjectURL(url);urls.current.clear();},[]);
  return <div className={`imagePicker${replyAction?' replyPicker':''}`}>
    <div className="pickerHeader"><strong>Images</strong><span>{files.length} of 4</span></div>
    {files.length>0&&<div className="imageCards">{files.map((file,index)=>{
      const preview=previews.get(file);
      return <div className="imageCard" key={`${file.name}-${file.lastModified}-${index}`}>
        <div className="imageCardVisual">{preview&&!failed.has(file)?<img src={preview} alt={`Selected image ${index+1} of ${files.length}: ${file.name}`} onError={()=>setFailed(current=>new Set(current).add(file))}/>:<div className="imagePreviewFallback" role="img" aria-label={`Preview unavailable for selected image ${index+1}: ${file.name}`}><strong>{file.name.split('.').pop()?.toUpperCase()||'IMAGE'}</strong><span>Preview unavailable</span></div>}
          <button type="button" className="removeImage" aria-label={`Remove image ${index+1} of ${files.length}: ${file.name}`} onClick={()=>onChange(files.filter((_,i)=>i!==index))}>Remove</button>
        </div>
        <span className="imageCardName" title={file.name}>{index+1} · {file.name}</span>
      </div>;
    })}</div>}
    <div className="pickerFooter">{files.length<4?<label className="addImages">+ Add images<input className="visuallyHiddenFile" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Add images, up to 4 total" onChange={e=>{onChange([...files,...Array.from(e.target.files||[])].slice(0,4));e.target.value='';}}/></label>:<span className="pickerLimit">Limit reached</span>}{replyAction}</div>
  </div>;
}
function payload(text:string,files:File[],parentId?:number){const form=new FormData();form.set('text',text);if(parentId!==undefined)form.set('parentId',String(parentId));for(const file of files)form.append('images',file);return form;}
function orderedComments(post:Post):{comment:Comment;parentName:string|null}[]{
  const children=new Map<number|null,Comment[]>();
  for(const comment of post.comments){const siblings=children.get(comment.parentId)||[];siblings.push(comment);children.set(comment.parentId,siblings);}
  const ordered:{comment:Comment;parentName:string|null}[]=[];
  const seen=new Set<number>();
  function visit(parentId:number|null,parentName:string|null){for(const comment of children.get(parentId)||[]){if(seen.has(comment.id))continue;seen.add(comment.id);ordered.push({comment,parentName});visit(comment.id,comment.authorType==='owner'?'You':comment.name||'friend');}}
  visit(null,null);
  return ordered;
}

export default function Feed(){
  const [posts,setPosts]=useState<Post[]>([]),[agents,setAgents]=useState<Agent[]>([]),[text,setText]=useState(''),[files,setFiles]=useState<File[]>([]),[reply,setReply]=useState<Record<number,string>>({}),[replyFiles,setReplyFiles]=useState<Record<number,File[]>>({}),[active,setActive]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){const [p,a]=await Promise.all([fetch('/api/posts',{cache:'no-store'}),fetch('/api/agents',{cache:'no-store'})]);if(p.ok)setPosts(await p.json());if(a.ok)setAgents(await a.json());}
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[]);
  async function publish(){if((!text.trim()&&!files.length)||busy)return;setBusy(true);setError('');try{const result=await fetch('/api/posts',{method:'POST',body:payload(text,files)});if(!result.ok)throw Error((await result.json()).error);setText('');setFiles([]);await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function sendReply(id:number){const body=reply[id]||'',images=replyFiles[id]||[];if(!body.trim()&&!images.length)return;setBusy(true);setError('');try{const result=await fetch('/api/comments',{method:'POST',body:payload(body,images,id)});if(!result.ok)throw Error((await result.json()).error);setReply({...reply,[id]:''});setReplyFiles({...replyFiles,[id]:[]});setActive(null);await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
  function renderComment(c:Comment,parentName:string|null):React.ReactNode{return <div className={`comment${parentName?' nestedComment':''}`} key={c.id}><div className="avatar small" style={{background:c.avatarColor||'#121921'}}>{c.authorType==='owner'?'Y':c.name?.[0]}</div><div className="commentBody"><div className="identity"><strong>{c.authorType==='owner'?'You':c.name}</strong><span>@{c.authorType==='owner'?'you':c.handle} · {time(c.createdAt)}</span></div>{parentName&&<div className="replyContext">Replying to {parentName}</div>}{c.text&&<p>{c.text}</p>}<Gallery images={c.images||[]}/>{c.authorType==='agent'&&<button className="link" onClick={()=>setActive(active===c.id?null:c.id)}>Reply</button>}{active===c.id&&<div className="replyForm"><input maxLength={280} placeholder={`Reply to ${c.name}`} value={reply[c.id]||''} onChange={e=>setReply({...reply,[c.id]:e.target.value})}/><FormImages files={replyFiles[c.id]||EMPTY_FILES} onChange={next=>setReplyFiles({...replyFiles,[c.id]:next})} replyAction={<button disabled={busy||(!reply[c.id]?.trim()&&!replyFiles[c.id]?.length)} onClick={()=>void sendReply(c.id)}>Send</button>}/></div>}</div></div>;}

  return <div className="shell"><aside className="left"><div className="brand">✦ <span>The Audience</span></div><nav><div className="selected">⌂ <span>Home</span></div><Link href="/activity">◷ <span>Activity</span></Link></nav><div className="owner"><div className="avatar">Y</div><div><strong>You</strong><small>@you</small></div></div></aside><main><header><h1>Home</h1><span>For you</span></header><section className="composer"><div className="avatar">Y</div><div className="composeBody"><textarea maxLength={280} placeholder="What's happening?" value={text} onChange={e=>setText(e.target.value)}/><FormImages files={files} onChange={setFiles}/><div className="composeActions"><span>{text.length}/280 · {files.length}/4 images</span><button onClick={()=>void publish()} disabled={busy||(!text.trim()&&!files.length)}>Post</button></div></div></section>{error&&<div className="error">{error}</div>}<div className="feedTitle">Your timeline <span>✦</span></div>{posts.length===0&&<div className="empty">Your timeline starts here. Share a thought or image and your friends may join in.</div>}{posts.map(post=><article className="post" key={post.id}><div className="avatar">Y</div><div className="postBody"><div className="identity"><strong>You</strong><span>@you · {time(post.createdAt)}</span></div>{post.text&&<p>{post.text}</p>}<Gallery images={post.images||[]}/><div className="metrics"><span>♡ {post.likes.length} likes</span><span>♧ {post.comments.length} replies</span></div>{post.comments.length>0&&<div className="thread">{orderedComments(post).map(({comment,parentName})=>renderComment(comment,parentName))}</div>}</div></article>)}</main><aside className="right"><div className="card"><h2>Friend lists</h2><p>Friends drop by when something catches their eye.</p>{agents.map(a=><div className="agent" key={a.id}><div className="avatar small" style={{background:a.avatarColor}}>{a.name[0]}</div><div><strong>{a.name}</strong><small>@{a.handle}</small></div><span className="online">●</span></div>)}</div></aside></div>;
}
