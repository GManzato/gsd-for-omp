'use strict';

/**
 * Slash-command registration (/gsd*, native workflows) and the gsd_invoke tool.
 */

const { getArgumentCompletions, parseGsdCommandArgs } = require('./cli-bridge.cjs');
const { localizedNextStep, usesChinese } = require('./localize.cjs');
const {
  completedPhaseOptions,
  discussablePhaseOptions,
  executablePhaseOptions,
  phaseCompletions,
  planProgress,
  plannablePhaseOptions,
  verifiablePhaseOptions,
} = require('./phases.cjs');
const { extractCheckpoint, extractNextAction, persistCheckpoint, persistNextAction, readNextAction } = require('./planning-store.cjs');
const { isGsdProject, stateSnapshot } = require('./planning.cjs');
const { nativeTaskRecovery } = require('./task-results.cjs');
const { parseCommandLine } = require('./util.cjs');

function commandResultContent(result, cwd) {
  const chinese = usesChinese(cwd);
  const output = result.stdout || result.stderr || (chinese
    ? `GSD 命令以退出码 ${result.exitCode} 结束。`
    : `GSD command exited with code ${result.exitCode}.`);
  const headline = result.exitCode === 0
    ? chinese ? '✓ GSD 命令已完成' : '✓ GSD command completed'
    : chinese ? '✗ GSD 命令失败' : '✗ GSD command failed';
  const nextStep = result.exitCode === 0
    ? localizedNextStep(stateSnapshot(cwd)?.nextStep, cwd)
    : null;
  const recovery = result.exitCode !== 0
    ? (chinese ? '建议：使用 /gsd-status 查看项目状态和风险。' : 'Recovery: use /gsd-status to review project state and risks.')
    : null;
  const lines = [headline];
  if (nextStep) lines.push(chinese ? `下一步：${nextStep}` : `Next: ${nextStep}`);
  if (recovery) lines.push(recovery);
  lines.push('', output);
  return lines.join('\n');
}

/**
 * Register the /gsd command family and the native workflow commands.
 */
