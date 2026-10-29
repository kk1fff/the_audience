import PostConversation from '../../../components/PostConversation';

export default async function ConversationPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{activityCursors?:string|string[]}>}) {
  const [{id},{activityCursors:raw}]=await Promise.all([params,searchParams]);
  const activityCursors=typeof raw==='string' && raw.length<=500 && /^([1-9]\d*)(,[1-9]\d*)*$/.test(raw) ? raw : '';
  return <PostConversation postId={id} activityCursors={activityCursors}/>;
}
