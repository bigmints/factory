import fs from 'fs';
import path from 'path';
import { encode, decode } from '@toon-format/toon';

const PROJECT_ROOT = process.env.FACTORY_PROJECT_ROOT || process.cwd();
const BLUEPRINT_WORKLOG = path.join(PROJECT_ROOT, '.factory/blueprint/worklog.yaml');
const CONTEXT_WORKLOG = path.join(PROJECT_ROOT, '.factory/context/worklog.yaml');

// Prefer blueprint path, fall back to context if it exists and blueprint does not
const WORKLOG_PATH = fs.existsSync(CONTEXT_WORKLOG) && !fs.existsSync(path.dirname(BLUEPRINT_WORKLOG))
  ? CONTEXT_WORKLOG
  : BLUEPRINT_WORKLOG;

let data = { entries: [] };

if (fs.existsSync(WORKLOG_PATH)) {
  const content = fs.readFileSync(WORKLOG_PATH, 'utf8');
  if (content.trim()) {
    try {
      data = decode(content);
      // Ensure entries is an array (robust fallback if parsed from standard YAML)
      if (!Array.isArray(data.entries)) {
        const entries = [];
        const lines = content.split('\n');
        let currentEntry = null;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('- date:')) {
            if (currentEntry) entries.push(currentEntry);
            currentEntry = { date: trimmed.replace('- date:', '').trim(), message: '' };
          } else if (trimmed.startsWith('date:') && !trimmed.startsWith('-')) {
            if (currentEntry) entries.push(currentEntry);
            currentEntry = { date: trimmed.replace('date:', '').trim(), message: '' };
          } else if (trimmed.startsWith('message:')) {
            if (currentEntry) {
              currentEntry.message = trimmed.replace('message:', '').trim();
            }
          } else if (trimmed.startsWith('files:')) {
            if (currentEntry) {
              currentEntry.files = trimmed.replace('files:', '').trim();
            }
          }
        }
        if (currentEntry) entries.push(currentEntry);
        data.entries = entries;
      }
    } catch (e) {
      console.error(`Failed to parse existing worklog.yaml at ${WORKLOG_PATH}:`, e.message);
    }
  }
}

const args = process.argv.slice(2);
const msg = args.join(' ');

if (!msg || msg === '--help') {
  console.log('Usage: node update-blueprint.mjs "<message>"');
  process.exit(msg === '--help' ? 0 : 1);
}

// Extract changed files if passed (used by git hook)
let finalMsg = msg;
let files = [];
const filesMatch = msg.match(/FILES:(.*)/s);
if (filesMatch) {
  finalMsg = msg.replace(/FILES:.*/s, '').trim();
  files = filesMatch[1]
    .trim()
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
}

const entry = {
  date: new Date().toISOString().replace('T', ' ').substring(0, 19),
  message: finalMsg,
};
if (files.length > 0) {
  entry.files = files.join(', ');
}

data.entries.push(entry);

fs.mkdirSync(path.dirname(WORKLOG_PATH), { recursive: true });
fs.writeFileSync(WORKLOG_PATH, encode(data));

console.log(`Worklog updated in TOON format at ${path.relative(PROJECT_ROOT, WORKLOG_PATH)}`);
