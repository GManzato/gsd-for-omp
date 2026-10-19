'use strict';

/**
 * Native task result ledger (.omp-task-results.json): parsing, locked persistence and recovery hints.
 */

const fs = require('node:fs');
const path = require('node:path');
const { normalizePhaseId, phaseArtifactInventory, taskResultPlanArtifactId } = require('./phases.cjs');
const { isGsdProject, planningFilePath, stateSnapshot } = require('./planning.cjs');

function taskResultsPath(cwd) {
  return planningFilePath(cwd, '.omp-task-results.json');
}

function readTaskResults(cwd) {
  try {
    const results = JSON.parse(fs.readFileSync(taskResultsPath(cwd), 'utf8'));
    if (!Array.isArray(results)) return [];
    return results.flatMap((result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const phase = normalizePhaseId(result.phase);
      const plan = typeof result.plan === 'string' ? result.plan.trim() : '';
      const task = typeof result.task === 'string' ? result.task.trim() : '';
      const status = typeof result.status === 'string' ? result.status.toLowerCase() : '';
      return phase && plan && task && ['completed', 'failed', 'cancelled'].includes(status)
        ? [{ ...result, phase, plan, task, status }]
        : [];
    });
  } catch {
    return [];
  }
}

function extractTaskResults(output) {
  const matches = String(output || '').matchAll(/\[gsd-task-result\]\s+phase\s+(\d+(?:\.\d+)?)\s+plan\s+([^\s]+)\s+task\s+([A-Za-z0-9_.-]+)\s+(completed|failed|cancelled)(?=$|[\s"'`<])/gi);
  return [...matches].flatMap(([, phase, plan, task, status]) => {
    const normalizedPhase = normalizePhaseId(phase);
    return normalizedPhase ? [{ phase: normalizedPhase, plan, task, status: status.toLowerCase() }] : [];
  });
}

function failedNativeTaskResults(event) {
  const progress = event?.details?.progress;
  if (!Array.isArray(progress)) return [];
  const results = [];
  for (const task of progress) {
    if (!['failed', 'aborted'].includes(task?.status) || typeof task?.id !== 'string') continue;
    const match = task.id.match(/^Phase(\d+(?:\.\d+)?)Plan([A-Za-z0-9_.-]+)Executor$/i);
    if (!match) continue;
    const [, phaseToken, compactPlan] = match;
    const phase = normalizePhaseId(phaseToken);
    if (!phase) continue;
    const compactPhase = phase.replace(/\D/g, '');
    const plan = /^\d+$/.test(compactPlan) && compactPlan.startsWith(compactPhase) && compactPlan.length > compactPhase.length
      ? `${phase}-${compactPlan.slice(compactPhase.length)}`
      : compactPlan;
    results.push({ phase, plan, task: task.id, status: task.status === 'aborted' ? 'cancelled' : 'failed' });
  }
  return results;
}

function nativeTaskRecovery(cwd) {
  if (!isGsdProject(cwd)) return null;
  const currentPhase = normalizePhaseId(stateSnapshot(cwd)?.phase);
  if (!currentPhase) return null;
  const completedPlanIds = phaseArtifactInventory(cwd, currentPhase)?.completedIds;
  const failures = readTaskResults(cwd).filter((entry) => {
    const phase = normalizePhaseId(entry?.phase);
    const planId = taskResultPlanArtifactId(phase, entry?.plan);
    return phase &&
      (phase === currentPhase) &&
      typeof entry.plan === 'string' && entry.plan &&
      typeof entry.task === 'string' && entry.task &&
      ['failed', 'cancelled'].includes(entry.status) &&
      !(planId && completedPlanIds?.has(planId));
  });
  if (!failures.length) return null;
  return { failures, command: `/gsd-execute-phase ${failures[0].phase}` };
}

function nativeTaskRecoveryLines(recovery, chinese) {
  if (!recovery) return [];
  const entries = recovery.failures.slice(0, 3).map(({ phase, plan, task, status }) => {
    const outcome = status === 'cancelled'
      ? (chinese ? '已取消' : 'cancelled')
      : (chinese ? '失败' : 'failed');
    return chinese
      ? `阶段 ${phase} / 计划 ${plan} / 任务 ${task}：${outcome}`
      : `Phase ${phase} / plan ${plan} / task ${task}: ${outcome}`;
  });
  const remaining = recovery.failures.length - entries.length;
  if (remaining) entries.push(chinese ? `另有 ${remaining} 个失败任务` : `${remaining} more failed task${remaining === 1 ? '' : 's'}`);
  return chinese
    ? [`原生任务恢复：${entries.join('；')}`, `恢复命令：${recovery.command}`]
    : [`Native task recovery: ${entries.join('; ')}`, `Recovery command: ${recovery.command}`];
}

/**
 * Per-instance writer; owns the cross-process lock sequence counter.
 */
function createTaskResultsWriter() {
  const taskResultsLockWait = new Int32Array(new SharedArrayBuffer(4));

  let taskResultsLockSequence = 0;

  function taskResultsLockOwnerPath(lockPath) {
    return path.join(lockPath, 'owner.json');
  }

  function taskResultsLockOwnerIsAlive(owner) {
    if (!Number.isInteger(owner?.pid) || owner.pid < 1) return false;
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  }

  function recoverAbandonedTaskResultsLock(lockPath) {
    let owner;
    try {
      owner = JSON.parse(fs.readFileSync(taskResultsLockOwnerPath(lockPath), 'utf8'));
    } catch {
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs < 1_000) return false;
      } catch (error) {
        return error?.code === 'ENOENT';
      }
    }
    if (owner && taskResultsLockOwnerIsAlive(owner)) return false;
    const quarantine = `${lockPath}.stale.${process.pid}.${++taskResultsLockSequence}`;
    try {
      fs.renameSync(lockPath, quarantine);
    } catch (error) {
      return error?.code === 'ENOENT';
    }
    try {
      fs.rmSync(quarantine, { recursive: true, force: true });
    } catch { /* a quarantined lock cannot block the active path */ }
    return true;
  }

  function acquireTaskResultsLock(cwd) {
    const lockPath = `${taskResultsPath(cwd)}.lock`;
    const token = `${process.pid}-${Date.now()}-${++taskResultsLockSequence}-${Math.random().toString(16).slice(2)}`;
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        fs.mkdirSync(lockPath);
        try {
          fs.writeFileSync(taskResultsLockOwnerPath(lockPath), JSON.stringify({ token, pid: process.pid }), { encoding: 'utf8', flag: 'wx' });
        } catch {
          try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch { /* best effort */ }
          return null;
        }
        return { lockPath, token };
      } catch (error) {
        if (error?.code !== 'EEXIST') return null;
      }
      if (recoverAbandonedTaskResultsLock(lockPath)) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      Atomics.wait(taskResultsLockWait, 0, 0, Math.min(20, remaining));
    }
  }

  function releaseTaskResultsLock(lock) {
    try {
      const owner = JSON.parse(fs.readFileSync(taskResultsLockOwnerPath(lock.lockPath), 'utf8'));
      if (owner?.token !== lock.token) return;
      fs.rmSync(lock.lockPath, { recursive: true, force: true });
    } catch { /* best effort; a dead-owner lock is recoverable */ }
  }

  function persistTaskResults(cwd, newResults) {
    if (!newResults.length) return true;
    const lock = acquireTaskResultsLock(cwd);
    if (!lock) return false;
    const target = taskResultsPath(cwd);
    const temporary = `${target}.${lock.token}.tmp`;
    try {
      const results = readTaskResults(cwd);
      for (const result of newResults) {
        const index = results.findIndex((entry) => entry.phase === result.phase && entry.plan === result.plan && entry.task === result.task);
        if (index === -1) results.push(result);
        else results[index] = result;
      }
      fs.writeFileSync(temporary, JSON.stringify(results, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, target);
      return true;
    } catch {
      try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ }
      return false;
    } finally {
      releaseTaskResultsLock(lock);
    }
  }

  return {
    persistTaskResults,
  };
}

module.exports = {
  createTaskResultsWriter,
  extractTaskResults,
  failedNativeTaskResults,
  nativeTaskRecovery,
  nativeTaskRecoveryLines,
};
