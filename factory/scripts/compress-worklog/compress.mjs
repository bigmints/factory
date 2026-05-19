import fs from 'fs';
import path from 'path';
import { encode, decode } from '@toon-format/toon';

const PROJECT_ROOT = process.env.FACTORY_PROJECT_ROOT || process.cwd();
const WORKLOG_PATH = path.join(PROJECT_ROOT, '.factory/context/worklog.toon');

if (!fs.existsSync(WORKLOG_PATH)) {
  console.log('No worklog found to compress.');
  process.exit(0);
}

const content = fs.readFileSync(WORKLOG_PATH, 'utf8');
if (!content.trim()) process.exit(0);

let data;
try {
  data = decode(content);
} catch (e) {
  console.error('Failed to parse worklog.toon:', e.message);
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
