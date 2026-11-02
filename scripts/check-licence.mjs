#!/usr/bin/env node
/**
 * Licence gate for CI. Fails if the repository is not consistently AGPL-3.0-only:
 *   - LICENSE exists and is the GNU Affero General Public License v3;
 *   - every first-party package manifest declares AGPL-3.0-only;
 *   - no separate licence file suggests a different licence for a subdirectory.
 *
 * This is a consistency check, not legal advice. It deliberately does not try to audit
 * third-party dependencies; run a dependency licence scan for that.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expected = 'AGPL-3.0-only';
const failures = [];

const read = (path) => readFileSync(join(root, path), 'utf8');

// 1. Licence text
try {
  const licence = read('LICENSE');
  if (!licence.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) {
    failures.push('LICENSE does not contain the GNU Affero General Public License text.');
  }
  if (!/Version 3, 19 November 2007/.test(licence)) {
    failures.push('LICENSE is not version 3 of the GNU Affero General Public License.');
  }
} catch {
  failures.push('LICENSE is missing.');
}

// 2. First-party manifests
const manifests = [
  'services/server/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
];
for (const path of manifests) {
  try {
    const pkg = JSON.parse(read(path));
    if (pkg.license !== expected) {
      failures.push(`${path} declares license ${JSON.stringify(pkg.license ?? null)}, expected "${expected}".`);
    }
  } catch (error) {
    failures.push(`${path} could not be read: ${error.message}`);
  }
}

// 3. No conflicting licence files below the root
const skippable = new Set(['node_modules', '.git', 'dist', 'build', 'release', '.gradle']);
function walk(dir) {
  for (const entry of readdirSync(join(root, dir))) {
    const relative = dir === '.' ? entry : `${dir}/${entry}`;
    const full = join(root, relative);
    if (skippable.has(entry)) continue;
    if (statSync(full).isDirectory()) {
      walk(relative);
      continue;
    }
    if (/^(LICEN[CS]E|COPYING)(\..*)?$/i.test(entry) && relative !== 'LICENSE') {
      failures.push(`Unexpected licence file ${relative}; this repository is licensed as a whole.`);
    }
  }
}
walk('.');

// 4. The README must state the licence, so the repo front page cannot disagree
try {
  if (!read('README.md').includes('AGPL-3.0-only')) {
    failures.push('README.md does not state AGPL-3.0-only.');
  }
} catch {
  failures.push('README.md is missing.');
}

if (failures.length) {
  console.error('Licence check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Licence check passed: ${expected}.`);
