#!/usr/bin/env node
/**
 * Summarise the licences of installed dependencies.
 *
 * Usage:
 *   node scripts/dependency-licences.mjs            # report only
 *   node scripts/dependency-licences.mjs --strict   # exit 1 on licences that need a decision
 *
 * "Needs a decision" means unknown/missing, or a strong copyleft licence (GPL/AGPL/SSPL) in a
 * dependency that would be distributed inside a build. Permissive and weak-copyleft licences are
 * reported but do not fail. This tool does not give legal advice.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['apps/web/node_modules', 'services/server/node_modules', 'apps/desktop/node_modules'];
const strict = process.argv.includes('--strict');
const NEEDS_DECISION = /(^|\W)(A?GPL|SSPL|UNKNOWN|UNLICENSED|SEE LICENSE)(\W|$)/i;
const isFlagged = (licence) =>
  licence === '(none)' || licence === '(unreadable)' || NEEDS_DECISION.test(licence);
const seen = new Map();
let total = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      walk(full);
      continue;
    }
    const manifest = join(full, 'package.json');
    try {
      if (statSync(manifest).isFile()) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        const key = `${pkg.name ?? entry.name}@${pkg.version ?? '?'}`;
        const licence =
          typeof pkg.license === 'string'
            ? pkg.license
            : Array.isArray(pkg.licenses)
              ? pkg.licenses.map((l) => l.type ?? l).join(' OR ')
              : pkg.license?.type ?? '';
        if (!seen.has(key)) {
          seen.set(key, licence || '(none)');
          total += 1;
        }
      }
    } catch {
      // A broken or partial install: report by directory name.
      if (!seen.has(entry.name)) {
        seen.set(entry.name, '(unreadable)');
        total += 1;
      }
    }
    const nested = join(full, 'node_modules');
    try {
      if (statSync(nested).isDirectory()) walk(nested);
    } catch {
      // no nested tree
    }
  }
}

for (const root of roots) walk(root);

if (!total) {
  console.error('No installed dependencies found. Run npm ci in each package first.');
  process.exit(2);
}

const byLicence = new Map();
const flagged = [];
for (const [pkg, licence] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  const list = byLicence.get(licence) ?? [];
  list.push(pkg);
  byLicence.set(licence, list);
  if (isFlagged(licence)) flagged.push(`${pkg} — ${licence}`);
}

console.log(`Installed packages: ${total}\n`);
for (const [licence, packages] of [...byLicence].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(packages.length).padStart(5)}  ${licence}`);
}

if (flagged.length) {
  console.log(`\nNeeds a decision (${flagged.length}):`);
  for (const line of flagged) console.log(`  - ${line}`);
  if (strict) {
    console.error('\nStrict mode: resolve the packages above before distributing a build.');
    process.exit(1);
  }
} else {
  console.log('\nNo unknown or strong-copyleft dependencies found.');
}
