<!-- generated-by: gsd-doc-writer -->
# Getting Started

`gsd-for-omp` is an Oh My Pi (OMP) host plugin that exposes the GSD orchestration commands, projected agents and skills, and the native OMP status surface in an OMP session.

For the architecture and runtime boundaries, see [Architecture](ARCHITECTURE.md). For the complete environment and flag reference, see [Configuration](CONFIGURATION.md).

## Prerequisites

- Node.js `>=24.0.0`.
- Oh My Pi with native `ExtensionAPI` support. The repository's CI exercises OMP `17.0.3` and `latest`.
- GSD Core `>=1.12.0`, installed automatically with `gsd-for-omp` as a dependency.
- A project directory in which GSD can create its `.planning/` state when you start a GSD workflow.

## Installation

Install the latest release from the npm registry:

```bash
npm install --global gsd-for-omp
```

If OMP is not already installed, install a host version covered by the compatibility checks (the pinned fallback is OMP `17.0.3`):

```bash
npm install --global "@oh-my-pi/pi-coding-agent@17.0.3"
```

Set `PI_CODING_AGENT_DIR` before projection when you want a non-default OMP runtime root. Without it, the installer uses `~/.omp/agent`.

```bash
export PI_CODING_AGENT_DIR="$HOME/.omp/agent"
gsd-for-omp install
```

`gsd-for-omp install` writes the managed extension, projected GSD agents and skills, and `.gsd-for-omp-manifest.json` below that runtime root. If `GSD_AGENTS_DIR` is already set, the in-session extension preserves that value; otherwise it exposes `<runtime-root>/agents` to GSD Core so agent discovery uses the projected files.

Restart OMP after installation. OMP loads the extension at session startup, so an existing session does not automatically acquire the new commands.

## First run

1. Start or restart OMP in a GSD project.
2. Check the integration from the shell:

   ```bash
   gsd-for-omp doctor
   gsd-for-omp descriptor
   ```

3. In OMP, inspect the project and choose the next action:

   ```text
   /gsd-status
   /gsd-next
   ```

A healthy `doctor` result reports `"ok": true`, profile `programmatic-cli`, protocol version `1`, and no missing or modified files. `descriptor` reports the same protocol/profile contract without inspecting a particular project.

## Commands

The extension registers these native commands and the `gsd_invoke` tool. OMP also receives a command for every other projected `gsd-*` skill found in the runtime root's `skills/` directory. Run `/gsd <family> help` (or `gsd_invoke` with `subcommand: "help"`) for the `gsd-tools` CLI behind `/gsd`.

**Entry and status**

- `/gsd-next` — show or prepare the next GSD action.
- `/gsd-status` — project summary, context budget, and native job state; accepts `--compact`, `--stop`, `--branch ENTRY_ID`, `--tree ENTRY_ID [--summarize]`, `--switch SESSION_PATH`, and `--reload`.
- `/gsd-progress` — show progress or advance through the gated next-step workflow.
- `/gsd <family> <subcommand> [args]` — call the public `gsd-tools` CLI directly.

**Project lifecycle**

- `/gsd-new-project`, `/gsd-new-milestone` — initialize a project or start a milestone with native OMP questions.
- `/gsd-resume-work`, `/gsd-pause-work` — restore a project, or write a context handoff.
- `/gsd-complete-milestone` — archive a verified milestone.

**Phase planning**

- `/gsd-spec-phase <n>` — clarify what a phase delivers.
- `/gsd-discuss-phase <n>` — gather phase context through questions.
- `/gsd-plan-phase <n>` — create the phase plan.
- `/gsd-mvp-phase <n>` — plan a vertical MVP phase.
- `/gsd-ui-phase <n>`, `/gsd-ai-integration-phase <n>` — create a UI or AI design contract.

**Execution and verification**

- `/gsd-execute-phase <n>` — execute a phase through OMP native task waves.
- `/gsd-verify-work <n>` — verify a completed phase through conversational UAT.
- `/gsd-code-review <n>` — review a phase through native task dispatch.
- `/gsd-add-tests <n>` — generate phase tests through native approvals.
- `/gsd-validate-phase <n>`, `/gsd-secure-phase <n>` — audit Nyquist validation coverage, or verify threat mitigations.

**Quality audits**

- `/gsd-ui-review` — audit a completed phase's UI.
- `/gsd-eval-review` — audit an AI phase's evaluation coverage.
- `/gsd-audit-uat` — audit outstanding UAT items.
- `/gsd-audit-milestone` — audit milestone readiness.
- `/gsd-debug` — run debugging through native questions and tasks.
- `/gsd-audit-fix` — audit-to-fix pipeline through native tasks.

**Ship and git**

- `/gsd-ship <n>` — ship verified work.
- `/gsd-update` — update GSD through native preflight and approval gates.
- `/gsd-undo` — revert GSD commits through native approval gates.
- `/gsd-pr-branch` — build a filtered PR branch through native preview and approval gates.

