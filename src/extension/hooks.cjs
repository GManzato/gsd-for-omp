'use strict';

/**
 * Bounded subprocess bridge to GSD hook scripts and the PreToolUse guard flow.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ENGINE_ROOT, NODE_BINARY } = require('./engine.cjs');
const { isGsdProject } = require('./planning.cjs');

/**
 * Bounded asynchronous subprocess bridge to GSD's Claude Code hook scripts.
 * Hook checks still gate their own tool call, but never block OMP's event loop.
 * Missing hooks, spawn errors, malformed input, and timeouts silently allow the
 * tool call so a hook failure cannot disable Pi.
 * @param {string} hookFile  filename under hooks/, e.g. "gsd-context-monitor.js"
 * @param {object} payload
 * @param {{ timeout?: number, cwd?: string, spawnChild?: typeof spawn }} [opts]
 * @returns {Promise<{ stdout: string, exitCode: number, timedOut: boolean }>}
 */
function runHook(hookFile, payload, opts = {}) {
  const hookPath = path.join(ENGINE_ROOT, 'hooks', hookFile);
  if (!fs.existsSync(hookPath)) return Promise.resolve({ stdout: '', exitCode: 0, timedOut: false });
  const timeout = opts.timeout || 8000;
  const spawnChild = opts.spawnChild || spawn;
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let timedOut = false;

    let settled = false;
    let timeoutTimer;
    let killTimer;
    const finish = (exitCode = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      resolve({ stdout: stdout.trim(), exitCode, timedOut });
    };
    try {
      child = spawnChild(NODE_BINARY, [hookPath], {
        cwd: opts.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      finish();
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', () => finish());
    child.on('close', (code) => finish(code ?? 0));
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        // A child that never reports close/error must not leave the tool call
        // pending forever. Its hook verdict is deliberately fail-open.
        finish();
      }, 250);
    }, timeout);
    try {
      child.stdin.end(JSON.stringify(payload || {}));
    } catch {
      child.kill('SIGTERM');
      finish();
    }
  });
}

function claudeToolName(toolName) {
  return {
    bash: 'Bash',
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    task: 'Task',
    web_search: 'WebSearch',
    web_fetch: 'WebFetch',
  }[toolName] || toolName;
}

function claudeToolInput(input) {
  const value = input && typeof input === 'object' ? input : {};
  const filePath = value.path || value.filePath || value.file_path || value.file;
  const toolInput = filePath ? { ...value, file_path: filePath } : { ...value };
  if (typeof value.input === 'string' && typeof toolInput.new_string !== 'string') toolInput.new_string = value.input;
  return toolInput;
}

function hookOutcome(result) {
  if (!result.stdout && result.exitCode !== 2) return null;
  let parsed;
  try { parsed = result.stdout ? JSON.parse(result.stdout) : null; } catch { parsed = null; }
  const block = result.exitCode === 2 || parsed?.decision === 'block';
  const advisory = parsed?.hookSpecificOutput?.additionalContext;
  return {
    block,
    reason: parsed?.reason || 'Blocked by a GSD hook.',
    advisory: typeof advisory === 'string' ? advisory : null,
  };
}

/**
 * PreToolUse hook flow; `state.advisedFiles` deduplicates advisories per file and hook.
 */
function createToolHooks({ pi, state }) {
  const { advisedFiles } = state;

  async function preToolHookOutcome(event, ctx) {
    if (!isGsdProject(ctx.cwd)) return { advisories: [] };
    const toolName = claudeToolName(event?.toolName);
    const toolInput = claudeToolInput(event?.input);
    const payload = { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: ctx.cwd };
    const hookFiles = [];
    if (toolName === 'Write' || toolName === 'Edit') hookFiles.push('gsd-prompt-guard.js', 'gsd-read-guard.js');
    if (toolName === 'Write' || toolName === 'Edit') hookFiles.push('gsd-worktree-path-guard.js');
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Bash') hookFiles.push('gsd-workflow-guard.js');
    const advisories = [];
    for (const hookFile of hookFiles) {
      const outcome = hookOutcome(await runHook(hookFile, payload, { timeout: 5000, cwd: ctx.cwd }));
      if (!outcome) continue;
      if (outcome.block) return outcome;
      if (!outcome.advisory) continue;
      const advisoryKey = `${toolInput.file_path ? path.resolve(ctx.cwd, toolInput.file_path) : event?.toolCallId || ''}\u0000${hookFile}`;
      if (advisedFiles.has(advisoryKey)) continue;
      advisedFiles.add(advisoryKey);
      advisories.push({ hookFile, content: outcome.advisory });
    }
    return { advisories };
  }

  async function queueHookAdvisories(advisories) {
    if (!advisories.length) return;
    await pi.sendMessage({
      customType: advisories.every((entry) => entry.hookFile === 'gsd-workflow-guard.js') ? 'gsd-workflow-advisory' : 'gsd-hook-advisory',
      content: advisories.map((entry) => entry.content).join('\n\n'),
      display: true,
    }, { deliverAs: 'nextTurn', triggerTurn: false });
  }

  return {
    preToolHookOutcome,
    queueHookAdvisories,
  };
}

module.exports = {
  createToolHooks,
  runHook,
};
