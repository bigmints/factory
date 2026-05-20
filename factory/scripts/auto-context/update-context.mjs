import fs from 'fs';
import path from 'path';
import { encode, decode } from '@toon-format/toon';

const PROJECT_ROOT = process.env.FACTORY_PROJECT_ROOT || process.cwd();
const WORKLOG_PATH = path.join(PROJECT_ROOT, '.factory/context/worklog.yaml');

let data = { entries: [] };

if (fs.existsSync(WORKLOG_PATH)) {
  const content = fs.readFileSync(WORKLOG_PATH, 'utf8');
  if (content.trim()) {
    try {
      data = decode(content);
      // Ensure entries is an array
      if (!data.entries) data.entries = [];
    } catch (e) {
      console.error('Failed to parse existing worklog.yaml:', e.message);
    }
  }
}

const args = process.argv.slice(2);
const msg = args.join(' ');

if (!msg || msg === '--help') {
  console.log('Usage: node update-context.mjs "<message>"');
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

console.log('Worklog updated in TOON format at .factory/context/worklog.yaml');
