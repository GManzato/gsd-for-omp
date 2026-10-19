'use strict';

/**
 * OMP lifecycle, goal, task and tool event handlers.
 */

const fs = require('node:fs');
const path = require('node:path');
const { goalStateFromEvent } = require('./goal-mode.cjs');
const { extractCheckpoint, extractNextAction, persistCheckpoint, persistNextAction } = require('./planning-store.cjs');
const { isGsdProject, stateReminder } = require('./planning.cjs');
const { releaseGsdProjectRuntimeState } = require('./state.cjs');
const { extractTaskResults, failedNativeTaskResults } = require('./task-results.cjs');

function assistantMessageText(message) {
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content
    .filter((chunk) => chunk?.type === 'text' && typeof chunk.text === 'string')
    .map((chunk) => chunk.text)
    .join('\n');
}

/**
 * Register the OMP lifecycle, goal, task and tool event handlers.
 */
function registerLifecycleHandlers({
  pi,
  runtimeRoot,
  state,
  choosePendingContinuation,
  forgetGoalModeState,
  nativePhaseWriteBlock,
  nativeTaskWaitBlock,
  persistTaskResults,
  preToolHookOutcome,
  queueHookAdvisories,
  reconcileTaskSettlement,
  releaseFailedGsdTaskRequest,
  releaseInactiveNativePhase,
  releaseSettledGsdTasks,
  rememberGoalModeState,
  scheduleOnboardingPrompt,
  setNativeRuntimeSignal,
  showNativeStatusOverlay,
  startGraphifyAutoUpdate,
  trackGraphifyHead,
  trackGsdTaskProgress,
  trackGsdTaskRequest,
  trackNativeTaskExecutionEnd,
  trackNativeTaskExecutionStart,
  trackNativeTaskExecutionUpdate,
  updateStatus,
}) {
  pi.on('resources_discover', (_event, _ctx) => {
    const skillsRoot = path.join(runtimeRoot, 'skills');
    try {
      const stat = fs.lstatSync(skillsRoot);
      if (stat.isDirectory() && !stat.isSymbolicLink()) return { skillPaths: [skillsRoot] };
    } catch {
      // A partial install should not prevent OMP from discovering other resources.
    }
    return undefined;
  });

  pi.on('session_start', (_event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    scheduleOnboardingPrompt(ctx);
    updateStatus(ctx);
    if (pi.getFlag?.('gsd-status')) void showNativeStatusOverlay(ctx);
    if (!ctx.hasUI) return;
    const reminder = stateReminder(ctx.cwd);
    if (reminder) ctx.ui.notify(reminder, 'info');
  });

  try {
    pi.on('goal_updated', (event, ctx) => {
      if (!ctx || !isGsdProject(ctx.cwd)) return;
      const eventState = goalStateFromEvent(event);
      if (eventState !== undefined) {
        const state = rememberGoalModeState(ctx, eventState);
        updateStatus(ctx, state);
        return;
      }
      updateStatus(ctx);
    });
  } catch {
    // OMP 17 has no goal_updated event; the rest of the extension remains active.
  }

  pi.on('session_shutdown', (_event, ctx) => {
    forgetGoalModeState(ctx);
    releaseGsdProjectRuntimeState(state, ctx.cwd);
  });

  pi.on('session_switch', (_event, ctx) => {
    forgetGoalModeState(ctx);
    updateStatus(ctx);
  });

  pi.on('session_branch', (_event, ctx) => {
    forgetGoalModeState(ctx);
    updateStatus(ctx);
  });

  pi.on('session_tree', (_event, ctx) => {
    forgetGoalModeState(ctx);
    updateStatus(ctx);
  });

  pi.on('session_compact', (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on('auto_compaction_start', (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    setNativeRuntimeSignal(ctx.cwd, { kind: 'compacting', reason: event?.reason, action: event?.action });
    updateStatus(ctx);
  });

  pi.on('auto_compaction_end', (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    setNativeRuntimeSignal(ctx.cwd, null);
    updateStatus(ctx);
  });

  pi.on('auto_retry_start', (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    setNativeRuntimeSignal(ctx.cwd, { kind: 'retrying', attempt: event?.attempt, maxAttempts: event?.maxAttempts });
    updateStatus(ctx);
  });

  pi.on('auto_retry_end', (_event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    setNativeRuntimeSignal(ctx.cwd, null);
    updateStatus(ctx);
  });

  pi.on('session_stop', (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    if (event?.signal?.aborted) setNativeRuntimeSignal(ctx.cwd, { kind: 'stopping' });
    updateStatus(ctx);
    return undefined;
  });

  pi.on('turn_end', async (_event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    setNativeRuntimeSignal(ctx.cwd, null);
    releaseInactiveNativePhase(ctx.cwd);
    updateStatus(ctx);
  });

  pi.on('message_end', async (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    const output = assistantMessageText(event?.message);
    const checkpoint = extractCheckpoint(output);
    const nextAction = extractNextAction(output);
    if (checkpoint) persistCheckpoint(ctx.cwd, checkpoint);
    if (nextAction) persistNextAction(ctx.cwd, nextAction);
    if (checkpoint || nextAction) updateStatus(ctx);
    if (nextAction && ctx.hasUI) await choosePendingContinuation(ctx, nextAction);
  });

  pi.on('tool_execution_start', async (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    trackNativeTaskExecutionStart(event, ctx.cwd);
    updateStatus(ctx);
  });

  pi.on('tool_execution_update', async (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    trackNativeTaskExecutionUpdate(event, ctx.cwd);
    updateStatus(ctx);
  });

  pi.on('tool_execution_end', async (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    trackNativeTaskExecutionEnd(event, ctx.cwd);
    updateStatus(ctx);
  });

  pi.on('tool_result', async (event, ctx) => {
    if (!isGsdProject(ctx.cwd)) return;
    releaseSettledGsdTasks(event, ctx.cwd);
    releaseFailedGsdTaskRequest(event, ctx.cwd);
    trackGsdTaskProgress(event, ctx.cwd);
    reconcileTaskSettlement(event, ctx.cwd);
    const output = (Array.isArray(event?.content) ? event.content : [])
      .filter((chunk) => chunk?.type === 'text' && typeof chunk.text === 'string')
      .map((chunk) => chunk.text)
      .join('\n');
    const checkpoint = extractCheckpoint(output);
    const taskResults = new Map(extractTaskResults(output).map((result) => [result.task, result]));
    for (const failedResult of failedNativeTaskResults(event)) taskResults.set(failedResult.task, failedResult);
    persistTaskResults(ctx.cwd, [...taskResults.values()]);
    if (checkpoint) {
      persistCheckpoint(ctx.cwd, checkpoint);
      updateStatus(ctx);
    }
    startGraphifyAutoUpdate(event, ctx.cwd);
  });

  pi.on('tool_call', async (event, ctx) => {
    trackGsdTaskRequest(event, ctx.cwd);
    const taskWaitBlock = nativeTaskWaitBlock(event, ctx.cwd);
    if (taskWaitBlock) return { block: true, reason: taskWaitBlock };
    const nativePhaseBlock = nativePhaseWriteBlock(event, ctx.cwd);
    if (nativePhaseBlock) return { block: true, reason: nativePhaseBlock };
    const hookResult = await preToolHookOutcome(event, ctx);
    if (hookResult.block) return { block: true, reason: hookResult.reason };
    await queueHookAdvisories(hookResult.advisories);
    trackGraphifyHead(event, ctx.cwd);
    return undefined;
  });
}

module.exports = {
  registerLifecycleHandlers,
};
