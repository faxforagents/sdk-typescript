#!/usr/bin/env node
// Generate src/version.ts from package.json so the two cannot drift. Runs on `npm version` and on
// `prepublishOnly`. Provenance: livetennisapi-oss/livetennisapi-js/scripts/sync-version.mjs (2026-10-28).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`sync-version: refusing to write a non-semver version: ${version}`);
  process.exit(1);
}

const target = join(root, 'src', 'version.ts');
const contents = `// GENERATED from package.json by scripts/sync-version.mjs. Do not edit by hand.
export const VERSION = '${version}';
`;

let current = null;
try {
  current = readFileSync(target, 'utf8');
} catch {
  current = null;
}

if (current === contents) {
  console.log(`sync-version: src/version.ts already at ${version}`);
} else {
  writeFileSync(target, contents);
  console.log(`sync-version: wrote src/version.ts = ${version}`);
}
