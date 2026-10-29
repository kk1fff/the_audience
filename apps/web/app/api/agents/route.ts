import { NextResponse } from 'next/server';
import { getAgents } from '@social/db';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(getAgents()); }
