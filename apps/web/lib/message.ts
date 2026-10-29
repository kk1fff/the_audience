import { deleteUnattachedImages, storeImage } from '@social/db';
import { validMessage } from '@social/core';
export async function parseMessage(request: Request): Promise<{text:string; imageIds:string[]; parentId?:number}> {
  let text: unknown, parentId:unknown, files:File[]=[], descriptions:string[]=[];
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const form=await request.formData();text=form.get('text') ?? '';parentId=form.get('parentId');files=form.getAll('images').filter((item):item is File => item instanceof File);
    if(form.getAll('images').length!==files.length) throw new Error('Invalid image input');
    const metadata=form.getAll('imageDescriptions');
    if(metadata.length && (metadata.length!==files.length || metadata.some(value=>typeof value!=='string'))) throw new Error('Image descriptions must match the selected images.');
    descriptions=metadata as string[];
  } else { const body=await request.json();text=body.text;parentId=body.parentId; }
  if(!validMessage(text,files.length)) throw new Error('Message must contain text or 1–4 images; text is limited to 280 characters.');
  if(descriptions.some(value=>value.length>1000)) throw new Error('Image descriptions must be 1000 characters or fewer.');
  const prepared:{bytes:Buffer;mime:string;description:string|null}[]=[];
  for(const [index,file] of files.entries()) {
    if(file.size===0||file.size>10*1024*1024) throw new Error('Each image must be 1 byte–10 MB.');
    const bytes=Buffer.from(await file.arrayBuffer());
    const mime=bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
    if(!mime || file.type!==mime) throw new Error('Only JPEG, PNG, and WebP images are supported.');
    prepared.push({bytes,mime,description:descriptions[index]?.trim()||null});
  }
  const imageIds:string[]=[];
  try { for(const item of prepared) imageIds.push(storeImage(item.bytes,item.mime,item.description).id); }
  catch(error) { deleteUnattachedImages(imageIds);throw error; }
  return {text:(text as string).trim(),imageIds,parentId:parentId===null||parentId===undefined?undefined:Number(parentId)};
}