**Fast paths and administration**

- `/gsd-quick`, `/gsd-fast` — run a quick task, or a trivial task inline.
- `/gsd-autonomous` — run the remaining milestone phases through native orchestration.
- `/gsd-import` — import external plans with conflict gates.
- `/gsd-phase` — add, insert, remove, or edit roadmap phases.
- `/gsd-settings` — configure GSD workflow settings.
- `/gsd-workspace`, `/gsd-workstreams` — manage workspaces and parallel workstreams.

`/gsd-status` is the single user-facing status entry. `Ctrl+Shift+G` (or the `--gsd-status` flag at startup) opens a live overlay; press `e` to edit the pending GSD action in OMP's editor and `Esc` to close it. The `/gsd-update` command updates GSD's own workflows; to update this plugin, use `gsd-for-omp update` from the shell.

## OMP compatibility and Goal Mode

The plugin's core integration works on both OMP `17.0.3` and `latest` as exercised by CI. OMP `17.0.3` is the pinned fallback when a newer host introduces an incompatible extension change.

Goal Mode is optional host capability, not a prerequisite:

- Hosts that emit OMP's `goal_updated` event (newer hosts, including a compatible `latest`) are mirrored in `/gsd-status`, the footer, widget, and overlay. The latest state can be restored from the OMP session journal.
- OMP `17.0.3` has no `goal_updated` event. The extension catches that registration failure and keeps commands, tools, status, projection, and the rest of the GSD integration active.
- While a Goal Mode objective is active, `gsd-for-omp` leaves the pending GSD next action in place and does not start a competing continuation loop. Run `/goal pause` or `/goal drop`, then run `/gsd-next`.

The plugin does not take over OMP's GoalRuntime; it only consumes the optional event and session-journal state when the host provides them.

## Upgrade

The update command asks the npm registry for the latest `gsd-for-omp` version, installs it globally when it is newer than the running one, and re-projects the managed files with the freshly installed CLI:

```bash
gsd-for-omp update
```

Restart OMP after a successful update. If the registry cannot be reached, run the steps manually:

```bash
npm install --global gsd-for-omp@latest
gsd-for-omp install
```

The update also upgrades the plugin's bundled GSD Core dependency. It does not update an OMP-managed engine tree; use OMP's own update path for the host itself.

## Uninstall

Remove managed projections before removing the global installer:

```bash
gsd-for-omp uninstall
npm uninstall --global gsd-for-omp
```

The installer is ownership-aware. It preserves files that were changed after installation and reports them as skipped. To intentionally replace or remove a modified GSD-owned projection, pass `--force`:

```bash
gsd-for-omp install --force
gsd-for-omp uninstall --force
```

Use `--force` only when the local changes are disposable.

## Common troubleshooting

### `doctor` reports missing or modified files

Run the JSON form to see the exact runtime root and paths:

```bash
gsd-for-omp doctor --json
```

Confirm that `PI_CODING_AGENT_DIR` is the same value used during installation, then restart OMP. A modified managed file is intentionally not overwritten; inspect or preserve the local edit, or deliberately re-project with `gsd-for-omp install --force`.

### GSD reports that agents are missing

`PI_CODING_AGENT_DIR` controls where the installer writes projections, while `GSD_AGENTS_DIR` controls where GSD Core searches. If you manage the projection yourself, export the agents directory before starting OMP:

```bash
export GSD_AGENTS_DIR="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}/agents"
```

Then restart OMP and run `/gsd-status` again. Do not point `GSD_AGENTS_DIR` at a directory that does not contain the projected `gsd-*.md` files.

### Goal Mode commands or status are unavailable

This is expected on OMP `17.0.3`: Goal Mode is optional and depends on `goal_updated`. The GSD commands remain usable; run `/gsd-status` and `/gsd-next` normally. On a newer host, pause or drop an active objective before asking GSD to continue:

```text
/goal pause
/gsd-next
```

### `update` cannot check the npm registry

The update command runs `npm view gsd-for-omp version`. If that fails (offline, proxy, or registry policy), follow the manual install sequence above, then run `gsd-for-omp doctor` and restart OMP.

### The extension is not visible after installing

OMP reads extensions at startup. Restart OMP, confirm `gsd-for-omp install` targeted the intended `PI_CODING_AGENT_DIR`, and use `gsd-for-omp descriptor` to confirm the local CLI's protocol declaration.

## Next steps

- [Configuration](CONFIGURATION.md) — environment variables, CLI flags, ownership, and Goal Mode coordination.
- [Architecture](ARCHITECTURE.md) — module boundaries, projection, and OMP integration.
- [Development](DEVELOPMENT.md) — local changes, packaging, and host smoke checks.
- [Testing](TESTING.md) — unit tests, host validation, CI matrix, and failure diagnosis.
- [Project README](../README.md) — overview and quick start.
