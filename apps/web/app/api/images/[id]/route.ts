import { readFileSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { getImage } from '@social/db';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) { const {id}=await params;const image=getImage(id);if(!image)return new NextResponse(null,{status:404});try{return new NextResponse(readFileSync(image.path),{headers:{'Content-Type':image.mimeType,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});}catch{return new NextResponse(null,{status:404});} }
