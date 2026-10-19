'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const bumpScript = path.join(root, 'scripts', 'bump-version.cjs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

test('release metadata and install documentation use the package version', () => {
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');

  assert.equal(packageLock.version, packageJson.version, 'package-lock.json version must match package.json');
  assert.equal(packageLock.packages[''].version, packageJson.version, 'lockfile root package version must match package.json');

  for (const document of ['README.md', 'README.zh-CN.md', 'docs/GETTING-STARTED.md']) {
    const text = fs.readFileSync(path.join(root, document), 'utf8');
    assert.ok(text.includes('npm install --global gsd-for-omp'), `${document} must document the npm install command`);
    assert.ok(!text.includes('archive/refs/tags/'), `${document} must not reference GitHub tag tarballs`);
  }

  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.split('\n').some((line) => line.startsWith(`## [${packageJson.version}]`)),
    'CHANGELOG.md must have a section for the package version',
  );
  assert.ok(
    changelog.includes(`[Unreleased]: https://github.com/GManzato/gsd-for-omp/compare/v${packageJson.version}...HEAD`),
    'CHANGELOG.md Unreleased compare link must use the package version',
  );
});

function bumpFixture(changelog, version = '1.2.4') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-for-omp-bump-'));
  try {
    const packageJson = { name: 'gsd-for-omp', version: '1.2.3' };
    const packageLock = { name: 'gsd-for-omp', version: '1.2.3', packages: { '': { name: 'gsd-for-omp', version: '1.2.3' } } };
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
    const result = spawnSync(process.execPath, [bumpScript, version, dir], { encoding: 'utf8' });
    const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
    return {
      result,
      changelog: read('CHANGELOG.md'),
      packageJson: JSON.parse(read('package.json')),
      packageLock: JSON.parse(read('package-lock.json')),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const FIXTURE_LINKS = [
  '[Unreleased]: https://github.com/GManzato/gsd-for-omp/compare/v1.2.3...HEAD',
  '[1.2.3]: https://github.com/GManzato/gsd-for-omp/compare/v1.2.2...v1.2.3',
  '[1.0.20]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.20',
].join('\n');

test('bump-version moves Unreleased entries into a dated section and updates links', () => {
  const { result, changelog, packageJson, packageLock } = bumpFixture([
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- New thing.',
    '',
    '## [1.2.3] - 2026-01-01',
    '',
    '- Older thing.',
    '',
    FIXTURE_LINKS,
    '',
  ].join('\n'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(packageJson.version, '1.2.4');
  assert.equal(packageLock.version, '1.2.4');
  assert.equal(packageLock.packages[''].version, '1.2.4');
  assert.match(changelog, /^# Changelog\n\n## \[Unreleased\]\n\n## \[1\.2\.4\] - \d{4}-\d{2}-\d{2}\n\n### Added\n\n- New thing\.\n\n## \[1\.2\.3\] - 2026-01-01\n/);
  assert.ok(changelog.includes([
    '[Unreleased]: https://github.com/GManzato/gsd-for-omp/compare/v1.2.4...HEAD',
    '[1.2.4]: https://github.com/GManzato/gsd-for-omp/compare/v1.2.3...v1.2.4',
    '[1.2.3]: https://github.com/GManzato/gsd-for-omp/compare/v1.2.2...v1.2.3',
    '[1.0.20]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.20',
  ].join('\n')));
  assert.equal(changelog.match(/^## \[Unreleased\]$/gm).length, 1);
});

test('bump-version writes a maintenance entry when Unreleased is empty', () => {
  const { result, changelog } = bumpFixture([
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '## [1.2.3] - 2026-01-01',
    '',
    '- Older thing.',
    '',
    FIXTURE_LINKS,
    '',
  ].join('\n'));

  assert.equal(result.status, 0, result.stderr);
  assert.match(changelog, /## \[Unreleased\]\n\n## \[1\.2\.4\] - \d{4}-\d{2}-\d{2}\n\n- Maintenance release\.\n\n## \[1\.2\.3\] - 2026-01-01\n/);
  assert.ok(!changelog.includes('### Added'), 'empty Unreleased subheadings must not leak into the release');
  assert.ok(changelog.includes('[1.2.4]: https://github.com/GManzato/gsd-for-omp/compare/v1.2.3...v1.2.4'));
});

test('bump-version fails loudly on a changelog without Unreleased markers and changes nothing', () => {
  const missingHeading = bumpFixture(`# Changelog\n\n## [1.2.3] - 2026-01-01\n\n- Older.\n\n${FIXTURE_LINKS}\n`);
  assert.notEqual(missingHeading.result.status, 0);
  assert.match(missingHeading.result.stderr, /Unreleased/);
  assert.equal(missingHeading.packageJson.version, '1.2.3');

  const missingLink = bumpFixture('# Changelog\n\n## [Unreleased]\n\n- Entry.\n\n## [1.2.3] - 2026-01-01\n\n- Older.\n');
  assert.notEqual(missingLink.result.status, 0);
  assert.match(missingLink.result.stderr, /\[Unreleased\]:/);
  assert.equal(missingLink.packageJson.version, '1.2.3');
});

test('bump-version is a no-op when already at the requested version', () => {
  const changelog = `# Changelog\n\n## [Unreleased]\n\n- Entry.\n\n${FIXTURE_LINKS}\n`;
  const { result, changelog: after, packageJson } = bumpFixture(changelog, '1.2.3');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(packageJson.version, '1.2.3');
  assert.equal(after, changelog);
});

test('bundled gsd-core dependency cannot resolve below the declared engines.gsd minimum', () => {
  const packageJson = readJson('package.json');
  const minimum = /^>=(\d+\.\d+\.\d+)$/.exec(packageJson.engines.gsd);
  const floor = /^\^(\d+\.\d+\.\d+)$/.exec(packageJson.dependencies['@opengsd/gsd-core']);
  assert.ok(minimum, `engines.gsd must be a >=x.y.z range; got ${packageJson.engines.gsd}`);
  assert.ok(floor, 'the @opengsd/gsd-core dependency must be a ^x.y.z range');
  const parts = (version) => version.split('.').map(Number);
  const [a, b] = [parts(floor[1]), parts(minimum[1])];
  const comparison = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  assert.ok(comparison >= 0, `dependency floor ${floor[1]} is below engines.gsd ${minimum[1]}`);
});
