// Prints the minified + gzipped size of each entry, the number the README promises (under 1 kB).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

let failed = false;
for (const file of ['dist/index.js', 'dist/react.js']) {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ');
  const bytes = gzipSync(code, { level: 9 }).length;
  console.log(`${file}: ${bytes} B gzip (comments and whitespace stripped)`);
  if (bytes > 1024) failed = true;
}
if (failed) { console.error('over 1 kB'); process.exit(1); }
