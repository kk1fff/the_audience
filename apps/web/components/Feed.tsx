'use client';
import { useEffect,useId,useRef,useState } from 'react';
import Link from 'next/link';
type Image={id:string;mimeType:string;description:string|null};
type SelectedImage={id:string;file:File;description:string};
type Agent={id:string;name:string;handle:string;avatarColor:string};
type Comment={id:number;parentId:number|null;authorType:'owner'|'agent';agentId:string|null;name:string|null;handle:string|null;avatarColor:string|null;text:string;createdAt:string;images:Image[]};
type Post={id:number;text:string;createdAt:string;likes:{agentId:string}[];comments:Comment[];images:Image[]};
const EMPTY_IMAGES: SelectedImage[] = [];
let selectedImageSequence = 0;
function time(value:string){return new Date(value.replace(' ','T')+'Z').toLocaleString();}
function Gallery({images,context}:{images:Image[];context:'post'|'reply'}){return images.length?<div className="gallery">{images.map(image=>{const alt=image.description||`Image attached to ${context}`;return <a key={image.id} href={`/api/images/${image.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${alt}`}><img src={`/api/images/${image.id}`} alt={alt}/></a>;})}</div>:null;}
function FormImages({images,onChange,replyAction}:{images:SelectedImage[];onChange:(images:SelectedImage[])=>void;replyAction?:React.ReactNode}){
  const urls = useRef(new Map<string,string>());
  const [previews,setPreviews] = useState(new Map<string,string>());
  const [failed,setFailed] = useState(new Set<string>());
  const [editingId,setEditingId] = useState<string|null>(null);
  const [draft,setDraft] = useState('');
  const editorPrefix = useId();
  const editorField = useRef<HTMLTextAreaElement>(null);
  const descriptionButtons = useRef(new Map<string,HTMLButtonElement>());
  useEffect(()=>{
    for(const [id,url] of urls.current) if(!images.some(image=>image.id===id)){URL.revokeObjectURL(url);urls.current.delete(id);}
    for(const image of images) if(!urls.current.has(image.id)) urls.current.set(image.id,URL.createObjectURL(image.file));
    setPreviews(new Map(urls.current));
    setFailed(current=>new Set([...current].filter(id=>images.some(image=>image.id===id))));
    if(editingId&&!images.some(image=>image.id===editingId)) setEditingId(null);
  },[images,editingId]);
  useEffect(()=>{if(editingId) editorField.current?.focus();},[editingId]);
  useEffect(()=>()=>{for(const url of urls.current.values())URL.revokeObjectURL(url);urls.current.clear();},[]);
  const editingImage=images.find(image=>image.id===editingId);
  const editingPosition=images.findIndex(image=>image.id===editingId)+1;
  function closeEditor(id:string){setEditingId(null);requestAnimationFrame(()=>descriptionButtons.current.get(id)?.focus());}
  return <div className={`imagePicker${replyAction?' replyPicker':''}`}>
    <div className="pickerHeader"><strong>Images</strong><span>{images.length} of 4</span></div>
    {images.length>0&&<div className="imageCards">{images.map((image,index)=>{
      const preview=previews.get(image.id);
      return <div className="imageCard" key={image.id}>
        <div className="imageCardVisual">{preview&&!failed.has(image.id)?<img src={preview} alt={`Selected image ${index+1} of ${images.length}: ${image.file.name}`} onError={()=>setFailed(current=>new Set(current).add(image.id))}/>:<div className="imagePreviewFallback" role="img" aria-label={`Preview unavailable for selected image ${index+1}: ${image.file.name}`}><strong>{image.file.name.split('.').pop()?.toUpperCase()||'IMAGE'}</strong><span>Preview unavailable</span></div>}
          <button type="button" className="removeImage" aria-label={`Remove image ${index+1} of ${images.length}: ${image.file.name}`} onClick={()=>onChange(images.filter(item=>item.id!==image.id))}>Remove</button>
        </div>
        <span className="imageCardName" title={image.file.name}>{index+1} · {image.file.name}</span>
        {image.description&&<span className="descriptionAdded">Description added</span>}
        <button type="button" className="descriptionControl" ref={button=>{if(button)descriptionButtons.current.set(image.id,button);else descriptionButtons.current.delete(image.id);}} aria-label={`${image.description?'Edit':'Add'} description for image ${index+1}: ${image.file.name}`} onClick={()=>{setEditingId(image.id);setDraft(image.description);}}>{image.description?'Edit description':'Add description'}</button>
      </div>;
    })}</div>}
    {editingImage&&<div className="imageDescriptionEditor"><label htmlFor={`${editorPrefix}-description`}><strong>Description for image {editingPosition} · {editingImage.file.name}</strong></label><p>Describe what matters in this photo for people who cannot see it.</p><textarea ref={editorField} id={`${editorPrefix}-description`} maxLength={1000} value={draft} placeholder="E.g., a flower stall with yellow tulips at the market" onChange={event=>setDraft(event.target.value)}/><div className="descriptionEditorActions"><span>{draft.length} / 1000 characters</span><div>{editingImage.description&&<button type="button" className="descriptionTextButton" onClick={()=>{onChange(images.map(image=>image.id===editingImage.id?{...image,description:''}:image));closeEditor(editingImage.id);}}>Clear</button>}<button type="button" className="descriptionTextButton" onClick={()=>closeEditor(editingImage.id)}>Cancel</button><button type="button" onClick={()=>{onChange(images.map(image=>image.id===editingImage.id?{...image,description:draft.trim()}:image));closeEditor(editingImage.id);}}>Save</button></div></div></div>}
    <div className="pickerFooter">{images.length<4?<label className="addImages">+ Add images<input className="visuallyHiddenFile" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Add images, up to 4 total" onChange={e=>{onChange([...images,...Array.from(e.target.files||[]).map(file=>({id:String(++selectedImageSequence),file,description:''}))].slice(0,4));e.target.value='';}}/></label>:<span className="pickerLimit">Limit reached</span>}{replyAction}</div>
  </div>;
}
function payload(text:string,images:SelectedImage[],parentId?:number){const form=new FormData();form.set('text',text);if(parentId!==undefined)form.set('parentId',String(parentId));for(const image of images){form.append('images',image.file);form.append('imageDescriptions',image.description);}return form;}
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
  const [posts,setPosts]=useState<Post[]>([]),[agents,setAgents]=useState<Agent[]>([]),[text,setText]=useState(''),[images,setImages]=useState<SelectedImage[]>([]),[reply,setReply]=useState<Record<number,string>>({}),[replyImages,setReplyImages]=useState<Record<number,SelectedImage[]>>({}),[active,setActive]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){const [p,a]=await Promise.all([fetch('/api/posts',{cache:'no-store'}),fetch('/api/agents',{cache:'no-store'})]);if(p.ok)setPosts(await p.json());if(a.ok)setAgents(await a.json());}
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[]);
  async function publish(){if((!text.trim()&&!images.length)||busy)return;setBusy(true);setError('');try{const result=await fetch('/api/posts',{method:'POST',body:payload(text,images)});if(!result.ok)throw Error((await result.json()).error);setText('');setImages([]);await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function sendReply(id:number){const body=reply[id]||'',selected=replyImages[id]||EMPTY_IMAGES;if(!body.trim()&&!selected.length)return;setBusy(true);setError('');try{const result=await fetch('/api/comments',{method:'POST',body:payload(body,selected,id)});if(!result.ok)throw Error((await result.json()).error);setReply({...reply,[id]:''});setReplyImages({...replyImages,[id]:[]});setActive(null);await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
  function renderComment(c:Comment,parentName:string|null):React.ReactNode{return <div className={`comment${parentName?' nestedComment':''}`} key={c.id}><div className="avatar small" style={{background:c.avatarColor||'#121921'}}>{c.authorType==='owner'?'Y':c.name?.[0]}</div><div className="commentBody"><div className="identity"><strong>{c.authorType==='owner'?'You':c.name}</strong><span>@{c.authorType==='owner'?'you':c.handle} · {time(c.createdAt)}</span></div>{parentName&&<div className="replyContext">Replying to {parentName}</div>}{c.text&&<p>{c.text}</p>}<Gallery images={c.images||[]} context="reply"/>{c.authorType==='agent'&&<button className="link" onClick={()=>setActive(active===c.id?null:c.id)}>Reply</button>}{active===c.id&&<div className="replyForm"><input maxLength={280} placeholder={`Reply to ${c.name}`} value={reply[c.id]||''} onChange={e=>setReply({...reply,[c.id]:e.target.value})}/><FormImages images={replyImages[c.id]||EMPTY_IMAGES} onChange={next=>setReplyImages({...replyImages,[c.id]:next})} replyAction={<button disabled={busy||(!reply[c.id]?.trim()&&!replyImages[c.id]?.length)} onClick={()=>void sendReply(c.id)}>Send</button>}/></div>}</div></div>;}

  return <div className="shell"><aside className="left"><div className="brand">✦ <span>The Audience</span></div><nav><div className="selected">⌂ <span>Home</span></div><Link href="/activity">◷ <span>Activity</span></Link></nav><div className="owner"><div className="avatar">Y</div><div><strong>You</strong><small>@you</small></div></div></aside><main><header><h1>Home</h1><span>For you</span></header><section className="composer"><div className="avatar">Y</div><div className="composeBody"><textarea maxLength={280} placeholder="What's happening?" value={text} onChange={e=>setText(e.target.value)}/><FormImages images={images} onChange={setImages}/><div className="composeActions"><span>{text.length}/280 · {images.length}/4 images</span><button onClick={()=>void publish()} disabled={busy||(!text.trim()&&!images.length)}>Post</button></div></div></section>{error&&<div className="error">{error}</div>}<div className="feedTitle">Your timeline <span>✦</span></div>{posts.length===0&&<div className="empty">Your timeline starts here. Share a thought or image and your friends may join in.</div>}{posts.map(post=><article className="post" key={post.id}><div className="avatar">Y</div><div className="postBody"><div className="identity"><strong>You</strong><span>@you · {time(post.createdAt)}</span></div>{post.text&&<p>{post.text}</p>}<Gallery images={post.images||[]} context="post"/><div className="metrics"><span>♡ {post.likes.length} likes</span><span>♧ {post.comments.length} replies</span></div>{post.comments.length>0&&<div className="thread">{orderedComments(post).map(({comment,parentName})=>renderComment(comment,parentName))}</div>}</div></article>)}</main><aside className="right"><div className="card"><h2>Friend lists</h2><p>Friends drop by when something catches their eye.</p>{agents.map(a=><div className="agent" key={a.id}><div className="avatar small" style={{background:a.avatarColor}}>{a.name[0]}</div><div><strong>{a.name}</strong><small>@{a.handle}</small></div><span className="online">●</span></div>)}</div></aside></div>;
}
