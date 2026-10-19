'use strict';

// Bump gsd-for-omp's version across package.json and package-lock.json, and roll
// the changelog: entries under `## [Unreleased]` move into a dated
// `## [<version>]` section and the compare links are updated. Idempotent:
// running with the current version is a no-op.
//
// Usage: node scripts/bump-version.cjs <semver> [root]
//
// `root` defaults to the repository root; it exists so tests can run the script
// against a fixture directory.

const fs = require('node:fs');
const path = require('node:path');

const REPO_URL = 'https://github.com/GManzato/gsd-for-omp';
const UNRELEASED_HEADING = '## [Unreleased]';
const UNRELEASED_LINK = /^\[Unreleased\]:\s+\S+\s*$/;

const version = process.argv[2];
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasEntries(lines) {
  return lines.some((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('###') && !/^<!--.*-->$/.test(trimmed);
  });
}

// Returns the rolled-over changelog text; throws on a malformed changelog.
function rollChangelog(text, previous, next, date) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === UNRELEASED_HEADING);
  if (start === -1) throw new Error(`CHANGELOG.md has no "${UNRELEASED_HEADING}" heading`);
  const linkIndex = lines.findIndex((line) => UNRELEASED_LINK.test(line));
  if (linkIndex === -1) throw new Error('CHANGELOG.md has no "[Unreleased]:" link line');
  if (lines.some((line) => line.startsWith(`## [${next}]`))) {
    throw new Error(`CHANGELOG.md already has a "## [${next}]" section`);
  }

  // The Unreleased section ends at the next version heading or, when it is the
  // only section, at the link block.
  let end = lines.findIndex((line, index) => index > start && (/^## \[/.test(line) || /^\[[^\]]+\]:\s/.test(line)));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  const content = hasEntries(body)
    ? body.join('\n').replace(/^\n+|\n+$/g, '')
    : '- Maintenance release.';

  const section = [UNRELEASED_HEADING, '', `## [${next}] - ${date}`, '', ...content.split('\n'), ''];
  const rolled = [...lines.slice(0, start), ...section, ...lines.slice(end)];
  const rolledLinkIndex = rolled.findIndex((line) => UNRELEASED_LINK.test(line));
  rolled.splice(
    rolledLinkIndex,
    1,
    `[Unreleased]: ${REPO_URL}/compare/v${next}...HEAD`,
    `[${next}]: ${REPO_URL}/compare/v${previous}...v${next}`,
  );
  return rolled.join('\n');
}

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  fail(`usage: node scripts/bump-version.cjs <semver> [root] (got: ${version})`);
}

const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const changelogPath = path.join(root, 'CHANGELOG.md');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

if (pkg.version === version) {
  console.log(`already at ${version}`);
  process.exit(0);
}

// Build every output before writing so a malformed changelog changes nothing.
let changelog;
try {
  changelog = rollChangelog(fs.readFileSync(changelogPath, 'utf8'), pkg.version, version, new Date().toISOString().slice(0, 10));
} catch (error) {
  fail(error.message);
}

pkg.version = version;
lock.version = version;
if (lock.packages && lock.packages['']) lock.packages[''].version = version;

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
fs.writeFileSync(changelogPath, changelog);

console.log(`bumped to ${version}`);
