'use strict';

/**
 * Resolution of the GSD engine tree, the Node interpreter and per-instance runtime paths.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const GSD_CORE_REQUIRED = `gsd-for-omp: @opengsd/gsd-core ${require('../../package.json').engines.gsd} is required`;

// Resolve the GSD engine tree (the dir holding gsd-core/ + hooks/).
// Works across dev (<root>/pi/gsd.cjs → <root>) and installed layouts.
function resolveEngineRoot(startDir) {
  try {
    return path.dirname(require.resolve('@opengsd/gsd-core/package.json'));
  } catch {
    let dir = startDir;
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'gsd-core'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(GSD_CORE_REQUIRED);
  }
}

const ENGINE_ROOT = resolveEngineRoot(path.join(__dirname, '..'));

const GSD_CORE = path.join(ENGINE_ROOT, 'gsd-core');

/**
 * Resolve a real Node.js interpreter for the GSD child processes.
 *
 * OMP ships as a single-file Bun executable, so `process.execPath` inside this
 * extension points at `omp.bin` (hundreds of MB) — NOT at Node. Spawning
 * `process.execPath <hook>.js` therefore boots a second copy of the whole OMP
 * runtime per tool call instead of running an 18 KB hook script. Those copies
 * are short-lived, so high-frequency sessions (Write/Edit/Bash) repeatedly
 * start and stop them, peaking at ~400 MB RSS and ~1 CPU core each.
 *
 * Hooks, the graphify worker and the GSD Core CLI are all plain CommonJS, so
 * they must run under Node. Resolution order:
 *   1. GSD_NODE_BIN / OMP_NODE_BIN (explicit override)
 *   2. the Node that owns this install when the host really is Node
 *      (`process.execPath` is only trusted when `process.versions.node` exists
 *      AND the basename is not a Bun single-file runtime)
 *   3. Node shipped alongside the OMP install (PLUGIN_ROOT bin/, then PATH)
 *   4. a small set of conventional locations
 * Never silently return the Bun host: that is the regression this guards.
 */
function resolveNodeBinary() {
  const isBunHost = typeof Bun !== 'undefined' || process.versions.bun !== undefined;
  const explicit = [process.env.GSD_NODE_BIN, process.env.OMP_NODE_BIN].find(
    (value) => typeof value === 'string' && value.length > 0 && fs.existsSync(value),
  );
  if (explicit) return explicit;

  // A genuine Node host can always run its own child scripts.
  if (!isBunHost && process.versions.node && fs.existsSync(process.execPath)) {
    return process.execPath;
  }

  const pluginRoot = process.env.PLUGIN_ROOT || process.env.PI_PLUGIN_ROOT || '';
  const candidates = [
    pluginRoot ? path.join(pluginRoot, 'bin', 'node') : null,
    process.env.OMP_NODE_PATH || null,
    path.join(process.env.HOME || '', '.local', 'bin', 'node'),
    '/usr/local/bin/node',
    '/usr/bin/node',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore unreadable candidates and keep looking
    }
  }

  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim().split(/\r?\n/)[0];
  }

  // Last resort: the Bun host still executes the CommonJS entry point, so the
  // feature degrades instead of throwing (matching the fail-open contract).
  return process.execPath;
}

const NODE_BINARY = resolveNodeBinary();

/**
 * Per-instance runtime paths: the OMP runtime root, the GSD agents directory and
 * the GSD Core CLI entry point (undefined when the engine ships no gsd-tools.cjs).
 *
 * OMP's global config dir (~/.omp/agent) is not a registered gsd-core runtime
 * (registry has `pi`, not `omp`), so gsd-core's agent-install check resolves
 * the agents dir to the Claude fallback (~/.claude/agents) and reports every
 * GSD agent missing. Point the check at the plugin's real projection
 * (~/.omp/agent/agents) so init.progress / init.new-project stop warning
 * about unavailable research/roadmap agents.
 *
 * @param {{ runtimeRoot?: string }} [options]
 * @returns {{ runtimeRoot: string, agentsDir: string, cliPath: string | undefined }}
 */
function resolveRuntimePaths(options = {}) {
  const cliPath = [
    path.join(ENGINE_ROOT, 'gsd-core', 'bin', 'gsd-tools.cjs'),
    path.join(ENGINE_ROOT, 'bin', 'gsd-tools.cjs'),
  ].find(fs.existsSync);
  const runtimeRoot = path.resolve(options.runtimeRoot || path.join(os.homedir(), '.omp', 'agent'));
  const agentsDir = process.env.GSD_AGENTS_DIR || path.join(runtimeRoot, 'agents');
  if (!process.env.GSD_AGENTS_DIR) process.env.GSD_AGENTS_DIR = agentsDir;
  return { runtimeRoot, agentsDir, cliPath };
}

module.exports = {
  ENGINE_ROOT,
  GSD_CORE,
  NODE_BINARY,
  resolveNodeBinary,
  resolveRuntimePaths,
};
