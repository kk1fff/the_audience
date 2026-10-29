import { NextRequest, NextResponse } from 'next/server';
import { createOwnerReply, deleteUnattachedImages } from '@social/db';
import { parseMessage } from '../../../lib/message';
export const runtime='nodejs';
export async function POST(request: NextRequest) {
  let imageIds:string[]=[];
  try { const message=await parseMessage(request);imageIds=message.imageIds;
    if(!Number.isInteger(message.parentId)) throw new Error('Invalid reply target');
    const result=createOwnerReply(message.parentId!,message.text,imageIds);
    if(!result) { deleteUnattachedImages(imageIds);return NextResponse.json({error:'Comment not found'},{status:404}); }
    return NextResponse.json(result,{status:201});
  } catch(error) { deleteUnattachedImages(imageIds);return NextResponse.json({error:error instanceof Error?error.message:'Invalid reply'},{status:400}); }
}
