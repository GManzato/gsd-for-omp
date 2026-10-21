'use strict';

/**
 * Background "gsd-for-omp update available" check for GSD project sessions.
 *
 * Mirrors GSD Core's SessionStart update check: the registry lookup runs in the
 * background, its result is cached for a day, and failures never surface. The
 * extension shows at most one notification per instance plus a footer marker.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const packageJson = require('../../package.json');

const PACKAGE_NAME = packageJson.name;
const MANIFEST_NAME = '.gsd-for-omp-manifest.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAILED_CHECK_RETRY_MS = 60 * 60 * 1000;
const NPM_VIEW_TIMEOUT_MS = 15_000;
const MAX_NPM_OUTPUT = 64 * 1024;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

function enabledFlag(value) {
  return value !== undefined && value !== '' && !/^(0|false|no|off)$/i.test(String(value));
}

function updateCheckDisabled(env) {
  return enabledFlag(env.GSD_FOR_OMP_NO_UPDATE_CHECK)
    || enabledFlag(env.NO_UPDATE_NOTIFIER)
    || enabledFlag(env.CI);
}

function defaultCacheFile(env) {
  const cacheRoot = env.XDG_CACHE_HOME ? path.resolve(env.XDG_CACHE_HOME) : path.join(os.homedir(), '.cache');
  return path.join(cacheRoot, PACKAGE_NAME, 'update-check.json');
}

/**
 * Resolve the npm `latest` version through the user's npm configuration, the
 * same lookup `gsd-for-omp update` performs. Bounded, abortable, never throws.
 */
function npmLatestVersion({ signal, timeout = NPM_VIEW_TIMEOUT_MS, spawnChild = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let settled = false;
    let timeoutTimer;
    let killTimer;
    const finish = (version = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', stop);
      resolve(version);
    };
    function stop() {
      try { child?.kill('SIGTERM'); } catch { /* already exited */ }
      killTimer = setTimeout(() => {
        try { child?.kill('SIGKILL'); } catch { /* already exited */ }
        finish();
      }, 250);
    }
    if (signal?.aborted) {
      finish();
      return;
    }
    try {
      child = spawnChild('npm', ['view', PACKAGE_NAME, 'version', '--json'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      finish();
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_NPM_OUTPUT) stdout += chunk;
    });
    child.on('error', () => finish());
    child.on('close', (code) => {
      if (code !== 0) return finish();
      try {
        const version = JSON.parse(stdout);
        finish(typeof version === 'string' && parseVersion(version) ? version.trim() : null);
      } catch {
        finish();
      }
    });
    signal?.addEventListener('abort', stop, { once: true });
    timeoutTimer = setTimeout(stop, timeout);
  });
}

/**
 * Per-instance update check. Every dependency is injectable so tests never
 * touch the network or the user's cache directory.
 */
function createUpdateCheck({
  runtimeRoot,
  env = process.env,
  now = Date.now,
  currentVersion = packageJson.version,
  latestVersion = npmLatestVersion,
  cacheFile,
} = {}) {
  const cachePath = cacheFile || defaultCacheFile(env);
  let latest = null;
  let notice = null;
  let notified = false;
  let pending = null;
  let controller = null;

  function readCache() {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (!cached || typeof cached !== 'object' || !Number.isFinite(cached.checkedAt)) return null;
      return {
        checkedAt: cached.checkedAt,
        latest: parseVersion(cached.latest) ? cached.latest : null,
        ok: cached.ok === true,
      };
    } catch {
      return null;
    }
  }

  function writeCache(record) {
    const temporary = `${cachePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`);
      fs.renameSync(temporary, cachePath);
    } catch {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    }
  }

  function projectedVersion() {
    try {
      const version = JSON.parse(fs.readFileSync(path.join(runtimeRoot, MANIFEST_NAME), 'utf8'))?.version;
      return typeof version === 'string' ? version : null;
    } catch {
      return null;
    }
  }

  function computeNotice() {
    if (isNewerVersion(latest, currentVersion)) return { kind: 'available', latest, current: currentVersion, root: runtimeRoot };
    const projected = projectedVersion();
    if (projected && projected !== currentVersion) return { kind: 'reinstall', projected, current: currentVersion, root: runtimeRoot };
    return null;
  }

  function announce(onNotice) {
    notice = computeNotice();
    if (!notice || notified) return;
    notified = true;
    try { onNotice(notice); } catch { /* advisory only */ }
  }

  /**
   * Show what is already known (fresh or stale cache, projection drift) and
   * refresh the registry result in the background when the cache is stale.
   */
  function startUpdateCheck(onNotice) {
    if (updateCheckDisabled(env)) return;
    const cached = readCache();
    if (cached?.latest) latest = cached.latest;
    const age = cached ? now() - cached.checkedAt : Infinity;
    const fresh = age >= 0 && age < (cached?.ok ? CHECK_INTERVAL_MS : FAILED_CHECK_RETRY_MS);
    if (fresh || pending) {
      announce(onNotice);
      return;
    }
    // A stale cached version is still a valid lower bound for "newer than installed".
    if (isNewerVersion(latest, currentVersion)) announce(onNotice);
    controller = new AbortController();
    const { signal } = controller;
    pending = Promise.resolve()
      .then(() => latestVersion({ signal }))
      .catch(() => null)
      .then((version) => {
        if (signal.aborted) return;
        const resolved = parseVersion(version) ? String(version).trim() : null;
        writeCache({ checkedAt: now(), latest: resolved || latest, ok: Boolean(resolved) });
        if (resolved) latest = resolved;
        announce(onNotice);
      })
      .finally(() => {
        pending = null;
        controller = null;
      });
  }

  function cancelUpdateCheck() {
    controller?.abort();
  }

  return {
    cancelUpdateCheck,
    startUpdateCheck,
    updateNotice: () => notice,
    _pendingUpdateCheck: () => pending,
  };
}

function shellQuote(value) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The suggested command always names the active runtime root: a terminal
 * without this OMP session's PI_CODING_AGENT_DIR would otherwise target
 * ~/.omp/agent and leave a custom-root projection stale.
 */
function noticeCommand(notice, command) {
  return `gsd-for-omp ${command} --root ${shellQuote(notice.root)}`;
}

function updateNoticeMessage(notice, chinese) {
  if (notice.kind === 'available') {
    const command = noticeCommand(notice, 'update');
    return chinese
      ? `gsd-for-omp ${notice.latest} 已发布（当前 ${notice.current}）。请在终端运行 \`${command}\`，然后重启 OMP。`
      : `gsd-for-omp ${notice.latest} is available (installed ${notice.current}). Run \`${command}\` in a terminal, then restart OMP.`;
  }
  const command = noticeCommand(notice, 'install');
  return chinese
    ? `已安装 gsd-for-omp ${notice.current}，但 OMP 文件仍由 ${notice.projected} 生成。请在终端运行 \`${command}\`，然后重启 OMP。`
    : `gsd-for-omp ${notice.current} is installed but the OMP files were generated by ${notice.projected}. Run \`${command}\` in a terminal, then restart OMP.`;
}

function updateNoticeStatus(notice, chinese) {
  if (notice.kind === 'available') return chinese ? `⬆ 可更新 ${notice.latest}` : `⬆ ${notice.latest}`;
  return chinese ? '⬆ 需重新安装' : '⬆ reinstall';
}

module.exports = {
  createUpdateCheck,
  npmLatestVersion,
  updateCheckDisabled,
  updateNoticeMessage,
  updateNoticeStatus,
};
