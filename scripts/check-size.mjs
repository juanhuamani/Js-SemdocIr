// scripts/check-size.mjs — structural barrier: one concern per file.
//
// A file that grows past the budget is holding two responsibilities. The
// budget is generous on purpose; it catches the 800-line file, not the
// 260-line one.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'src';
const LIMIT = 300;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const offenders = walk(ROOT)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file, lines: fs.readFileSync(file, 'utf8').split('\n').length }))
  .filter(({ lines }) => lines > LIMIT);

for (const { file, lines } of offenders) {
  console.error(`${file}: ${lines} lines (limit ${LIMIT})`);
}

if (offenders.length > 0) {
  console.error(`\n${offenders.length} file(s) over the size budget. Split by responsibility.`);
  process.exit(1);
}

console.log(`size budget ok (limit ${LIMIT} lines)`);
