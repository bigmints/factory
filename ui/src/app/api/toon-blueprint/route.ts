import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export async function GET() {
    const candidates = [
        join(process.cwd(), '.factory', 'blueprint', 'blueprint.yaml'),
        join(process.cwd(), '.factory', 'blueprint', 'blueprint.toon'),
        join(process.cwd(), '.factory', 'context', 'context.yaml'),
        join(process.cwd(), '.factory', 'context', 'context.toon'),
    ];

    for (const p of candidates) {
        if (existsSync(p)) {
            try {
                const content = readFileSync(p, 'utf-8');
                if (p.endsWith('.yaml')) {
                    return NextResponse.json(parse(content));
                } else {
                    return NextResponse.json(JSON.parse(content));
                }
            } catch {
                // Try next candidate
            }
        }
    }

    return NextResponse.json({});
}
