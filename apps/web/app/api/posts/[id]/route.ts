import { NextResponse } from 'next/server';
import { getPost } from '@social/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id:raw}=await params;
  const id=/^[1-9]\d*$/.test(raw)?Number(raw):NaN;
  const post=getPost(id);
  return post ? NextResponse.json(post) : NextResponse.json({error:'Post unavailable'},{status:404});
}
