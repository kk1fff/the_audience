import { NextRequest, NextResponse } from 'next/server';
import { getActivityPage, getActivityAttempts, getImageAccessibility, getBrowseSchedule, getRecentBrowseResults } from '@social/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  const raw = request.nextUrl.searchParams.get('beforePostId');
  if (raw !== null && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))) return NextResponse.json({error:'Invalid activity cursor'}, {status:400});
  const page = getActivityPage(raw === null ? null : Number(raw));
  return NextResponse.json({items:(page.items as any[]).map(item=>({...item,imageIds:item.imageIds?JSON.parse(item.imageIds):[],attemptHistory:getActivityAttempts(item.id).map((a:any)=>({...a,imageIds:a.imageIds?JSON.parse(a.imageIds):[],images:(a.imageIds?JSON.parse(a.imageIds):[]).map((id:string)=>getImageAccessibility(id))}))})),nextCursor:page.nextCursor,browseSchedule:getBrowseSchedule(),recentBrowseResults:getRecentBrowseResults()});
}
