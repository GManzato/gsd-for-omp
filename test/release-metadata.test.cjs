'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

test('release metadata and install documentation use the package version', () => {
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const expectedInstall = `npm install --global https://github.com/GManzato/gsd-for-omp/archive/refs/tags/v${packageJson.version}.tar.gz`;

  assert.equal(packageLock.version, packageJson.version, 'package-lock.json version must match package.json');
  assert.equal(packageLock.packages[''].version, packageJson.version, 'lockfile root package version must match package.json');

  const versionedInstallDocs = ['README.md', 'README.zh-CN.md', 'docs/GETTING-STARTED.md'];
  for (const document of versionedInstallDocs) {
    const installCommands = fs.readFileSync(path.join(root, document), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('npm install --global https://github.com/GManzato/gsd-for-omp/archive/refs/tags/v'));

    assert.deepEqual(
      installCommands,
      [expectedInstall, expectedInstall],
      `${document} install and upgrade commands must both use v${packageJson.version}`,
    );
  }

  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.includes(`[Unreleased]: https://github.com/GManzato/gsd-for-omp/compare/v${packageJson.version}...HEAD`),
    'CHANGELOG.md Unreleased compare link must use the package version',
  );
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
