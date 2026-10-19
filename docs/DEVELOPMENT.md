<!-- generated-by: gsd-doc-writer -->
# Development

This guide covers local work on `gsd-for-omp`, an independently maintained CommonJS OMP extension plugin. End-user installation and recovery steps are in [Getting Started](GETTING-STARTED.md); the module boundaries are documented in [Architecture](ARCHITECTURE.md).

## Local setup

The package requires Node.js `>=24.0.0` and resolves `@opengsd/gsd-core` from the package dependency (`^1.11.0`). From a checkout:

```bash
git clone https://github.com/GManzato/gsd-for-omp.git
cd gsd-for-omp
npm install
```

Use `npm install` for an editable development checkout. CI uses the lockfile-reproducible form:

```bash
npm ci
```

The repository has no `.env` setup step. Keep host experiments isolated from a developer's OMP profile by choosing a temporary runtime root:

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" node bin/gsd-for-omp.cjs install
```

The installer defaults to `~/.omp/agent` when `PI_CODING_AGENT_DIR` is absent. The extension wrapper receives that runtime root and projected skills are discovered from its `skills/` directory.

## Build, lint, and test commands

`package.json` defines the following developer-facing commands:

| Command | Description |
|---|---|
| `npm install` | Install dependencies for an editable checkout. |
| `npm ci` | Install exactly the versions in `package-lock.json`; used by CI. |
| `npm run lint` | Run `node --check` against the CLI and every CommonJS source/locale module. |
| `npm test` | Run the Node.js built-in test runner (`node --test`) across `test/`. |
| `npm pack --silent --ignore-scripts` | Create a package tarball without running lifecycle scripts; used to test the packed artifact. |

`prepack` is also defined as `npm run lint && npm test`. A normal pack that runs lifecycle scripts therefore validates syntax and tests before packing; the host smoke workflow intentionally uses `--ignore-scripts` and runs its own checks.

## Packed-package and host smoke workflow

To test what a consumer receives rather than loading the checkout directly, build and globally install the packed tarball:

```bash
package_tarball="$(npm pack --silent --ignore-scripts)"
npm install --global "./${package_tarball}"
```

Exercise the pinned OMP compatibility target in an isolated runtime:

```bash
npm install --global "@oh-my-pi/pi-coding-agent@17.0.3"
GSD_FOR_OMP_BIN=gsd-for-omp OMP_VERSION=17.0.3 node scripts/host-smoke.cjs
```

Repeat with the moving host channel:

```bash
npm install --global "@oh-my-pi/pi-coding-agent@latest"
GSD_FOR_OMP_BIN=gsd-for-omp OMP_VERSION=latest node scripts/host-smoke.cjs
```

`scripts/host-smoke.cjs` creates and removes its own temporary `PI_CODING_AGENT_DIR`, installs with `--json`, checks the EoS protocol/core range, validates `doctor` and `descriptor`, launches OMP in RPC mode, checks representative extension commands, and uninstalls the projection. It supplies a placeholder `OPENAI_API_KEY` when one is not present; the smoke test does not require a real key for these startup and state checks.

The compatibility boundary is intentional. OMP `17.0.3` has no `goal_updated` event, so the extension must remain loadable without Goal Mode. Newer OMP hosts may expose Goal Mode. For non-17 hosts, the smoke script retries OMP with an explicit `--tools read,write,gsd_invoke` selection when the tool is not in the default active set, then requires `gsd_invoke` to be discoverable.

## Code layout

```text
bin/gsd-for-omp.cjs          Global installer, updater, doctor, descriptor, and argument parser
src/eos.cjs              Protocol-v1 EoS handshake and OMP adapter construction
src/extension.cjs        OMP ExtensionAPI commands, tools, events, status, and Goal Mode bridge
src/projection.cjs       Runtime path rewriting and agent/skill projection
src/locale.cjs           POSIX locale detection and message lookup
src/locales/*.cjs        English and Simplified-Chinese CLI dictionaries
src/gsd-graphify-worker.cjs
                          Detached graphify worker used by the extension
scripts/host-smoke.cjs   Isolated packed-install and OMP RPC smoke test
scripts/bump-version.cjs Release-version metadata updater
 test/*.test.cjs         Node built-in unit and contract tests
```

The CLI resolves the installed GSD Core package, builds an EoS binding, and writes an extension wrapper plus projected agents and skills. `src/extension.cjs` is loaded by OMP and delegates orchestration to OMP's native task/event surfaces; it does not patch GSD Core. `src/projection.cjs` rewrites runtime paths and command names so projected content points at the selected OMP root.

## Pull requests and `main`

Develop on a branch, open a pull request, and wait for CI before merge. Every commit that lands on `main` and passes CI is released automatically (see below), so `main` must stay releasable.

A useful PR validation sequence is:

```bash
npm ci
npm run lint
npm test
```

For changes to installation, projection, extension registration, or host compatibility, also run the packed host smoke against both `17.0.3` and `latest` as shown above. The CI checks that gate the host are the Node 24 unit job and the two-version host-smoke matrix.

## Release workflow

`.github/workflows/release.yml` runs when CI finishes successfully for a push to `main`, and can also be started by hand (`gh workflow run release.yml`). Its behavior is automated:

1. Skip if `main` has moved past the commit CI tested; the newer commit's CI run releases it.
2. If `HEAD` already carries the `v<version>` tag from `package.json`, do nothing.
3. If `package.json` carries a version that has no tag yet (a manual minor or major bump), release that version as-is.
4. Otherwise increment the patch version with `node scripts/bump-version.cjs <semver>`, check it with `test/release-metadata.test.cjs`, and commit `chore: release gsd-for-omp v<version>` straight to `main`. The commit is pushed with `GITHUB_TOKEN`, so it does not start another CI or release run.
5. Tag the commit as `v<version>` and create the GitHub release, with notes listing the commit subjects since the previous release. That release is the source used by `gsd-for-omp update`.

To ship a minor or major version, bump `package.json` in a PR with `node scripts/bump-version.cjs <semver>`. Otherwise do not hand-edit release metadata in a feature PR; the workflow and `scripts/bump-version.cjs` keep `package.json`, `package-lock.json`, the README install URLs, and the changelog compare link aligned. If `main` is later protected by a ruleset, allow `github-actions` to bypass it so the release commit can be pushed.

## Related guides

- [Getting Started](GETTING-STARTED.md) — install and operate a released plugin.
- [Testing](TESTING.md) — test coverage and diagnosis.
- [Configuration](CONFIGURATION.md) — installer flags, environment variables, and ownership behavior.
- [Project README](../README.md) — public command surface and EoS contract.
