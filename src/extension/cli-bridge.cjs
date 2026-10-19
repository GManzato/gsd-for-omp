'use strict';

/**
 * Bounded asynchronous bridge to the GSD Core CLI plus /gsd argument parsing and completion.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const { ENGINE_ROOT, NODE_BINARY } = require('./engine.cjs');

const MAX_CAPTURED_OUTPUT = 4 * 1024 * 1024;

const OUTPUT_TRUNCATION_MARKER = '\n[… output truncated …]';

// ── top-level command families (gsd-tools.cjs TOP_LEVEL_USAGE) ─────────────
// readCmdNames() (scripts/fix-slash-commands.cjs) reads commands/, which pi
// does NOT install (it ships a single native-extension file, no shared
// commands/ dir) — it would always return []. Keep this self-contained,
// complete snapshot aligned with `gsd-tools.cjs --help` so native completion
// exposes every supported top-level command. Regression coverage checks
// representative command families through the native completion callback.
const PI_COMMAND_FAMILIES = Object.freeze([
  'agent', 'agent-skills', 'assumption-delta', 'audit-open', 'audit-uat',
  'capability', 'check', 'check-commit', 'classify-confidence', 'commit',
  'commit-to-subrepo', 'config-ensure-section', 'config-get', 'config-new-project',
  'config-path', 'config-set', 'current-timestamp', 'detect-custom-files',
  'docs-init', 'drift-guard', 'effort', 'eval', 'extract-messages', 'find-phase',
  'from-gsd2', 'frontmatter', 'gap-analysis', 'generate-claude-md',
  'generate-claude-profile', 'generate-dev-preferences', 'generate-slug', 'git',
  'graphify', 'history-digest', 'init', 'intel', 'learnings', 'list-seeds',
  'list-todos', 'loop', 'migrate-config', 'milestone', 'normalize-test-command',
  'package-legitimacy', 'phase', 'phase-plan-index', 'phases', 'pr-subrepo',
  'profile-questionnaire', 'profile-sample', 'progress', 'project-instruction-file',
  'prompt-budget', 'quick-tasks-append', 'requirements', 'research-plan', 'research-store',
  'resolve-granularity', 'resolve-model', 'roadmap', 'scaffold', 'smart-entry',
  'state', 'task', 'template', 'user-story', 'validate', 'verify',
  'verify-path-exists', 'verify-summary', 'workstream', 'worktree',
]);

/**
 * Filter PI_COMMAND_FAMILIES by prefix (startsWith). Returns null when there
 * are no matches, per pi's `AutocompleteItem[]|null` contract.
 * @param {string} prefix
 * @returns {{value: string, label: string}[] | null}
 */
function getArgumentCompletions(prefix) {
  const p = typeof prefix === 'string' ? prefix : '';
  const matches = PI_COMMAND_FAMILIES.filter((name) => name.startsWith(p));
  if (matches.length === 0) return null;
  return matches.map((value) => ({ value, label: value }));
}

/**
 * Tokenize the raw `/gsd <args>` string into { family, subcommand, args }.
 * Reuses the quote-aware whitespace tokenizer already shipped for hooks
 * (hooks/lib/git-cmd.js's `tokenize`) rather than re-implementing shell-word
 * splitting a second time. #2102 Stage 2: pi's capability descriptor no
 * longer sets `hostBehaviors.skipSharedHooksInstall` (adversarial-review
 * finding #1/#2 — pi ships NO hooks/ with that flag set, so this require was
 * dead in a real install), so the shared hooks/ bundle — including
 * hooks/lib/git-cmd.js — is installed alongside the extension for real
 * (mirrors OpenCode, whose native plugin also spawns the staged hooks/*.js
 * bundle). The require below is therefore the PRIMARY, live path in an
 * installed pi tree; the whitespace-split fallback stays as defense-in-depth
 * for a corrupted/partial install (e.g. a user who deleted hooks/lib/ by
 * hand) rather than the only-ever-taken path.
 * @param {string} rawArgs
 * @returns {{ family: string, subcommand?: string, args: string[] }}
 */
function parseGsdCommandArgs(rawArgs) {
  let tokenize;
  try {
    ({ tokenize } = require(path.join(ENGINE_ROOT, 'hooks', 'lib', 'git-cmd.js')));
  } catch {
    tokenize = (s) => String(s || '').split(/\s+/).filter(Boolean);
  }
  const tokens = tokenize(typeof rawArgs === 'string' ? rawArgs : '');
  const family = tokens[0] || '--help';
  return {
    // Empty args and family-only input dispatch the CLI's own help surface;
    // do not pass an undefined subcommand to child_process.spawn.
    family,
    subcommand: tokens[1],
    args: tokens.length > 1 ? tokens.slice(2) : [],
  };
}

/**
 * Bind the bounded CLI subprocess bridge to this instance's CLI path and agents directory.
 */
function createCliBridge({ agentsDir, cliPath }) {
  function invokeAsync({ family = 'query', subcommand = 'help', args = [], cwd = process.cwd(), raw = false, signal }) {
    if (!cliPath) return Promise.resolve({ ok: false, stdout: '', stderr: `GSD CLI is unavailable beneath ${ENGINE_ROOT}`, exitCode: 1, cancelled: false });
    const commandFamily = typeof family === 'string' && family ? family : 'query';
    const commandArgs = Array.isArray(args) ? args : [];
    const cliArgs = [cliPath];
    if (commandFamily === '--help' || commandFamily === '-h') cliArgs.push(commandFamily);
    else cliArgs.push(commandFamily, subcommand || 'help', ...commandArgs);
    if (raw) cliArgs.push('--raw');
    return new Promise((resolve) => {
      let child;
      let stdout = '';
      let stderr = '';
      const appendOutput = (current, chunk) => {
        if (current.length >= MAX_CAPTURED_OUTPUT) return current;
        const value = String(chunk);
        const available = MAX_CAPTURED_OUTPUT - OUTPUT_TRUNCATION_MARKER.length - current.length;
        if (value.length <= available) return current + value;
        return current + value.slice(0, Math.max(0, available)) + OUTPUT_TRUNCATION_MARKER;
      };
      let cancelled = false;
      let settled = false;
      let killTimer;
      const abortListener = () => {
        cancelled = true;
        try { child.kill('SIGTERM'); } catch { /* close/error will settle the request */ }
        killTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already exited */ }
          finish(1);
        }, 250);
      };
      const cleanup = () => {
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', abortListener);
      };
      const finish = (exitCode, errorMessage = '') => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          ok: !cancelled && exitCode === 0,
          stdout,
          stderr: `${stderr}${errorMessage}`,
          exitCode: exitCode ?? 1,
          cancelled,
        });
      };
      try {
        child = spawn(NODE_BINARY, cliArgs, {
          cwd,
          env: { ...process.env, GSD_RUNTIME: 'omp', GSD_AGENTS_DIR: agentsDir },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        finish(1, error.message);
        return;
      }
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
      child.stderr.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });
      child.on('error', (error) => finish(1, error.message));
      child.on('close', (code) => finish(code ?? 1));
      if (signal?.aborted) abortListener();
      else signal?.addEventListener('abort', abortListener, { once: true });
    });
  }

  return {
    invokeAsync,
  };
}

module.exports = {
  PI_COMMAND_FAMILIES,
  createCliBridge,
  getArgumentCompletions,
  parseGsdCommandArgs,
};
