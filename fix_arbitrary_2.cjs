const fs = require('fs');
const glob = require('glob');

const mapping = {
  'bg-\\[#0d1117\\]': 'bg-slate-950',
  'bottom-\\[calc\\(100\\%\\+6px\\)\\]': 'bottom-full mb-1.5',
  'h-\\[240px\\]': 'h-60',
  'h-\\[280px\\]': 'h-72',
  'h-\\[320px\\]': 'h-80',
  'h-\\[400px\\]': 'h-96',
  'max-h-\\[200px\\]': 'max-h-48',
  'max-h-\\[35vh\\]': 'max-h-96',
  'max-h-\\[700px\\]': 'max-h-[48rem]',
  'max-h-\\[70vh\\]': 'max-h-screen',
  'max-h-\\[75vh\\]': 'max-h-[75vh]',
  'max-h-\\[80vh\\]': 'max-h-[80vh]',
  'max-h-\\[85vh\\]': 'max-h-[85vh]',
  'max-h-\\[90vh\\]': 'max-h-[90vh]',
  'max-w-\\[120px\\]': 'max-w-32',
  'max-w-\\[480px\\]': 'max-w-md',
  'max-w-\\[520px\\]': 'max-w-lg',
  'max-w-\\[640px\\]': 'max-w-screen-sm',
  'max-w-\\[80\\%\\]': 'max-w-4/5',
  'max-w-\\[90\\%\\]': 'max-w-11/12',
  'min-h-\\[450px\\]': 'min-h-[28rem]',
  'min-h-\\[500px\\]': 'min-h-[32rem]',
  'scale-\\[0\\.98\\]': 'scale-95',
  'scale-\\[1\\.02\\]': 'scale-105',
  'scale-y-\\[-1\\]': '-scale-y-100',
  'w-\\[160px\\]': 'w-40',
  'w-\\[180px\\]': 'w-44',
  'w-\\[380px\\]': 'w-96',
  'w-\\[90px\\]': 'w-24',
  'w-\\[95vw\\]': 'w-11/12',
  'z-\\[100\\]': 'z-50'
};

const files = glob.sync('ui/src/components/**/*.tsx', { ignore: 'ui/src/components/ui/**/*.tsx' });

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  for (const [key, value] of Object.entries(mapping)) {
    const regex = new RegExp(key, 'g');
    content = content.replace(regex, value);
  }
  // also clean up grid-cols-[1fr_90px_120px_80px_80px_70px]
  content = content.replace(/grid-cols-\[1fr_90px_120px_80px_80px_70px\]/g, 'grid-cols-6');
  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed', file);
  }
}
