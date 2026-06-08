'use client';

import React from 'react';

// ─── YAML Viewer ─────────────────────────────────────────────────────────────
export function YamlViewer({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="p-4 font-mono text-[11px] leading-6 select-text overflow-auto">
      {lines.map((line, i) => {
        const isComment = line.trimStart().startsWith('#');
        const keyMatch = !isComment && line.match(/^(\s*)([a-zA-Z0-9_\-]+)(\s*:.*)$/);
        const isList = /^\s*-\s/.test(line);
        if (isComment) {
          return <div key={i} className="text-zinc-600 italic">{line || '\u00A0'}</div>;
        }
        if (keyMatch) {
          const [, indent, key, rest] = keyMatch;
          const valueRaw = rest.replace(/^\s*:\s*/, '');
          const isStr = /^["']/.test(valueRaw);
          const isNum = /^[\d.]+$/.test(valueRaw);
          const isBool = /^(true|false|yes|no|null)$/.test(valueRaw);
          return (
            <div key={i}>
              <span>{indent}</span>
              <span className="text-sky-300 font-semibold">{key}</span>
              <span className="text-zinc-500">: </span>
              {valueRaw ? <span className={isStr ? 'text-emerald-400' : isNum ? 'text-amber-400' : isBool ? 'text-violet-400' : 'text-zinc-200'}>{valueRaw}</span> : null}
            </div>
          );
        }
        if (isList) {
          const m = line.match(/^(\s*-\s*)(.*)$/);
          if (m) return (
            <div key={i}>
              <span className="text-zinc-500">{m[1]}</span>
              <span className={/^["']/.test(m[2]) ? 'text-emerald-400' : 'text-zinc-300'}>{m[2]}</span>
            </div>
          );
        }
        return <div key={i} className="text-zinc-300">{line || '\u00A0'}</div>;
      })}
    </div>
  );
}
