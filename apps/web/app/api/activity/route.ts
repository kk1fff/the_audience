import { NextRequest, NextResponse } from 'next/server';
import { getActivity, getActivityAttempts } from '@social/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){const offset=Number(request.nextUrl.searchParams.get('offset')||0);const items=getActivity(50,Number.isFinite(offset)?offset:0) as any[];return NextResponse.json(items.map(item=>({...item,imageIds:item.imageIds?JSON.parse(item.imageIds):[],attemptHistory:getActivityAttempts(item.id).map((a:any)=>({...a,imageIds:a.imageIds?JSON.parse(a.imageIds):[]}))})));}
