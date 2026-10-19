'use strict';

/**
 * Ref-counted tracking of native GSD task calls, jobs and live execution progress.
 */

const path = require('node:path');

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'aborted', 'error', 'errored', 'succeeded', 'success', 'done', 'terminated']);

function taskInputFor(event) {
  const input = event?.input ?? event?.args;
  return input && typeof input === 'object' && !Array.isArray(input) ? input : null;
}

function gsdTaskInputItems(input) {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [input];
  return tasks.filter((task) => typeof task?.agent === 'string' && task.agent.startsWith('gsd-'));
}

function gsdTaskIdsFromInput(input) {
  return gsdTaskInputItems(input).flatMap((task) =>
    typeof task.name === 'string' && task.name ? [task.name] : []);
}

function nativeTaskDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const details = value.details;
  return details && typeof details === 'object' && !Array.isArray(details) ? details : value;
}

function nativeTaskActivityLines(count, chinese) {
  if (!count) return [];
  return [chinese
    ? `OMP 原生执行：${count} 个任务 · 使用 /gsd-status 查看详情。`
    : `OMP native execution: ${count} tasks · use /gsd-status for details.`];
}

/**
 * Per-instance native task tracker over the shared runtime state: ref-counted task ids, task calls and live execution progress.
 */
function createNativeTaskTracker({ state }) {
  const { activeGsdTaskIds, activeGsdTaskIdsByCall, activeGsdTaskRefCounts, nativeTaskExecutionByCall } = state;

  function taskIdsFor(cwd) {
    const projectPath = path.resolve(cwd);
    let taskIds = activeGsdTaskIds.get(projectPath);
    if (!taskIds) {
      taskIds = new Set();
      activeGsdTaskIds.set(projectPath, taskIds);
    }
    return taskIds;
  }

  function taskRefCountsFor(cwd) {
    const projectPath = path.resolve(cwd);
    let refs = activeGsdTaskRefCounts.get(projectPath);
    if (!refs) {
      refs = new Map();
      activeGsdTaskRefCounts.set(projectPath, refs);
    }
    return refs;
  }

  function retainTaskId(cwd, taskId) {
    taskIdsFor(cwd).add(taskId);
    const refs = taskRefCountsFor(cwd);
    refs.set(taskId, (refs.get(taskId) || 0) + 1);
  }

  function releaseTaskId(cwd, taskId) {
    const projectPath = path.resolve(cwd);
    const refs = activeGsdTaskRefCounts.get(projectPath);
    const count = refs?.get(taskId) || 0;
    if (count > 1) refs.set(taskId, count - 1);
    else {
      refs?.delete(taskId);
      activeGsdTaskIds.get(projectPath)?.delete(taskId);
    }
    if (refs?.size === 0) activeGsdTaskRefCounts.delete(projectPath);
    const taskIds = activeGsdTaskIds.get(projectPath);
    if (taskIds?.size === 0) activeGsdTaskIds.delete(projectPath);
  }

  function taskCallsFor(cwd) {
    const projectPath = path.resolve(cwd);
    let taskCalls = activeGsdTaskIdsByCall.get(projectPath);
    if (!taskCalls) {
      taskCalls = new Map();
      activeGsdTaskIdsByCall.set(projectPath, taskCalls);
    }
    return taskCalls;
  }

  function forgetTaskCallIds(cwd, settledIds) {
    const projectPath = path.resolve(cwd);
    const taskCalls = activeGsdTaskIdsByCall.get(projectPath);
    if (!taskCalls) return;
    for (const [callId, taskIds] of taskCalls) {
      const remaining = [...taskIds];
      for (const settledId of settledIds) {
        const index = remaining.indexOf(settledId);
        if (index >= 0) remaining.splice(index, 1);
      }
      if (remaining.length) taskCalls.set(callId, remaining);
      else taskCalls.delete(callId);
    }
    if (taskCalls.size === 0) activeGsdTaskIdsByCall.delete(projectPath);
  }

  function nativeTaskExecutionCallsFor(cwd) {
    const projectPath = path.resolve(cwd);
    let calls = nativeTaskExecutionByCall.get(projectPath);
    if (!calls) {
      calls = new Map();
      nativeTaskExecutionByCall.set(projectPath, calls);
    }
    return calls;
  }

  function nativeTaskExecutionState(cwd, event, details) {
    if (event?.toolName !== 'task' || typeof event.toolCallId !== 'string' || !event.toolCallId) return null;
    const inputItems = gsdTaskInputItems(taskInputFor(event));
    const progress = Array.isArray(details?.progress)
      ? details.progress.filter((task) => typeof task?.agent === 'string' && task.agent.startsWith('gsd-') && typeof task.id === 'string' && task.id)
      : null;
    const projectPath = path.resolve(cwd);
    const existingCalls = nativeTaskExecutionByCall.get(projectPath);
    const existing = existingCalls?.get(event.toolCallId);
    if (!inputItems.length && !progress?.length && !existing) return null;
    const calls = existingCalls || nativeTaskExecutionCallsFor(cwd);
    const now = Date.now();
    let execution = existing;
    if (!execution) {
      execution = {
        callId: event.toolCallId,
        startedAt: now,
        updatedAt: now,
        taskIds: [],
        progress: [],
      };
      calls.set(event.toolCallId, execution);
    }
    execution.updatedAt = now;
    if (typeof event.intent === 'string' && event.intent.trim()) execution.intent = event.intent.trim();
    const inputIds = inputItems.flatMap((task) => typeof task.name === 'string' && task.name ? [task.name] : []);
    if (inputIds.length) execution.taskIds = [...new Set([...execution.taskIds, ...inputIds])];
    if (progress?.length) {
      execution.progress = progress.slice(-64).map((task) => ({
        id: task.id,
        agent: task.agent,
        status: String(task.status || 'running').toLowerCase(),
        description: typeof task.description === 'string' ? task.description : undefined,
        currentTool: typeof task.currentTool === 'string' ? task.currentTool : undefined,
        updatedAt: now,
      }));
      execution.taskIds = [...new Set([...execution.taskIds, ...progress.map((task) => task.id)])];
    }
    return execution;
  }

  function trackNativeTaskExecutionStart(event, cwd) {
    if (event?.toolName !== 'task' || typeof event.toolCallId !== 'string' || !event.toolCallId) return;
    const execution = nativeTaskExecutionState(cwd, event, null);
    if (!execution) return;
    trackGsdTaskRequest(event, cwd);
  }

  function trackNativeTaskExecutionUpdate(event, cwd) {
    if (event?.toolName !== 'task' || typeof event.toolCallId !== 'string' || !event.toolCallId) return;
    const details = nativeTaskDetails(event.partialResult);
    const execution = nativeTaskExecutionState(cwd, event, details);
    if (!execution) return;
    trackGsdTaskProgress({ ...event, details }, cwd);
  }

  function trackNativeTaskExecutionEnd(event, cwd) {
    if (event?.toolName !== 'task' || typeof event.toolCallId !== 'string' || !event.toolCallId) return;
    const details = nativeTaskDetails(event.result);
    const execution = nativeTaskExecutionState(cwd, event, details);
    if (!execution) return;
    const normalized = {
      ...event,
      details,
      content: Array.isArray(event.result?.content) ? event.result.content : [],
    };
    trackGsdTaskProgress(normalized, cwd);
    releaseFailedGsdTaskRequest(normalized, cwd);
    reconcileTaskSettlement(normalized, cwd);
    const calls = nativeTaskExecutionByCall.get(path.resolve(cwd));
    calls?.delete(event.toolCallId);
    if (calls?.size === 0) nativeTaskExecutionByCall.delete(path.resolve(cwd));
  }

  function nativeTaskExecutionSnapshot(cwd) {
    const calls = nativeTaskExecutionByCall.get(path.resolve(cwd));
    if (!calls?.size) return { activeCalls: 0, trackedTasks: 0, updatingTasks: 0 };
    const taskIds = new Set();
    let updatingTasks = 0;
    for (const execution of calls.values()) {
      for (const taskId of execution.taskIds) taskIds.add(taskId);
      for (const task of execution.progress) {
        taskIds.add(task.id);
        if (!TERMINAL_JOB_STATUSES.has(task.status)) updatingTasks += 1;
      }
    }
    return { activeCalls: calls.size, trackedTasks: taskIds.size, updatingTasks };
  }

  function trackGsdTaskRequest(event, cwd) {
    const input = taskInputFor(event);
    if (event?.toolName !== 'task' || typeof event.toolCallId !== 'string' || !event.toolCallId || !input) return;
    const taskIds = gsdTaskIdsFromInput(input);
    if (!taskIds.length) return;
    const taskCalls = taskCallsFor(cwd);
    if (taskCalls.has(event.toolCallId)) return;
    for (const taskId of taskIds) retainTaskId(cwd, taskId);
    taskCalls.set(event.toolCallId, taskIds);
  }

  function trackGsdTaskProgress(event, cwd) {
    const progress = event?.details?.progress;
    if (!Array.isArray(progress)) return;
    const projectPath = path.resolve(cwd);
    let taskIds = activeGsdTaskIds.get(projectPath);
    for (const task of progress) {
      if (typeof task?.agent !== 'string' || !task.agent.startsWith('gsd-') || typeof task.id !== 'string' || !task.id) continue;
      const status = String(task.status || '').toLowerCase();
      if (TERMINAL_JOB_STATUSES.has(status)) {
        releaseTaskId(cwd, task.id);
        forgetTaskCallIds(cwd, new Set([task.id]));
        continue;
      }
      if (!taskIds?.has(task.id)) {
        retainTaskId(cwd, task.id);
        taskIds = activeGsdTaskIds.get(projectPath);
      }
    }
    if (taskIds?.size === 0) activeGsdTaskIds.delete(projectPath);
  }

  function releaseSettledGsdTasks(event, cwd) {
    if (event?.toolName !== 'job') return false;
    const jobs = event?.details?.jobs;
    if (!Array.isArray(jobs)) return false;
    const projectPath = path.resolve(cwd);
    const taskIds = activeGsdTaskIds.get(projectPath);
    if (!taskIds) return false;
    const settledIds = new Set();
    for (const job of jobs) {
      const status = String(job?.status || '').toLowerCase();
      if (TERMINAL_JOB_STATUSES.has(status) && typeof job?.id === 'string' && taskIds.has(job.id)) {
        releaseTaskId(cwd, job.id);
        settledIds.add(job.id);
      }
    }
    if (settledIds.size) forgetTaskCallIds(cwd, settledIds);
    if (taskIds.size === 0) activeGsdTaskIds.delete(projectPath);
    return settledIds.size > 0;
  }

  function releaseFailedGsdTaskRequest(event, cwd) {
    if (event?.toolName !== 'task' || !event.isError || typeof event.toolCallId !== 'string') return false;
    const projectPath = path.resolve(cwd);
    const taskCalls = activeGsdTaskIdsByCall.get(projectPath);
    const taskIds = taskCalls?.get(event.toolCallId);
    if (!taskIds) return false;
    for (const taskId of taskIds) releaseTaskId(cwd, taskId);
    taskCalls.delete(event.toolCallId);
    if (taskCalls.size === 0) activeGsdTaskIdsByCall.delete(projectPath);
    return true;
  }

  // Detached GSD tasks (OMP's execute/plan dispatch) return at spawn time with
  // TaskToolDetails.async = { state: 'running', jobId }. The request was tracked
  // by task `name` (the agent registry id), but job-completion events key on
  // `jobId` — a separate id space (OMP AsyncJob.jobId != agentId). Without
  // bridging, every detached task leaks its name entry and /gsd-next is
  // permanently blocked by a stale count.
  function reconcileTaskSettlement(event, cwd) {
    if (event?.toolName !== 'task' || event.isError || typeof event.toolCallId !== 'string') return;
    const projectPath = path.resolve(cwd);
    const taskCalls = activeGsdTaskIdsByCall.get(projectPath);
    const trackedIds = taskCalls?.get(event.toolCallId);
    if (!trackedIds?.length) return;
    const asyncInfo = event?.details?.async;
    if (asyncInfo && asyncInfo.state === 'running' && typeof asyncInfo.jobId === 'string' && asyncInfo.jobId) {
      // Spawn ack for a detached job: swap name -> jobId so the later job event
      // (releaseSettledGsdTasks, keyed on jobId) can release it.
      const jobId = asyncInfo.jobId;
      for (const id of trackedIds) releaseTaskId(cwd, id);
      retainTaskId(cwd, jobId);
      taskCalls.set(event.toolCallId, [jobId]);
      return;
    }
    // Synchronous completion backstop: final results present means the call is
    // terminal. Gated on results[] so a detached spawn ack lacking async
    // metadata is not cleared prematurely.
    const results = event?.details?.results;
    if (!Array.isArray(results) || !results.length) return;
    for (const id of trackedIds) releaseTaskId(cwd, id);
    taskCalls.delete(event.toolCallId);
    if (taskCalls.size === 0) activeGsdTaskIdsByCall.delete(projectPath);
  }

  function nativeTaskActivityCount(cwd) {
    return activeGsdTaskIds.get(path.resolve(cwd))?.size || 0;
  }

  function nativeTaskWaitBlock(event, cwd) {
    const input = event?.input || {};
    const taskIds = activeGsdTaskIds.get(path.resolve(cwd));
    if (event?.toolName !== 'irc' || input.op !== 'wait' || typeof input.from !== 'string' || !taskIds?.has(input.from)) return null;
    return `GSD OMP guard: "${input.from}" is a native task job. Do not wait for task completion through IRC; use job poll ["${input.from}"] and consume its task result instead.`;
  }

  return {
    nativeTaskActivityCount,
    nativeTaskExecutionSnapshot,
    nativeTaskWaitBlock,
    reconcileTaskSettlement,
    releaseFailedGsdTaskRequest,
    releaseSettledGsdTasks,
    trackGsdTaskProgress,
    trackGsdTaskRequest,
    trackNativeTaskExecutionEnd,
    trackNativeTaskExecutionStart,
    trackNativeTaskExecutionUpdate,
  };
}

module.exports = {
  createNativeTaskTracker,
  nativeTaskActivityLines,
};