function registerGsdCommands({
  pi,
  abortNativeOperation,
  chooseDiscussionPhase,
  chooseExecutionPhase,
  chooseNextAction,
  choosePendingContinuation,
  choosePlanningPhase,
  chooseProjectInitialization,
  chooseVerificationPhase,
  compactNativeContext,
  emitGoalModeGuard,
  emitNativeTasksActive,
  goalModeActiveFor,
  invokeAsync,
  launchDetectedNativeAiIntegration,
  launchDetectedNativeEvalReview,
  launchDetectedNativeSecurity,
  launchDetectedNativeUiPhase,
  launchDetectedNativeUiReview,
  launchDetectedNativeValidation,
  launchNativeAddTests,
  launchNativeAiIntegration,
  launchNativeAuditFix,
  launchNativeAuditUat,
  launchNativeAutonomous,
  launchNativeCodeReview,
  launchNativeCompleteMilestone,
  launchNativeDebug,
  launchNativeEvalReview,
  launchNativeFast,
  launchNativeImport,
  launchNativeLifecycle,
  launchNativeMilestoneAudit,
  launchNativeMvpPhase,
  launchNativePause,
  launchNativePhaseDiscussion,
  launchNativePhaseExecution,
  launchNativePhaseManagement,
  launchNativePhasePlanning,
  launchNativePhaseSpecification,
  launchNativePhaseVerification,
  launchNativeProgress,
  launchNativeQuick,
  launchNativeRiskyCommand,
  launchNativeSecurity,
  launchNativeSettings,
  launchNativeUiPhase,
  launchNativeUiReview,
  launchNativeValidation,
  launchNativeWorkspace,
  launchNativeWorkstreams,
  localizedStatusSummary,
  nativeRuntimeStatusLines,
  nativeTaskActivityCount,
  runNativeSessionControl,
  updateStatus,
}) {
  pi.registerCommand('gsd-update', {
    description: 'Update GSD through native OMP preflight and approval gates.',
    handler: async (input, ctx) => launchNativeRiskyCommand(ctx, 'update', input),
  });

  pi.registerCommand('gsd-undo', {
    description: 'Revert GSD commits through native OMP dependency and approval gates.',
    handler: async (input, ctx) => launchNativeRiskyCommand(ctx, 'undo', input),
  });

  pi.registerCommand('gsd-pr-branch', {
    description: 'Build a filtered PR branch through native OMP preview and approval gates.',
    handler: async (input, ctx) => launchNativeRiskyCommand(ctx, 'pr-branch', input),
  });

  pi.registerCommand('gsd-new-project', {
    description: 'Initialize a GSD project with native OMP questions.',
    handler: async (input, ctx) => launchNativeLifecycle(ctx, 'project', input),
  });

  pi.registerCommand('gsd-new-milestone', {
    description: 'Start a GSD milestone with native OMP questions.',
    handler: async (input, ctx) => launchNativeLifecycle(ctx, 'milestone', input),
  });

  pi.registerCommand('gsd-resume-work', {
    description: 'Restore a GSD project through native OMP controls.',
    handler: async (input, ctx) => launchNativeLifecycle(ctx, 'resume', input),
  });

  pi.registerCommand('gsd-ship', {
    description: 'Ship verified GSD work through native OMP controls.',
    handler: async (input, ctx) => launchNativeLifecycle(ctx, 'ship', input),
  });

  pi.registerCommand('gsd-code-review', {
    description: 'Review a GSD phase through native OMP task dispatch.',
    handler: async (input, ctx) => launchNativeCodeReview(ctx, input),
  });

  pi.registerCommand('gsd-debug', {
    description: 'Run GSD debugging through native OMP questions and tasks.',
    handler: async (input, ctx) => launchNativeDebug(ctx, input),
  });

  pi.registerCommand('gsd-progress', {
    description: 'Show GSD progress or advance through its gated next-step workflow.',
    handler: async (input, ctx) => launchNativeProgress(ctx, input),
  });

  pi.registerCommand('gsd-execute-phase', {
    description: 'Choose and execute a GSD phase through OMP native task waves.',
    getArgumentCompletions: phaseCompletions(executablePhaseOptions),
    handler: async (input, ctx) => {
      if (!String(input || '').trim()) return chooseExecutionPhase(ctx);
      return launchNativePhaseExecution(ctx, input);
    },
  });

  pi.registerCommand('gsd-settings', {
    description: 'Configure GSD workflow settings through native OMP questions.',
    handler: async (input, ctx) => launchNativeSettings(ctx, input),
  });

  pi.registerCommand('gsd-add-tests', {
    description: 'Generate phase tests through native OMP approvals.',
    getArgumentCompletions: phaseCompletions(completedPhaseOptions),
    handler: async (input, ctx) => launchNativeAddTests(ctx, input),
  });

  pi.registerCommand('gsd-validate-phase', {
    description: 'Audit Nyquist validation through native OMP controls.',
    getArgumentCompletions: phaseCompletions(completedPhaseOptions),
    handler: async (input, ctx) => {
      const tokens = parseCommandLine(input);
      if (!tokens.length || tokens.every((token) => token === '--text')) return launchDetectedNativeValidation(ctx, tokens);
      return launchNativeValidation(ctx, input);
    },
  });

  pi.registerCommand('gsd-secure-phase', {
    description: 'Verify phase threat mitigations through native OMP controls.',
    getArgumentCompletions: phaseCompletions(completedPhaseOptions),
    handler: async (input, ctx) => {
      const tokens = parseCommandLine(input);
      if (!tokens.length || tokens.every((token) => token === '--text')) return launchDetectedNativeSecurity(ctx, tokens);
      return launchNativeSecurity(ctx, input);
    },
  });

  pi.registerCommand('gsd-pause-work', {
    description: 'Create a GSD handoff through native OMP controls.',
    handler: async (input, ctx) => launchNativePause(ctx, input),
  });

  pi.registerCommand('gsd-workspace', {
    description: 'Manage GSD workspaces through native OMP controls.',
    handler: async (input, ctx) => launchNativeWorkspace(ctx, input),
  });

  pi.registerCommand('gsd-ui-review', {
    description: 'Audit a completed phase UI through native OMP task dispatch.',
    getArgumentCompletions: phaseCompletions(completedPhaseOptions),
    handler: async (input, ctx) => {
      const tokens = parseCommandLine(input);
      if (!tokens.length || tokens.every((token) => token === '--text')) return launchDetectedNativeUiReview(ctx, tokens);
      return launchNativeUiReview(ctx, input);
    },
  });

  pi.registerCommand('gsd-audit-uat', {
    description: 'Audit outstanding UAT through native OMP controls.',
    handler: async (input, ctx) => launchNativeAuditUat(ctx, input),
  });

  pi.registerCommand('gsd-audit-milestone', {
    description: 'Audit milestone readiness through native OMP task dispatch.',
    handler: async (input, ctx) => launchNativeMilestoneAudit(ctx, input),
  });

  pi.registerCommand('gsd-complete-milestone', {
    description: 'Archive a verified milestone through native OMP controls.',
    handler: async (input, ctx) => launchNativeCompleteMilestone(ctx, input),
  });

  pi.registerCommand('gsd-audit-fix', {
    description: 'Run a GSD audit-to-fix pipeline through native OMP tasks.',
    handler: async (input, ctx) => launchNativeAuditFix(ctx, input),
  });

  pi.registerCommand('gsd-mvp-phase', {
    description: 'Plan a vertical MVP phase through native OMP questions.',
    getArgumentCompletions: phaseCompletions(plannablePhaseOptions),
    handler: async (input, ctx) => launchNativeMvpPhase(ctx, input),
  });

  pi.registerCommand('gsd-eval-review', {
    description: 'Audit completed AI phase evaluation coverage through native OMP tasks.',
    getArgumentCompletions: phaseCompletions(completedPhaseOptions),
    handler: async (input, ctx) => {
      const tokens = parseCommandLine(input);
      if (!tokens.length || tokens.every((token) => token === '--text')) return launchDetectedNativeEvalReview(ctx, tokens);
      return launchNativeEvalReview(ctx, input);
    },
  });

  pi.registerCommand('gsd-ai-integration-phase', {
    description: 'Create an AI design contract through native OMP tasks.',
    getArgumentCompletions: phaseCompletions(plannablePhaseOptions),
    handler: async (input, ctx) => {
      const tokens = parseCommandLine(input);
      if (!tokens.length || tokens.every((token) => token === '--text')) return launchDetectedNativeAiIntegration(ctx, tokens);
      return launchNativeAiIntegration(ctx, input);
    },
  });

  pi.registerCommand('gsd-phase', {
    description: 'Manage roadmap phases through native OMP controls.',
    handler: async (input, ctx) => launchNativePhaseManagement(ctx, input),
  });

  pi.registerCommand('gsd-workstreams', {
    description: 'Manage GSD workstreams through native OMP controls.',
    handler: async (input, ctx) => launchNativeWorkstreams(ctx, input),
  });

  pi.registerCommand('gsd-autonomous', {
    description: 'Run remaining milestone phases through native OMP orchestration.',
    handler: async (input, ctx) => launchNativeAutonomous(ctx, input),
  });

  pi.registerCommand('gsd-import', {
    description: 'Import plans through native OMP conflict and approval gates.',
    handler: async (input, ctx) => launchNativeImport(ctx, input),
  });

  pi.registerCommand('gsd-quick', {
    description: 'Run a quick GSD task through native OMP orchestration.',
    handler: async (input, ctx) => launchNativeQuick(ctx, input),
  });

  pi.registerCommand('gsd-fast', {
    description: 'Run a trivial GSD task inline through native OMP controls.',
    handler: async (input, ctx) => launchNativeFast(ctx, input),
  });

  pi.registerCommand('gsd-spec-phase', {
    description: 'Clarify a GSD phase through native OMP specification questions.',
    getArgumentCompletions: phaseCompletions(discussablePhaseOptions),
    handler: async (input, ctx) => launchNativePhaseSpecification(ctx, input),
  });

  pi.registerCommand('gsd-ui-phase', {
    description: 'Create a GSD UI design contract through native OMP controls.',
    getArgumentCompletions: phaseCompletions(plannablePhaseOptions),
    handler: async (input, ctx) => {
      const tokens = parseCommandLine(input);
      if (!tokens.length || tokens.every((token) => ['--auto', '--text'].includes(token))) return launchDetectedNativeUiPhase(ctx, tokens);
      return launchNativeUiPhase(ctx, input);
    },
  });

  pi.registerCommand('gsd-discuss-phase', {
    description: 'Discuss a GSD phase with native OMP question controls.',
    getArgumentCompletions: phaseCompletions(discussablePhaseOptions),
    handler: async (input, ctx) => {
      if (!String(input || '').trim()) return chooseDiscussionPhase(ctx);
      return launchNativePhaseDiscussion(ctx, input);
    },
  });

  pi.registerCommand('gsd-plan-phase', {
    description: 'Choose and plan a GSD phase with native OMP preflight.',
    getArgumentCompletions: phaseCompletions(plannablePhaseOptions),
    handler: async (input, ctx) => {
      if (!String(input || '').trim()) return choosePlanningPhase(ctx);
      return launchNativePhasePlanning(ctx, input);
    },
  });

  pi.registerCommand('gsd-verify-work', {
    description: 'Choose and verify a completed GSD phase through native UAT.',
    getArgumentCompletions: phaseCompletions(verifiablePhaseOptions),
    handler: async (input, ctx) => {
      if (!String(input || '').trim()) return chooseVerificationPhase(ctx);
      return launchNativePhaseVerification(ctx, input);
    },
  });

  pi.registerCommand('gsd', {
    description: 'Invoke GSD CLI: /gsd <family> <subcommand> [args].',
    getArgumentCompletions,
    handler: async (input, ctx) => {
      const { family, subcommand, args } = parseGsdCommandArgs(input);
      const result = await invokeAsync({ family, subcommand, args, cwd: ctx.cwd });
      const nextAction = result.exitCode === 0 && extractNextAction(result.stdout);
      const checkpoint = result.exitCode === 0 && extractCheckpoint(result.stdout);
      if (nextAction) persistNextAction(ctx.cwd, nextAction);
      if (checkpoint) persistCheckpoint(ctx.cwd, checkpoint);
      if (nextAction || checkpoint) updateStatus(ctx);
      await pi.sendMessage({
        customType: 'gsd-command-result',
        content: commandResultContent(result, ctx.cwd),
        display: true,
        details: result,
      }, { triggerTurn: false });
      if (nextAction && ctx.hasUI) await choosePendingContinuation(ctx, nextAction);
    },
  });

  pi.registerCommand('gsd-status', {
    description: 'Show a localized GSD project summary or stop the current operation.',
    handler: async (input, ctx) => {
      const command = String(input || '').trim().toLowerCase();
      if (await runNativeSessionControl(ctx, input)) return;
      if (/^(?:--)?compact$/.test(command)) return compactNativeContext(ctx);
      if (/^(?:--)?(?:stop|abort)$/.test(command)) return abortNativeOperation(ctx);
      const content = [localizedStatusSummary(ctx.cwd), ...nativeRuntimeStatusLines(ctx)].filter(Boolean).join('\n');
      await pi.sendMessage({
        customType: 'gsd-status-summary',
        content,
        display: true,
      }, { triggerTurn: false });
    },
  });

  pi.registerCommand('gsd-next', {
    description: 'Show or prepare the next localized GSD action.',
    handler: async (_input, ctx) => {
      if (isGsdProject(ctx.cwd) && goalModeActiveFor(ctx)) return emitGoalModeGuard(ctx, readNextAction(ctx.cwd));
      const activeTaskCount = nativeTaskActivityCount(ctx.cwd);
      if (activeTaskCount > 0) return emitNativeTasksActive(ctx, activeTaskCount);
      const recovery = nativeTaskRecovery(ctx.cwd);
      const continuation = !recovery && readNextAction(ctx.cwd);
      if (continuation) {
        await choosePendingContinuation(ctx, continuation);
        return;
      }
      const state = stateSnapshot(ctx.cwd);
      if (!state && !isGsdProject(ctx.cwd)) return chooseProjectInitialization(ctx);
      if (!state || state.unreadable) {
        await pi.sendMessage({
          customType: 'gsd-next-step',
          content: localizedStatusSummary(ctx.cwd),
          display: true,
        }, { triggerTurn: false });
        return;
      }
      await chooseNextAction(ctx, state);
    },
  });
}

