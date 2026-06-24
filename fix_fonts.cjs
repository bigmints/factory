const fs = require('fs');
const files = ['ui/src/components/dashboard.tsx', 'ui/src/components/story-editor.tsx'];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  content = content.replace(/\btext-xs\b/g, 'text-base');
  content = content.replace(/\btext-sm\b/g, 'text-base');
  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed fonts in', file);
  }
}
