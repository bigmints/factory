const fs = require('fs');
const glob = require('glob');

const mapping = {
  'max-h-\\[48rem\\]': 'max-h-full',
  'max-h-\\[75vh\\]': 'max-h-full',
  'max-h-\\[80vh\\]': 'max-h-full',
  'max-h-\\[85vh\\]': 'max-h-full',
  'max-h-\\[90vh\\]': 'max-h-full',
  'min-h-\\[28rem\\]': 'min-h-96',
  'min-h-\\[32rem\\]': 'min-h-96'
};

const files = glob.sync('ui/src/components/**/*.tsx', { ignore: 'ui/src/components/ui/**/*.tsx' });

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  for (const [key, value] of Object.entries(mapping)) {
    const regex = new RegExp(key, 'g');
    content = content.replace(regex, value);
  }
  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed', file);
  }
}