/**
 * Register the gsd_invoke tool.
 */
function registerGsdInvokeTool({ pi, invokeAsync }) {
  const z = pi.zod;

  pi.registerTool({
    name: 'gsd_invoke',
    label: 'GSD Invoke',
    description: 'Invoke a gsd-tools top-level family (for example, family "progress"), not a slash workflow. Never use "gsd" as the family.',
    loadMode: 'discoverable',
    parameters: z.object({
      family: z.string().default('query'),
      subcommand: z.string().default('help'),
      args: z.array(z.string()).default(() => []),
      raw: z.boolean().optional(),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const progressMessage = () => {
        const state = stateSnapshot(ctx.cwd);
        const progress = planProgress(ctx.cwd, state);
        const activity = `${params.family} ${params.subcommand}`;
        const detail = progress ? `\n${progress.bar} ${progress.completed}/${progress.total}` : '';
        return `GSD · ${activity}${detail}`;
      };
      onUpdate?.({ content: [{ type: 'text', text: progressMessage() }] });
      const timer = onUpdate ? ctx.setInterval(() => onUpdate({ content: [{ type: 'text', text: progressMessage() }] }), 250) : null;
      try {
        const result = await invokeAsync({ ...params, cwd: ctx.cwd, signal });
        return {
          content: [{ type: 'text', text: result.cancelled ? 'GSD command cancelled.' : result.stdout || result.stderr }],
          details: result,
        };
      } finally {
        if (timer) ctx.clearTimer(timer);
      }
    }
  });
}

module.exports = {
  registerGsdCommands,
  registerGsdInvokeTool,
};
