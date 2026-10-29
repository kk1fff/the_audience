import { NextRequest, NextResponse } from 'next/server';
import { createPost, deleteUnattachedImages, getFeed } from '@social/db';
import { parseMessage } from '../../../lib/message';
export const runtime='nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(getFeed()); }
export async function POST(request: NextRequest) {
  let imageIds:string[]=[];
  try { const message=await parseMessage(request);imageIds=message.imageIds;return NextResponse.json(createPost(message.text,imageIds),{status:201}); }
  catch(error) { deleteUnattachedImages(imageIds);return NextResponse.json({error:error instanceof Error?error.message:'Invalid post'},{status:400}); }
}
