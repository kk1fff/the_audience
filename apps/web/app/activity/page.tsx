import Activity from './ActivityClient';

export default async function ActivityPage({searchParams}:{searchParams:Promise<{cursors?:string|string[]}>}) {
  const {cursors:raw}=await searchParams;
  const parts=typeof raw==='string' && raw.length<=500 ? raw.split(',') : [];
  const ids=parts.map(value=>/^[1-9]\d*$/.test(value)?Number(value):NaN);
  const initialCursorIds=ids.length<=20 && ids.every((id,index)=>Number.isSafeInteger(id) && (index===0 || id<ids[index-1])) ? ids : [];
  return <Activity initialCursorIds={initialCursorIds}/>;
}
