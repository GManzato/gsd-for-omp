'use strict';

// Syntax-check every CommonJS module in bin/, src/, scripts/, and test/.
// Usage: node scripts/lint.cjs

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = ['bin', 'src', 'scripts', 'test']
  .flatMap((dir) => fs.readdirSync(path.join(root, dir), { recursive: true }).map((file) => path.join(dir, file)))
  .filter((file) => file.endsWith('.cjs'))
  .sort();

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}

if (failed > 0) {
  console.error(`lint: ${failed} of ${files.length} files failed node --check`);
  process.exit(1);
}
console.log(`lint: ${files.length} files passed node --check`);
