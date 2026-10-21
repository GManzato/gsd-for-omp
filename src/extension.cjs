'use strict';

/**
 * GSD EoS host plugin for Oh My Pi.
 *
 * OMP loads legacy Pi extensions through the same factory contract, but its
 * current ExtensionAPI uses command handlers and Zod-backed tool parameters.
 * This bridge exposes GSD's command-routing hub, state orientation, and the
 * advisory workflow guard without depending on Claude hook payloads.
 *
 * The implementation lives in `src/extension/`; this entry only creates the
 * per-instance state, wires the modules together and registers with the host.
 * Each factory instance owns its own state, so several instances can coexist
 * in one process without sharing task, goal or onboarding bookkeeping.
 *
 * @param {object} pi Pi/OMP ExtensionAPI
 */

const Eos = require('./eos.cjs');
const { createCliBridge, getArgumentCompletions } = require('./extension/cli-bridge.cjs');
const { registerGsdCommands, registerGsdInvokeTool } = require('./extension/commands.cjs');
const { createContinuation } = require('./extension/continuation.cjs');
const { NODE_BINARY, resolveNodeBinary, resolveRuntimePaths } = require('./extension/engine.cjs');
const { createGoalModeTracker } = require('./extension/goal-mode.cjs');
const { createGraphifyAutoUpdate } = require('./extension/graphify.cjs');
const { createToolHooks, runHook } = require('./extension/hooks.cjs');
const { registerLifecycleHandlers } = require('./extension/lifecycle.cjs');
const { createNativeLaunchers } = require('./extension/native-launchers.cjs');
const { createNativeTaskTracker } = require('./extension/native-tasks.cjs');
const { createNativeUi } = require('./extension/native-ui.cjs');
const { createOnboarding } = require('./extension/onboarding.cjs');
const { createPhaseGuard } = require('./extension/phase-guard.cjs');
const { createProjectedSkills } = require('./extension/projected-skills.cjs');
const { createSessionControls } = require('./extension/session-controls.cjs');
const { createRuntimeState } = require('./extension/state.cjs');
const { createStatusSurface } = require('./extension/status.cjs');
const { createTaskResultsWriter } = require('./extension/task-results.cjs');
const { createUpdateCheck } = require('./extension/update-check.cjs');

module.exports = function gsdPiExtension(pi, options = {}) {
  if (!pi || typeof pi !== 'object') {
    throw new TypeError('gsdPiExtension: pi ExtensionAPI is required');
  }
  if (!pi.zod) {
    throw new TypeError('gsdPiExtension: a Zod-capable ExtensionAPI is required');
  }
  const eos = Eos.initialize();
  const { runtimeRoot, agentsDir, cliPath } = resolveRuntimePaths(options);

  // Dependency order is acyclic: each factory only receives collaborators that
  // were created above it.
  const state = createRuntimeState();
  const goalMode = createGoalModeTracker();
  const taskTracker = createNativeTaskTracker({ state });
  const phaseGuard = createPhaseGuard({ state, ...taskTracker });
  const graphify = createGraphifyAutoUpdate({ state });
  const toolHooks = createToolHooks({ pi, state });
  const taskResults = createTaskResultsWriter();
  const { invokeAsync } = createCliBridge({ agentsDir, cliPath });
  const updateCheck = createUpdateCheck({ runtimeRoot, ...options.updateCheck });
  const status = createStatusSurface({ state, ...goalMode, ...taskTracker, updateNotice: updateCheck.updateNotice });
  const nativeUi = createNativeUi({ pi, ...status });
  const sessionControls = createSessionControls({ pi, ...goalMode, ...taskTracker, ...status });
  const onboarding = createOnboarding({ state, ...status });
  const launchers = createNativeLaunchers({ pi, options, agentsDir, cliPath, state });
  const continuation = createContinuation({ pi, ...goalMode, ...taskTracker, ...status, ...launchers });
  const projectedSkills = createProjectedSkills({ pi, runtimeRoot, ...launchers });

  projectedSkills.registerProjectedSkillCommands();
  registerGsdCommands({
    pi,
    invokeAsync,
    ...goalMode,
    ...taskTracker,
    ...status,
    ...sessionControls,
    ...launchers,
    ...continuation,
  });
  registerGsdInvokeTool({ pi, invokeAsync });
  nativeUi.registerGsdMessageRenderers();
  nativeUi.registerNativeUiIntegrations();
  registerLifecycleHandlers({
    pi,
    runtimeRoot,
    state,
    ...goalMode,
    ...taskTracker,
    ...phaseGuard,
    ...graphify,
    ...toolHooks,
    ...taskResults,
    ...status,
    ...nativeUi,
    ...onboarding,
    ...continuation,
    ...updateCheck,
  });

  gsdPiExtension._internals = {
    ...gsdPiExtension._internals,
    eos,
    widgetLines: status.widgetLines,
    _nativeTaskActivityCount: taskTracker.nativeTaskActivityCount,
    _nativeTaskExecutionSnapshot: taskTracker.nativeTaskExecutionSnapshot,
    _pendingUpdateCheck: updateCheck._pendingUpdateCheck,
  };
};

module.exports._internals = {
  getArgumentCompletions,
  runHook,
  resolveNodeBinary,
  NODE_BINARY,
};
