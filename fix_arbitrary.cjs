const fs = require('fs');
const glob = require('glob');

const mapping = {
  'text-\\[7px\\]': 'text-xs',
  'text-\\[8px\\]': 'text-xs',
  'text-\\[8\\.5px\\]': 'text-xs',
  'text-\\[9px\\]': 'text-xs',
  'text-\\[10px\\]': 'text-xs',
  'text-\\[10\\.5px\\]': 'text-xs',
  'text-\\[11px\\]': 'text-xs',
  'text-\\[11\\.5px\\]': 'text-xs',
  'text-\\[12px\\]': 'text-xs',
  'text-\\[12\\.5px\\]': 'text-xs',
  'text-\\[13px\\]': 'text-sm',
  
  'w-\\[200px\\]': 'w-48',
  'w-\\[220px\\]': 'w-56',
  'w-\\[240px\\]': 'w-60',
  'w-\\[280px\\]': 'w-72',
  'w-\\[320px\\]': 'w-80',
  'w-\\[360px\\]': 'w-96',
  
  'max-w-\\[180px\\]': 'max-w-44',
  'max-w-\\[200px\\]': 'max-w-48',
  'max-w-\\[220px\\]': 'max-w-56',
  'max-w-\\[240px\\]': 'max-w-60',
  
  'h-\\[44px\\]': 'h-11',
  'w-\\[44px\\]': 'w-11',
  'h-\\[80px\\]': 'h-20',
  'w-\\[80px\\]': 'w-20',
  'h-\\[100px\\]': 'h-24',
  'w-\\[100px\\]': 'w-24',
  'rounded-\\[10px\\]': 'rounded-xl',
  'rounded-\\[16px\\]': 'rounded-2xl',
  'rounded-\\[20px\\]': 'rounded-3xl',
  'gap-\\[10px\\]': 'gap-2.5',
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
