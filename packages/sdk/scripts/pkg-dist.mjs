/**
 * Swap the package manifest between in-repo (source) and published (dist) entry points.
 *
 * In-repo, @kiba/sdk resolves to `src/index.ts` so the rest of the monorepo loads the
 * SDK as source (via tsx) with no build step — exactly as every other workspace does.
 * For publishing, the tarball must point at the compiled `dist/`. `prepack` runs
 * `apply` (after building dist) and `postpack` runs `restore`, so the committed
 * package.json always stays on the source entry points and git stays clean.
 *
 *   node scripts/pkg-dist.mjs apply     # main/types/exports -> dist (publish)
 *   node scripts/pkg-dist.mjs restore   # main/types -> src, drop exports (dev)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const mode = process.argv[2];
const path = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(path, 'utf8'));

if (mode === 'apply') {
  pkg.main = 'dist/index.js';
  pkg.types = 'dist/index.d.ts';
  pkg.exports = {
    '.': {
      types: './dist/index.d.ts',
      require: './dist/index.js',
      import: './dist/index.js',
      default: './dist/index.js',
    },
    './package.json': './package.json',
  };
} else if (mode === 'restore') {
  pkg.main = 'src/index.ts';
  pkg.types = 'src/index.ts';
  delete pkg.exports;
} else {
  console.error(`usage: pkg-dist.mjs <apply|restore>`);
  process.exit(1);
}

writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[pkg-dist] ${mode}: main=${pkg.main}`);
