/**
 * SQLite database manager for the Factory engine.
 * Stores queue state, build history, and knowledge entries.
 */

import Database from 'better-sqlite3';
import { PATHS } from './config.ts';
import { log } from './log.ts';

let _db: Database.Database | null = null;

/** Get or create the SQLite database connection. */
export function getDb(): Database.Database {
    if (!_db) {
        _db = new Database(PATHS.db);
        _db.pragma('journal_mode = WAL');
        _db.pragma('foreign_keys = ON');
        initSchema(_db);
    }
    return _db;
}

/** Initialize all tables if they don't exist. */
function initSchema(db: Database.Database): void {
    // ── Migrations: Rename spec_file to story_file if present ──
    try {
        const qCols = db.prepare(`PRAGMA table_info(queue_items)`).all() as { name: string }[];
        const qColNames = new Set(qCols.map(c => c.name));
        if (qColNames.has('spec_file') && !qColNames.has('story_file')) {
            db.exec(`ALTER TABLE queue_items RENAME COLUMN spec_file TO story_file`);
            log('✓', 'Migrated SQLite queue_items: renamed spec_file to story_file');
        }
    } catch (e: any) {
        // Table may not exist yet, ignore
    }

    try {
        const bCols = db.prepare(`PRAGMA table_info(builds)`).all() as { name: string }[];
        const bColNames = new Set(bCols.map(c => c.name));
        if (bColNames.has('spec_file') && !bColNames.has('story_file')) {
            db.exec(`ALTER TABLE builds RENAME COLUMN spec_file TO story_file`);
            log('✓', 'Migrated SQLite builds: renamed spec_file to story_file');
            
            // Recreate virtual FTS table to use story_file
            db.exec(`DROP TABLE IF EXISTS builds_fts`);
        }
    } catch (e: any) {
        // Table may not exist yet, ignore
    }

    db.exec(`
        -- Queue items
        CREATE TABLE IF NOT EXISTS queue_items (
            id TEXT PRIMARY KEY,
            story_file TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('AppStory', 'FeatureStory')),
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'running', 'completed', 'failed', 'needs-attention')),
            priority INTEGER NOT NULL DEFAULT 0,
            added_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            output TEXT DEFAULT '',
            error TEXT,
            duration_ms INTEGER
        );

        -- Build history / knowledge
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

        -- Full-text search index for knowledge
        CREATE VIRTUAL TABLE IF NOT EXISTS builds_fts USING fts5(
            story_file,
            output,
            notes,
            files_generated,
            content='builds',
            content_rowid='rowid'
        );

        -- Queue execution state
        CREATE TABLE IF NOT EXISTS queue_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    // Ensure default state values exist
    const insert = db.prepare(
        'INSERT OR IGNORE INTO queue_state (key, value) VALUES (?, ?)'
    );
    insert.run('is_running', 'false');
    insert.run('last_run_at', '');
    insert.run('last_heartbeat_at', '');

    // Migrate values from AppSpec/FeatureSpec to AppStory/FeatureStory
    try {
        db.prepare("UPDATE queue_items SET kind = 'AppStory' WHERE kind = 'AppSpec'").run();
        db.prepare("UPDATE queue_items SET kind = 'FeatureStory' WHERE kind = 'FeatureSpec'").run();
        db.prepare("UPDATE builds SET kind = 'AppStory' WHERE kind = 'AppSpec'").run();
        db.prepare("UPDATE builds SET kind = 'FeatureStory' WHERE kind = 'FeatureSpec'").run();
    } catch {
        // ignore
    }

    // ── Migrations: add new columns if missing ──
    const cols = db.prepare(`PRAGMA table_info(builds)`).all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));
    const migrations: [string, string][] = [
        ['model', 'TEXT'],
        ['provider', 'TEXT'],
        ['tokens_in', 'INTEGER DEFAULT 0'],
        ['tokens_out', 'INTEGER DEFAULT 0'],
        ['error_source', 'TEXT'],
        ['error_category', 'TEXT'],
        ['engine', "TEXT DEFAULT 'factory'"],
    ];
    for (const [col, type] of migrations) {
        if (!colNames.has(col)) {
            db.exec(`ALTER TABLE builds ADD COLUMN ${col} ${type}`);
        }
    }

    // ── Queue items: add phase + depends_on for dependency-aware scheduling ──
    const qCols = db.prepare(`PRAGMA table_info(queue_items)`).all() as { name: string }[];
    const qColNames = new Set(qCols.map(c => c.name));
    const qMigrations: [string, string][] = [
        ['phase', 'INTEGER DEFAULT 0'],
        ['depends_on', "TEXT DEFAULT '[]'"],
    ];
    for (const [col, type] of qMigrations) {
        if (!qColNames.has(col)) {
            db.exec(`ALTER TABLE queue_items ADD COLUMN ${col} ${type}`);
        }
    }

    // Add error_category if missing
    if (!qColNames.has('error_category')) {
        db.exec(`ALTER TABLE queue_items ADD COLUMN error_category TEXT`);
    }

    // Add engine column for per-build engine selection (factory vs minions)
    if (!qColNames.has('engine')) {
        db.exec(`ALTER TABLE queue_items ADD COLUMN engine TEXT DEFAULT 'factory'`);
    }
}

/** Log a build result to the knowledge base as a structured debrief. */
export function logBuild(
    storyFile: string,
    kind: string,
    status: string,
    summary: string,
    filesGenerated: string[],
    durationMs: number,
    opts?: {
        model?: string;
        provider?: string;
        engine?: string;
        tokensIn?: number;
        tokensOut?: number;
        errorSource?: 'llm' | 'engine' | null;
        errorCategory?: 'transient' | 'permanent' | null;
    },
    ): void {
    const db = getDb();
    const id = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const oneLiner = status === 'failed'
        ? 'Build failed'
        : `Built ${filesGenerated.length} file(s) in ${(durationMs / 1000).toFixed(1)}s`;

    db.prepare(`
        INSERT INTO builds (id, story_file, kind, timestamp, duration_ms, status, files_generated, output, notes, model, provider, engine, tokens_in, tokens_out, error_source, error_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        storyFile,
        kind,
        new Date().toISOString(),
        durationMs,
        status,
        JSON.stringify(filesGenerated),
        summary,
        oneLiner,
        opts?.model || null,
        opts?.provider || null,
        opts?.engine || 'factory',
        opts?.tokensIn || 0,
        opts?.tokensOut || 0,
        opts?.errorSource || null,
        opts?.errorCategory || null,
    );
    }

/** Close the database connection. */
export function closeDb(): void {
    if (_db) {
        _db.close();
        _db = null;
    }
}
