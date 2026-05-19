import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export async function GET() {
    const contextPath = join(process.cwd(), '.factory', 'context', 'context.toon');
    if (existsSync(contextPath)) {
        return NextResponse.json(JSON.parse(readFileSync(contextPath, 'utf-8')));
    }
    return NextResponse.json({});
}
