# GSD for Oh My Pi

[![CI](https://img.shields.io/github/actions/workflow/status/GManzato/gsd-for-omp/ci.yml?branch=main&logo=githubactions&logoColor=white&label=CI)](https://github.com/GManzato/gsd-for-omp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/gsd-for-omp?logo=npm&label=npm)](https://www.npmjs.com/package/gsd-for-omp)
[![License: MIT](https://img.shields.io/github/license/GManzato/gsd-for-omp?color=blue)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org)

**English** · [简体中文](./README.zh-CN.md)

`gsd-for-omp` is an Oh My Pi (OMP) host plugin for the [GSD Embeddable Orchestration System](https://github.com/open-gsd/gsd-core/blob/next/docs/explanation/embeddable-orchestration-system.md). It binds OMP's native extension, command, event, task, and filesystem surfaces to GSD through protocol version 1 of the public Host-Integration SDK. On hosts that expose Goal Mode, it mirrors optional goal state in the GSD status surfaces without taking ownership of OMP's GoalRuntime.

This project is third-party software. It is not endorsed, reviewed, or maintained by OpenGSD. It is a fork of [tchivs/gsd-omp](https://github.com/tchivs/gsd-omp), continued as an independent project.

## Requirements

- Node.js 24 or newer
- Oh My Pi with native ExtensionAPI support
- GSD Core 1.12.0 or newer, installed automatically as a dependency of this package

## Install

```bash
npm install --global gsd-for-omp
gsd-for-omp install
```

`gsd-for-omp install` projects the managed extension, agents, and skills into OMP (`~/.omp/agent`, or `PI_CODING_AGENT_DIR` when set). Restart OMP afterwards, then check the install:

```bash
gsd-for-omp doctor
```

A healthy install reports `"ok": true`, EoS profile `programmatic-cli`, and protocol version `1`.

## Usage

In an OMP session, inside a project:

```text
/gsd-next                           # show or prepare the next GSD action
/gsd-status                         # project summary, context budget, native job state
/gsd-progress                       # show progress or advance the gated next step
/gsd-plan-phase 1                   # plan a phase
/gsd-execute-phase 1                # execute a phase through OMP native task waves
/gsd <family> <subcommand> [args]   # call the public gsd-tools CLI directly
```

The `gsd_invoke` tool gives agents structured access to the same `gsd-tools` CLI. Every `/gsd-*` command appears in OMP's command list; the full catalog is in [Getting Started](docs/GETTING-STARTED.md#commands).

## OMP integration

- **Status overlay** — `Ctrl+Shift+G` opens a live GSD status overlay (also available at startup with the `--gsd-status` flag); a widget and footer show the same state.
- **Update notice** — in GSD projects, a notification and a `⬆` footer marker appear when a newer `gsd-for-omp` is published; the npm check runs in the background at most once a day. Opt out with `GSD_FOR_OMP_NO_UPDATE_CHECK=1`.
- **Native controls** — `/gsd-status` accepts `--compact`, `--stop`, `--branch`, `--tree`, `--switch`, and `--reload` for OMP's native session controls.
- **Goal Mode** — when the host emits `goal_updated`, the objective, status, and token budget are mirrored in `/gsd-status`; pause or drop the goal (`/goal pause`, `/goal drop`) before `/gsd-next`. Hosts without it, such as OMP 17, keep everything else.
- **Phase execution** — `/gsd-execute-phase` dispatches executors as isolated OMP tasks, so it needs `task.isolation.enabled: true` with plan mode off (`--interactive` runs inline without it). When the setting is not configured anywhere, it is turned on for the session; an explicit `false` is respected. See [Configuration](docs/CONFIGURATION.md#phase-execution-and-task-isolation).
- **Models** — OMP owns the model. Switch with OMP's `/model`; the GSD `model_profile` setting has no effect under OMP. See [Configuration](docs/CONFIGURATION.md#model-routing).

## Update and uninstall

```bash
gsd-for-omp update      # installs the newest version from npm and re-projects; restart OMP afterwards
gsd-for-omp uninstall   # remove managed OMP artifacts
npm uninstall --global gsd-for-omp
```

The installer refuses to overwrite unmanaged or locally modified files; see [Configuration](docs/CONFIGURATION.md#manifest-ownership-and---force) before using `--force`. Shell output is localized through `GSD_FOR_OMP_LOCALE`, `LC_ALL`, `LC_MESSAGES`, and `LANG` (English and Simplified Chinese); see [Configuration](docs/CONFIGURATION.md#environment-variables).

## Documentation

| Guide | Purpose |
|---|---|
| [Getting Started](docs/GETTING-STARTED.md) | Install, verify, use, upgrade, and troubleshoot; command catalog |
| [Architecture](docs/ARCHITECTURE.md) | Runtime boundaries, EoS contract, data flow, projection, and OMP integration |
| [Configuration](docs/CONFIGURATION.md) | Environment variables, CLI flags, model routing, manifest ownership, and Goal Mode coordination |
| [Development](docs/DEVELOPMENT.md) | Local development, packaging, host smoke tests, and release workflow |
| [Testing](docs/TESTING.md) | Unit-test and OMP host-validation guidance |
| [Contributing](./CONTRIBUTING.md) | Contribution, pull-request, and documentation guidelines |
| [CHANGELOG](./CHANGELOG.md) | Versioned release history |

## Attribution

The OMP extension began from the MIT-licensed pi reference host in `open-gsd/gsd-core` and was adapted into this independently maintained EoS plugin. The upstream Open GSD copyright notice is retained in `LICENSE`.

## License

MIT
