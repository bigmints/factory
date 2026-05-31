/**
 * GET /api/queue/[id]/summary
 * Returns the build receipt summary for a completed queue item.
 * Reads from <project>/.factory/logs/builds/ matching by story slug.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { join } from 'node:path';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { loadQueue } from '@engine/queue';
import { getActiveProject } from '@engine/config';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Find the queue item
    const queue = loadQueue();
    const item = queue.find((i: any) => i.id === id);
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Resolve slug from storyFile / specFile (handles both camelCase and snake_case)
    const storyFile: string =
      (item as any).storyFile  ||
      (item as any).story_file ||
      (item as any).specFile   ||
      (item as any).spec_file  || '';
    const slug = storyFile
      .split('/')
      .pop()
      ?.replace(/\.ya?ml$/i, '') ?? '';

    // Find the active project's builds directory
    let buildsDir: string | null = null;
    try {
      const project = getActiveProject();
      if (project?.path) {
        buildsDir = join(project.path, '.factory', 'logs', 'builds');
      }
    } catch { /* ignore */ }

    if (!buildsDir || !existsSync(buildsDir)) {
      return NextResponse.json({ summary: null, slug, meta: {} });
    }

    // Most-recent receipt matching this slug
    const files = readdirSync(buildsDir)
      .filter((f: string) => f.startsWith(slug + '-') && f.endsWith('.md'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return NextResponse.json({ summary: null, slug, meta: {} });
    }

    const receipt = readFileSync(join(buildsDir, files[0]), 'utf-8');

    // Extract ## Summary section
    const summaryMatch = receipt.match(
      /## Summary\s*\n([\s\S]+?)(?=\n## |\n# |$)/
    );
    const summary = summaryMatch ? summaryMatch[1].trim() : null;

    // Extract metadata fields
    const dateMatch     = receipt.match(/\*\*Date\*\*:\s*(.+)/);
    const filesMatch    = receipt.match(/\*\*Files\*\*:\s*(\d+)/);
    const cliMatch      = receipt.match(/\*\*CLI\*\*:\s*(.+)/);
    const durationMatch = receipt.match(/Built in ([\d.]+)s/);

    return NextResponse.json({
      slug,
      receiptFile: files[0],
      summary,
      meta: {
        date:     dateMatch?.[1]?.trim()  ?? null,
        files:    filesMatch  ? parseInt(filesMatch[1]) : null,
        cli:      cliMatch?.[1]?.trim()   ?? null,
        duration: durationMatch?.[1]
          ? `${durationMatch[1]}s`
          : null,
      },
      raw: receipt,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
