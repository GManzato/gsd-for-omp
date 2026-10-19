'use strict';

/**
 * Per-instance project-scoped runtime state (maps/sets) and its release on shutdown.
 */

const path = require('node:path');

function releaseGsdProjectRuntimeState(state, cwd) {
  const {
    advisedFiles,
    activeGsdTaskIds,
    activeGsdTaskRefCounts,
    nativePhaseExecutions,
    nativeRuntimeSignals,
    nativeTaskExecutionByCall,
    graphifyHeadByCall,
    onboardingPromptCwds,
  } = state;
  const projectPath = path.resolve(cwd);
  activeGsdTaskIds.delete(projectPath);
  activeGsdTaskRefCounts.delete(projectPath);
  nativeTaskExecutionByCall.delete(projectPath);
  nativeRuntimeSignals.delete(projectPath);
  nativePhaseExecutions.delete(projectPath);
  onboardingPromptCwds.delete(projectPath);
  for (const [callId, tracked] of graphifyHeadByCall) {
    if (tracked.cwd === projectPath) graphifyHeadByCall.delete(callId);
  }
  const projectPrefix = `${projectPath}${path.sep}`;
  for (const advisedFile of advisedFiles) {
    if (advisedFile === projectPath || advisedFile.startsWith(projectPrefix)) advisedFiles.delete(advisedFile);
  }
}

/**
 * Project-scoped runtime state owned by one extension instance. Keys are
 * absolute project paths (or tool-call ids) so ordinary non-GSD OMP activity
 * never leaks into GSD status; `releaseGsdProjectRuntimeState` clears a
 * project's entries on shutdown.
 */
function createRuntimeState() {
  return {
    advisedFiles: new Set(),
    activeGsdTaskIds: new Map(),
    activeGsdTaskRefCounts: new Map(),
    activeGsdTaskIdsByCall: new Map(),
    nativePhaseExecutions: new Map(),
    nativeRuntimeSignals: new Map(),
    nativeTaskExecutionByCall: new Map(),
    graphifyHeadByCall: new Map(),
    onboardingPromptCwds: new Set(),
  };
}

module.exports = {
  createRuntimeState,
  releaseGsdProjectRuntimeState,
};
