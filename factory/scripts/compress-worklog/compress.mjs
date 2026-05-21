import fs from 'fs';
import path from 'path';
import { encode, decode } from '@toon-format/toon';

const PROJECT_ROOT = process.env.FACTORY_PROJECT_ROOT || process.cwd();
const bpYaml = path.join(PROJECT_ROOT, '.factory/blueprint/worklog.yaml');
const bpToon = path.join(PROJECT_ROOT, '.factory/blueprint/worklog.toon');
const ctxYaml = path.join(PROJECT_ROOT, '.factory/context/worklog.yaml');
const ctxToon = path.join(PROJECT_ROOT, '.factory/context/worklog.toon');

const WORKLOG_PATH = fs.existsSync(bpYaml) ? bpYaml
  : fs.existsSync(bpToon) ? bpToon
  : fs.existsSync(ctxYaml) ? ctxYaml
  : fs.existsSync(ctxToon) ? ctxToon
  : null;

if (!WORKLOG_PATH) {
  console.log('No worklog found to compress.');
  process.exit(0);
}

const content = fs.readFileSync(WORKLOG_PATH, 'utf8');
if (!content.trim()) process.exit(0);

let data;
try {
  data = decode(content);
  // Ensure entries is an array (robust fallback if parsed from standard YAML)
  if (data && !Array.isArray(data.entries)) {
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
  console.error('Failed to parse worklog:', e.message);
  process.exit(1);
}

if (!data.entries || data.entries.length <= 15) {
  console.log('Worklog is already small enough. No compression needed.');
  process.exit(0);
}

const recent = data.entries.slice(-10);
const older = data.entries.slice(0, -10);

const summaryEntry = {
  date: new Date().toISOString().replace('T', ' ').substring(0, 19),
  message: `[ARCHIVED HISTORY] Compressed ${older.length} earlier entries to save context.`,
};

data.entries = [summaryEntry, ...recent];

fs.writeFileSync(WORKLOG_PATH, encode(data));
console.log(
  `Compressed ${older.length} entries. The worklog now contains the 10 most recent entries plus 1 summary entry.`
);
