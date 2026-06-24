const fs = require('fs');
const glob = require('glob');

const files = glob.sync('ui/src/components/**/*.tsx', { ignore: 'ui/src/components/ui/**/*.tsx' });
const found = new Set();

const regex = /[a-zA-Z0-9-]+-\[[^\]]+\]/g;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.match(regex);
  if (matches) {
    matches.forEach(m => found.add(m));
  }
}
console.log(Array.from(found).sort().join('\n'));
