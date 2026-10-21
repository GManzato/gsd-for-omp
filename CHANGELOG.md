# Changelog

All notable changes to `gsd-for-omp` are recorded here in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The canonical changelog filename is **CHANGELOG.md**. See the [README](README.md) for the current installation and usage documentation. Entries up to 1.0.25 were released as `gsd-omp` from [tchivs/gsd-omp](https://github.com/tchivs/gsd-omp).

## [Unreleased]

## [1.1.1] - 2026-10-21

### Security

- Updated the bundled `@opengsd/gsd-core` dependency to `^1.18.0` and refreshed its transitive dependencies to clear all open advisories: `@modelcontextprotocol/sdk` 1.32.1, `hono` 4.13.13, `@hono/node-server` 2.1.5, `fast-uri` 3.1.8, `ip-address` 10.7.4, `proxy-addr` 2.0.8, and `qs` 6.16.1. The exact `ip-address` 10.3.1 override was removed: it held the package at a vulnerable version, and the normal range now resolves to a patched release.

## [1.1.0] - 2026-10-19

### Changed

- Published to npm as `gsd-for-omp` through GitHub Actions trusted publishing (OIDC, with provenance). Install with `npm install --global gsd-for-omp`, then `gsd-for-omp install`; GitHub release tarball URLs are no longer used.
- `gsd-for-omp update` now queries the npm registry (`npm view gsd-for-omp version`) and installs the newer version with `npm install --global gsd-for-omp@<version>` before re-projecting. It no longer calls the GitHub API, so `GITHUB_TOKEN`/`GH_TOKEN` are not used.
- The README and docs were reorganized: the README is a short project overview, the command catalog moved to Getting Started, and the EoS contract table and model-routing explanation moved to Architecture and Configuration. The documentation also no longer claims that GSD Core's model catalog ships an empty `omp` tier map.
- Release builds roll the `## [Unreleased]` entries of this changelog into a dated version section automatically.

### Fixed

- The documented and enforced GSD Core minimum is now 1.12.0, read from `engines.gsd` in `package.json`; it was incorrectly reported as 1.11.0.
- `npm run lint` now syntax-checks every `.cjs` file under `bin/`, `src/`, `scripts/`, and `test/`, not a fixed list.

## [1.0.27] - 2026-10-19

### Changed

- Updated the bundled `@opengsd/gsd-core` dependency to `^1.17.0` (from `^1.12.0`).

## [1.0.26] - 2026-10-19

### Changed

- Continued the project as `gsd-for-omp`, a fork of `tchivs/gsd-omp`. The npm package, CLI (`gsd-for-omp`), projected extension (`extensions/gsd-for-omp.ts`), ownership manifest (`.gsd-for-omp-manifest.json`), and locale override (`GSD_FOR_OMP_LOCALE`) are renamed accordingly. Remove an existing `gsd-omp` install (`gsd-omp uninstall && npm uninstall --global gsd-omp`) before installing `gsd-for-omp`: both register the same `/gsd-*` commands and agent names.
- Every `main` commit that passes CI is now released automatically.

### Added

- `/gsd-execute-phase` asks the orchestrator to track the run with OMP's native `todo` tool: one item per wave plus the post-wave gates. Contributed by Andrii Panasiuk ([tchivs/gsd-omp#73](https://github.com/tchivs/gsd-omp/pull/73)).

### Fixed

- The projected `gsd-execute-phase` skill carries the same OMP executor dispatch contract as the `/gsd-execute-phase` command, so a skill-driven run no longer stops on GSD Core's `runtime 'omp' declares no executor-isolation primitive` gate. Contributed by Andrii Panasiuk ([tchivs/gsd-omp#74](https://github.com/tchivs/gsd-omp/pull/74)).
- Stopped projecting GSD Core `agents/*.compact.md` variants into the OMP agents directory. Each variant shares its base agent's `name`, and OMP registered the compact file in place of the full agent, so most GSD subagents ran with the compact prompt even when `workflow.compact_content` was off. This matches GSD Core's own installer (`hostBehaviors.skipCompactAgents`). `gsd-for-omp update` removes previously projected compact files; with `workflow.compact_content` enabled, GSD Core falls back to the full agent prompt under OMP ([tchivs/gsd-omp#75](https://github.com/tchivs/gsd-omp/pull/75)).

## [1.0.20] - 2026-08-29

### Added

- Integrated OMP Goal Mode through the optional `goal_updated` event. When the host provides that event, the plugin mirrors the goal objective, status, and token budget in `/gsd-status`, the footer, the widget, and the live status overlay.
- Restored the latest Goal Mode state from the OMP session journal when a session starts or reloads.

### Changed

- Added a continuation guard: while an active Goal Mode objective is running, GSD continuation prompts remain pending so the Goal Mode and GSD continuation loops do not compete. Pause or drop the goal before running `/gsd-next`.
- Kept Goal Mode host-owned and optional. Hosts without `goal_updated`, including OMP 17, retain the rest of the GSD integration and simply omit this optional status surface.

Related: [PR #57](https://github.com/tchivs/gsd-omp/pull/57), [release PR #58](https://github.com/tchivs/gsd-omp/pull/58).

## [1.0.19] - 2026-08-29

### Added

- Deepened native OMP integration around `/gsd-status`, including native controls for context compaction, stopping the current turn, branching and navigating the session tree, switching sessions, and reloading runtime state.
- Added OMP argument completion and session naming where projected skills expose stable parameter contracts.

### Changed

- Unified native task execution, context usage, compaction, retry, and asynchronous job state under the `/gsd-status` status surface, widget, footer, and overlay while keeping native task tracking internal.

Related: [PR #55](https://github.com/tchivs/gsd-omp/pull/55), [release PR #56](https://github.com/tchivs/gsd-omp/pull/56).

## [1.0.18] - 2026-08-29

### Changed

- Refined the OMP status widget layout with visual progress bars and clearer blocker and concern indicators.

Related: [PR #53](https://github.com/tchivs/gsd-omp/pull/53), [release PR #54](https://github.com/tchivs/gsd-omp/pull/54).

## [1.0.17] - 2026-08-29

### Changed

- Kept native task execution internal to the extension and removed the public `/omp-native` command.
- Directed native execution status and continuation guidance to `/gsd-status`; host smoke coverage verifies that `/omp-native` is not exposed.

Related: [PR #51](https://github.com/tchivs/gsd-omp/pull/51), [release PR #52](https://github.com/tchivs/gsd-omp/pull/52).

[Unreleased]: https://github.com/GManzato/gsd-for-omp/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/GManzato/gsd-for-omp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/GManzato/gsd-for-omp/compare/v1.0.27...v1.1.0
[1.0.27]: https://github.com/GManzato/gsd-for-omp/compare/v1.0.26...v1.0.27
[1.0.26]: https://github.com/GManzato/gsd-for-omp/compare/v1.0.25...v1.0.26
[1.0.20]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.20
[1.0.19]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.19
[1.0.18]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.18
[1.0.17]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.17
