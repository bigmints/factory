import { homedir } from 'node:os';
/**
 * Knowledge API — retrieve build history, search, and aggregate stats.
 */

import { NextResponse } from 'next/server';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = resolve(homedir(), '.factory', 'factory.db');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Ensure table info column renaming migration
  try {
    const cols = db.prepare(`PRAGMA table_info(builds)`).all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (colNames.has('spec_file') && !colNames.has('story_file')) {
      db.exec(`ALTER TABLE builds RENAME COLUMN spec_file TO story_file`);
    }
  } catch {}

  // Ensure tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      story_file TEXT NOT NULL,
      kind TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      files_generated TEXT DEFAULT '[]',
      validation_result TEXT,
      output TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );
  `);

  // Safely add new columns if missing
  const cols = db.prepare(`PRAGMA table_info(builds)`).all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  const migrations: [string, string][] = [
    ['model', 'TEXT'],
    ['provider', 'TEXT'],
    ['tokens_in', 'INTEGER DEFAULT 0'],
    ['tokens_out', 'INTEGER DEFAULT 0'],
    ['error_source', 'TEXT'],
  ];
  for (const [col, type] of migrations) {
    if (!colNames.has(col)) {
      db.exec(`ALTER TABLE builds ADD COLUMN ${col} ${type}`);
    }
  }

  return db;
}

/** GET — retrieve build history + aggregate stats */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storyFile = url.searchParams.get('storyFile') || url.searchParams.get('specFile');
    const query = url.searchParams.get('q');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const db = getDb();

    let rows: any[];

    if (query) {
      // Full-text search if FTS table exists
      try {
        rows = db.prepare(`
          SELECT builds.* FROM builds_fts
          JOIN builds ON builds.rowid = builds_fts.rowid
          WHERE builds_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(query, limit);
      } catch {
        // FTS table might not exist yet — fallback to LIKE search
        rows = db.prepare(`
          SELECT * FROM builds
          WHERE story_file LIKE ? OR output LIKE ? OR notes LIKE ?
          ORDER BY timestamp DESC
          LIMIT ?
        `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit);
      }
    } else if (storyFile) {
      rows = db.prepare(`
        SELECT * FROM builds WHERE story_file = ? ORDER BY timestamp DESC LIMIT ?
      `).all(storyFile, limit);
    } else {
      rows = db.prepare(`
        SELECT * FROM builds ORDER BY timestamp DESC LIMIT ?
      `).all(limit);
    }

    // Core stats
    const total = db.prepare('SELECT COUNT(*) as count FROM builds').get() as { count: number };
    const successful = db.prepare(`SELECT COUNT(*) as count FROM builds WHERE status = 'completed'`).get() as { count: number };
    const failed = db.prepare(`SELECT COUNT(*) as count FROM builds WHERE status = 'failed'`).get() as { count: number };
    const unique = db.prepare('SELECT COUNT(DISTINCT story_file) as count FROM builds').get() as { count: number };

    // Token stats
    const tokenStats = db.prepare(`
      SELECT 
        COALESCE(SUM(tokens_in), 0) as total_tokens_in,
        COALESCE(SUM(tokens_out), 0) as total_tokens_out,
        COALESCE(AVG(duration_ms), 0) as avg_duration_ms
      FROM builds
    `).get() as { total_tokens_in: number; total_tokens_out: number; avg_duration_ms: number };

    // Model usage breakdown
    const modelUsage = db.prepare(`
      SELECT model, provider, COUNT(*) as count,
        COALESCE(SUM(tokens_in), 0) as tokens_in,
        COALESCE(SUM(tokens_out), 0) as tokens_out
      FROM builds WHERE model IS NOT NULL
      GROUP BY model, provider
      ORDER BY count DESC
    `).all() as { model: string; provider: string; count: number; tokens_in: number; tokens_out: number }[];

    // Error breakdown
    const errorBreakdown = db.prepare(`
      SELECT error_source, COUNT(*) as count
      FROM builds WHERE status = 'failed' AND error_source IS NOT NULL
      GROUP BY error_source
    `).all() as { error_source: string; count: number }[];

    db.close();

    // Parse files_generated JSON and expose new fields
    const entries = rows.map((row: any) => ({
      ...row,
      storyFile: row.story_file || row.spec_file,
      specFile: row.story_file || row.spec_file,
      story_file: row.story_file || row.spec_file,
      spec_file: row.story_file || row.spec_file,
      summary: row.output || '',
      filesGenerated: JSON.parse(row.files_generated || '[]'),
    }));

    return NextResponse.json({
      entries,
      stats: {
        totalBuilds: total.count,
        successfulBuilds: successful.count,
        failedBuilds: failed.count,
        uniqueStories: unique.count,
        uniqueSpecs: unique.count,
        totalTokensIn: tokenStats.total_tokens_in,
        totalTokensOut: tokenStats.total_tokens_out,
        avgDurationMs: Math.round(tokenStats.avg_duration_ms),
        modelUsage,
        errorBreakdown,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
