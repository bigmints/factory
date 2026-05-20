import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export async function GET() {
    const yamlPath = join(process.cwd(), '.factory', 'context', 'context.yaml');
    const toonPath = join(process.cwd(), '.factory', 'context', 'context.toon');

    if (existsSync(yamlPath)) {
        try {
            const fileContent = readFileSync(yamlPath, 'utf-8');
            return NextResponse.json(parse(fileContent));
        } catch {
            // Ignore error, try fallback
        }
    }

    if (existsSync(toonPath)) {
        try {
            const fileContent = readFileSync(toonPath, 'utf-8');
            return NextResponse.json(JSON.parse(fileContent));
        } catch {
            // Ignore error
        }
    }

    return NextResponse.json({});
}

