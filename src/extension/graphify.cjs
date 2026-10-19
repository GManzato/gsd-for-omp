'use strict';

/**
 * Opt-in graphify auto-update after HEAD-advancing git commands.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { NODE_BINARY } = require('./engine.cjs');
const { isGsdProject, readProjectConfig, resolvedPlanningPaths } = require('./planning.cjs');

const HEAD_ADVANCING_COMMAND = /git (?:commit|merge|pull|rebase --continue|cherry-pick)|gsd-tools query commit(?:\s|$)/;

function gitOutput(cwd, args) {
  try {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? String(result.stdout || '').trim() : '';
  } catch {
    return '';
  }
}

function graphifyAutoUpdateEnabled(cwd) {
  const config = readProjectConfig(cwd);
  return config?.graphify?.enabled === true && config.graphify.auto_update === true;
}

function executableOnPath(name, env = process.env) {
  const extensions = process.platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* continue searching */ }
    }
  }
  return null;
}

function graphifyDefaultBranch(cwd, config) {
  if (typeof config?.git?.base_branch === 'string' && config.git.base_branch.trim()) {
    return config.git.base_branch.trim();
  }
  for (const candidate of ['main', 'master', 'trunk']) {
    if (gitOutput(cwd, ['rev-parse', '--verify', candidate])) return candidate;
  }
  return '';
}

function graphifyLockIsLive(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    return true;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    try {
      return Date.now() - fs.statSync(lockPath).mtimeMs < 1_000;
    } catch {
      return true;
    }
  }
  const pid = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : 0;
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code === 'EPERM') return true;
    }
  }
  try { fs.unlinkSync(lockPath); } catch { /* already absent */ }
  return false;
}

function writeGraphifyStatus(statusPath, status) {
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
}

function removeOwnedGraphifyLock(lockPath, pid) {
  try {
    if (Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10) === pid) fs.unlinkSync(lockPath);
  } catch { /* already absent or replaced */ }
}

/**
 * Graphify auto-update bound to the shared runtime state (HEAD captured per bash tool call).
 */
function createGraphifyAutoUpdate({ state }) {
  const { graphifyHeadByCall } = state;

  function trackGraphifyHead(event, cwd) {
    const command = typeof event?.input?.command === 'string' ? event.input.command : '';
    if (String(event?.toolName || '').toLowerCase() !== 'bash'
      || typeof event?.toolCallId !== 'string'
      || !HEAD_ADVANCING_COMMAND.test(command)
      || process.env.CI) return;
    const projectPath = path.resolve(cwd);
    if (!isGsdProject(projectPath) || !graphifyAutoUpdateEnabled(projectPath)) return;
    const head = gitOutput(projectPath, ['rev-parse', 'HEAD']);
    if (head) graphifyHeadByCall.set(event.toolCallId, { cwd: projectPath, head });
  }

  function startGraphifyAutoUpdate(event, cwd) {
    const tracked = graphifyHeadByCall.get(event?.toolCallId);
    if (typeof event?.toolCallId === 'string') graphifyHeadByCall.delete(event.toolCallId);
    if (!tracked || event?.isError || tracked.cwd !== path.resolve(cwd) || process.env.CI) return false;

    const currentHead = gitOutput(tracked.cwd, ['rev-parse', 'HEAD']);
    if (!currentHead || currentHead === tracked.head || !graphifyAutoUpdateEnabled(tracked.cwd)) return false;
    const config = readProjectConfig(tracked.cwd);
    const currentBranch = gitOutput(tracked.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (currentBranch !== graphifyDefaultBranch(tracked.cwd, config)) return false;
    const graphifyBin = executableOnPath('graphify');
    if (!graphifyBin) return false;

    const graphDir = path.join(resolvedPlanningPaths(tracked.cwd).planning, 'graphs');
    const lockPath = path.join(graphDir, '.rebuild.lock');
    const statusPath = path.join(graphDir, '.last-build-status.json');
    try {
      fs.mkdirSync(graphDir, { recursive: true });
    } catch {
      return false;
    }
    if (graphifyLockIsLive(lockPath)) return false;

    const startedAt = Date.now();
    try {
      fs.writeFileSync(lockPath, String(process.pid), { encoding: 'utf8', flag: 'wx' });
      writeGraphifyStatus(statusPath, {
        ts: new Date(startedAt).toISOString(),
        status: 'running',
        exit_code: null,
        duration_ms: null,
        head_at_build: currentHead,
        graphify_version: null,
      });
      const child = spawn(NODE_BINARY, [path.join(__dirname, '..', 'gsd-graphify-worker.cjs'), JSON.stringify({
        graphifyBin,
        head: currentHead,
        startedAt,
        ownerPid: process.pid,
      })], {
        cwd: tracked.cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      if (!Number.isInteger(child.pid) || child.pid < 1) throw new Error('Graphify worker did not start');
      child.once('error', () => {
        removeOwnedGraphifyLock(lockPath, child.pid);
        removeOwnedGraphifyLock(lockPath, process.pid);
        try {
          writeGraphifyStatus(statusPath, {
            ts: new Date().toISOString(), status: 'failed', exit_code: 1,
            duration_ms: Math.max(0, Date.now() - startedAt), head_at_build: currentHead, graphify_version: null,
          });
        } catch { /* status is advisory */ }
      });
      child.unref();
      return true;
    } catch {
      removeOwnedGraphifyLock(lockPath, process.pid);
      return false;
    }
  }

  return {
    startGraphifyAutoUpdate,
    trackGraphifyHead,
  };
}

module.exports = {
  createGraphifyAutoUpdate,
};
