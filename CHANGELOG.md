# Changelog

All notable changes to `gsd-for-omp` are recorded here in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The canonical changelog filename is **CHANGELOG.md**. See the [README](README.md) for the current installation and usage documentation. Entries up to 1.0.25 were released as `gsd-omp` from [tchivs/gsd-omp](https://github.com/tchivs/gsd-omp).

## [Unreleased]

### Changed

- Continued the project as `gsd-for-omp`, a fork of `tchivs/gsd-omp`. The npm package, CLI (`gsd-for-omp`), projected extension (`extensions/gsd-for-omp.ts`), ownership manifest (`.gsd-for-omp-manifest.json`), and locale override (`GSD_FOR_OMP_LOCALE`) are renamed accordingly. Remove an existing `gsd-omp` install (`gsd-omp uninstall && npm uninstall --global gsd-omp`) before installing `gsd-for-omp`: both register the same `/gsd-*` commands and agent names.

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

[Unreleased]: https://github.com/GManzato/gsd-for-omp/compare/v1.0.26...HEAD
[1.0.20]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.20
[1.0.19]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.19
[1.0.18]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.18
[1.0.17]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.17
