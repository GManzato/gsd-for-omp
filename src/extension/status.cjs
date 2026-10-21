'use strict';

/**
 * Status surfaces: widget lines, footer status, /gsd-status summary and native runtime signals.
 */

const path = require('node:path');
const { compactGoalObjective, goalBudgetText, goalStatusLabel, nativeGoalStatusLines } = require('./goal-mode.cjs');
const { localizedNextStep, localizedStatus, riskSummary, usesChinese } = require('./localize.cjs');
const { nativeTaskActivityLines } = require('./native-tasks.cjs');
const { localizedPlanProgress, planProgress } = require('./phases.cjs');
const { checkpointRecoveryLines, readNextAction, resumableCheckpoint } = require('./planning-store.cjs');
const { isGsdProject, stateSnapshot } = require('./planning.cjs');
const { nativeTaskRecovery, nativeTaskRecoveryLines } = require('./task-results.cjs');
const { updateNoticeStatus } = require('./update-check.cjs');

function contextUsageFor(ctx) {
  if (typeof ctx?.getContextUsage !== 'function') return null;
  try {
    const usage = ctx.getContextUsage();
    const tokens = Number(usage?.tokens);
    const contextWindow = Number(usage?.contextWindow);
    const percent = Number(usage?.percent);
    if (![tokens, contextWindow, percent].every(Number.isFinite) || contextWindow <= 0) return null;
    return {
      tokens: Math.max(0, Math.round(tokens)),
      contextWindow: Math.max(1, Math.round(contextWindow)),
      percent: Math.max(0, Math.min(100, Math.round(percent))),
    };
  } catch {
    return null;
  }
}

function asyncJobSnapshotFor(ctx) {
  if (typeof ctx?.getAsyncJobSnapshot !== 'function') return null;
  try {
    const snapshot = ctx.getAsyncJobSnapshot();
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
  } catch {
    return null;
  }
}

const WIDGET_COLORS = Object.freeze({ danger: 31, warning: 33, accent: 36, muted: 2 });

function widgetColor(code, text) {
  return `\u001b[${code}m${text}\u001b[0m`;
}

/**
 * Status surfaces bound to the shared runtime state, Goal Mode and native task tracking.
 */
function createStatusSurface({ state, goalModeStateFor, nativeTaskActivityCount, nativeTaskExecutionSnapshot, updateNotice }) {
  const { nativeRuntimeSignals } = state;

  function setNativeRuntimeSignal(cwd, signal) {
    const projectPath = path.resolve(cwd);
    if (!signal) nativeRuntimeSignals.delete(projectPath);
    else nativeRuntimeSignals.set(projectPath, { ...signal, updatedAt: Date.now() });
  }

  function nativeRuntimeSignalFor(cwd) {
    return nativeRuntimeSignals.get(path.resolve(cwd)) || null;
  }

  function nativeRuntimeStatusLines(ctx, goalStateOverride) {
    const chinese = usesChinese(ctx.cwd);
    const lines = [];
    const goalState = goalModeStateFor(ctx, goalStateOverride);
    lines.push(...nativeGoalStatusLines(goalState, chinese));
    const signal = nativeRuntimeSignalFor(ctx.cwd);
    if (signal?.kind === 'compacting') lines.push(chinese ? 'OMP 上下文维护：正在压缩。' : 'OMP context maintenance: compacting.');
    if (signal?.kind === 'retrying') lines.push(chinese ? `OMP 自动重试：第 ${signal.attempt}/${signal.maxAttempts} 次。` : `OMP auto-retry: attempt ${signal.attempt}/${signal.maxAttempts}.`);
    if (signal?.kind === 'stopping') lines.push(chinese ? 'OMP：正在停止当前 GSD 操作。' : 'OMP: stopping the current GSD operation.');

    const usage = contextUsageFor(ctx);
    if (usage) {
      const label = usage.percent >= 90 ? (chinese ? '接近上限' : 'near limit') : `${usage.percent}%`;
      lines.push(chinese
        ? `上下文：${usage.tokens}/${usage.contextWindow} (${label})`
        : `Context: ${usage.tokens}/${usage.contextWindow} (${label})`);
    }

    const runningJobs = asyncJobSnapshotFor(ctx)?.running;
    const taskJobs = Array.isArray(runningJobs) ? runningJobs.filter((job) => job?.type === 'task') : [];
    if (taskJobs.length) lines.push(chinese ? `OMP 任务：${taskJobs.length} 个异步任务运行中。` : `OMP tasks: ${taskJobs.length} async task${taskJobs.length === 1 ? '' : 's'} running.`);
    return lines;
  }

  function widgetLines(cwd, goalState = null) {
    const chinese = usesChinese(cwd);
    const taskExecution = nativeTaskExecutionSnapshot(cwd);
    const activeTaskCount = Math.max(nativeTaskActivityCount(cwd), taskExecution.trackedTasks, taskExecution.activeCalls);
    const recovery = activeTaskCount ? null : nativeTaskRecovery(cwd);
    const action = activeTaskCount || recovery ? null : readNextAction(cwd);
    const state = stateSnapshot(cwd);
    const goal = goalState?.goal || null;
    const goalActive = goalState?.enabled === true && goal.status === 'active';
    const checkpoint = !activeTaskCount && !recovery && !action ? resumableCheckpoint(cwd, state) : null;
    const hasRisks = Boolean(state?.blockers || state?.concerns);
    if (!state && !activeTaskCount && !action && !recovery && !checkpoint && !goal) return [];

    const widgetWidth = 44;
    const separator = ' · ';
    const header = (status, color, command = null) => {
      const base = `${widgetColor(WIDGET_COLORS.accent, 'GSD')} ${widgetColor(WIDGET_COLORS.muted, '/ OMP')}  ${widgetColor(color, status)}`;
      return command ? `${base}${widgetColor(WIDGET_COLORS.muted, separator)}${widgetColor(WIDGET_COLORS.accent, compactGoalObjective(command, 24))}` : base;
    };
    const detailLine = (parts, command = null, color = WIDGET_COLORS.muted) => {
      const values = (Array.isArray(parts) ? parts : [parts])
        .map((part) => String(part ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const commandText = command ? compactGoalObjective(command, 24) : '';
      const commandSuffix = commandText ? separator.length + commandText.length : 0;
      const bodyWidth = Math.max(1, widgetWidth - commandSuffix);
      const body = values.length ? compactGoalObjective(values.join(separator), bodyWidth) : '';
      const bodyText = body ? widgetColor(color, body) : '';
      if (!commandText) return bodyText;
      const commandTextStyled = widgetColor(WIDGET_COLORS.accent, commandText);
      return bodyText
        ? `${bodyText}${widgetColor(WIDGET_COLORS.muted, separator)}${commandTextStyled}`
        : commandTextStyled;
    };
    const goalParts = (goalValue, prefix) => {
      const budget = goalBudgetText(goalValue, chinese, true);
      const fixedWidth = prefix.length + separator.length + budget.length + separator.length;
      const objectiveWidth = Math.max(8, widgetWidth - fixedWidth);
      return [prefix, compactGoalObjective(goalValue.objective, objectiveWidth), budget];
    };
    const riskParts = [];
    if (state?.blockers) riskParts.push(chinese ? `${state.blockers} 项阻塞` : `${state.blockers} blocker${state.blockers === 1 ? '' : 's'}`);
    if (state?.concerns) riskParts.push(chinese ? `${state.concerns} 项关注` : `${state.concerns} concern${state.concerns === 1 ? '' : 's'}`);
    const riskText = riskParts.join(separator);
    const goalColor = goal?.status === 'active'
      ? WIDGET_COLORS.accent
      : goal?.status === 'complete'
        ? WIDGET_COLORS.accent
        : goal?.status === 'dropped'
          ? WIDGET_COLORS.muted
          : WIDGET_COLORS.warning;
    const status = state?.unreadable
      ? [chinese ? '状态异常' : 'STATE ERROR', WIDGET_COLORS.danger]
      : activeTaskCount
        ? [chinese ? '执行中' : 'RUNNING', state?.blockers ? WIDGET_COLORS.danger : WIDGET_COLORS.accent]
        : recovery
          ? [chinese ? '需要恢复' : 'RECOVERY', WIDGET_COLORS.danger]
          : goalActive
            ? [chinese ? `目标 ${goalStatusLabel(goal.status, true)}` : `GOAL ${goalStatusLabel(goal.status, false)}`, WIDGET_COLORS.accent]
            : action
              ? [chinese ? '下一步' : 'NEXT', WIDGET_COLORS.accent]
              : checkpoint
                ? [chinese ? '可恢复' : 'RESUME', WIDGET_COLORS.warning]
                : goal
                  ? [chinese ? `目标 ${goalStatusLabel(goal.status, true)}` : `GOAL ${goalStatusLabel(goal.status, false)}`, goalColor]
                  : [chinese ? '需要关注' : 'REVIEW', WIDGET_COLORS.warning];

    let detailParts;
    let command = null;
    let headerCommand = null;
    let detailColor = WIDGET_COLORS.muted;
    if (state?.unreadable) {
      if (goal) {
        detailParts = goalParts(goal, `${chinese ? '目标' : 'GOAL'} ${goalStatusLabel(goal.status, chinese)}`);
        headerCommand = goalActive ? '/goal pause' : null;
      } else if (activeTaskCount) {
        detailParts = [chinese ? `${activeTaskCount} 个任务${taskExecution.activeCalls ? ' · 实时' : ''}` : `${activeTaskCount} active${taskExecution.activeCalls ? ' · live' : ''}`];
        command = '/gsd-status';
      } else {
        detailParts = [chinese ? '状态文件无法解析' : 'STATE.md unreadable'];
        command = '/gsd-status';
        detailColor = WIDGET_COLORS.danger;
      }
    } else if (goalActive) {
      detailParts = goalParts(goal, goalStatusLabel(goal.status, chinese));
      headerCommand = '/goal pause';
    } else if (recovery) {
      detailParts = [chinese ? `${recovery.failures.length} 个失败任务` : `${recovery.failures.length} failed`];
      command = recovery.command;
      detailColor = WIDGET_COLORS.danger;
    } else if (activeTaskCount) {
      detailParts = [
        chinese ? `${activeTaskCount} 个任务${taskExecution.activeCalls ? ' · 实时' : ''}` : `${activeTaskCount} active${taskExecution.activeCalls ? ' · live' : ''}`,
        riskText,
      ];
      command = '/gsd-status';
    } else if (action) {
      detailParts = [action.label];
      command = action.command;
    } else if (checkpoint) {
      detailParts = [
        chinese ? `阶段 ${checkpoint.phase}` : `Phase ${checkpoint.phase}`,
        `${checkpoint.plansDone}/${checkpoint.plansTotal} ${chinese ? '个计划' : 'plans'}`,
      ];
      command = '/gsd-resume-work';
    } else if (goal) {
      detailParts = goalParts(goal, goalStatusLabel(goal.status, chinese));
    } else if (hasRisks) {
      detailParts = [riskText];
      command = '/gsd-status';
    } else {
      return [];
    }

    return [header(status[0], status[1], headerCommand), detailLine(detailParts, command, detailColor)].filter(Boolean);
  }

  function localizedStatusSummary(cwd) {
    const chinese = usesChinese(cwd);
    const activeTaskCount = nativeTaskActivityCount(cwd);
    const recovery = activeTaskCount ? null : nativeTaskRecovery(cwd);
    const state = stateSnapshot(cwd);
    const action = recovery ? null : readNextAction(cwd);
    const checkpoint = !recovery && !action ? resumableCheckpoint(cwd, state) : null;
    const recoveryLines = nativeTaskRecoveryLines(recovery, chinese);
    const checkpointLines = checkpointRecoveryLines(checkpoint, chinese);
    const activityLines = nativeTaskActivityLines(activeTaskCount, chinese);
    if (!state) return [chinese ? '未检测到 GSD 项目状态。' : 'No GSD project state detected.', ...activityLines, ...recoveryLines, ...checkpointLines].join('\n');
    if (state.unreadable) return [chinese ? 'GSD 状态文件无法解析。' : 'GSD state file could not be parsed.', ...activityLines, ...recoveryLines, ...checkpointLines].join('\n');
    const progressValue = planProgress(cwd, state);
    const progressText = progressValue
      ? localizedPlanProgress(progressValue, cwd)
      : chinese ? '暂无计划进度' : 'No plan progress available';
    return chinese
      ? [
        'GSD 项目状态',
        `阶段：${state.phase}${state.phaseName ? ` / ${state.phaseName}` : ''}`,
        `状态：${localizedStatus(state.status, cwd)}`,
        `计划：${progressText}`,
        `风险：${riskSummary(state, true)}`,
        `下一步：${localizedNextStep(state.nextStep, cwd) || '请查看 .planning/STATE.md'}`,
        ...activityLines,
        ...recoveryLines,
        ...checkpointLines,
      ].join('\n')
      : [
        'GSD Project Status',
        `Phase: ${state.phase}${state.phaseName ? ` / ${state.phaseName}` : ''}`,
        `Status: ${localizedStatus(state.status, cwd)}`,
        `Plans: ${progressText}`,
        `Risks: ${riskSummary(state, false)}`,
        `Next: ${state.nextStep || 'See .planning/STATE.md'}`,
        ...activityLines,
        ...recoveryLines,
        ...checkpointLines,
      ].join('\n');
  }

  function updateStatus(ctx, goalStateOverride) {
    if (!ctx.hasUI || !ctx.ui) return;
    if (!isGsdProject(ctx.cwd)) {
      ctx.ui.setWidget?.('gsd', undefined);
      ctx.ui.setStatus?.('gsd', undefined);
      ctx.ui.setWorkingMessage?.();
      return;
    }
    const chinese = usesChinese(ctx.cwd);
    const goalState = goalModeStateFor(ctx, goalStateOverride);
    const goal = goalState?.goal;
    const taskExecution = nativeTaskExecutionSnapshot(ctx.cwd);
    const activeTaskCount = Math.max(nativeTaskActivityCount(ctx.cwd), taskExecution.trackedTasks, taskExecution.activeCalls);
    const state = stateSnapshot(ctx.cwd);
    const progress = state && !state.unreadable ? planProgress(ctx.cwd, state) : null;
    const usage = contextUsageFor(ctx);
    const signal = nativeRuntimeSignalFor(ctx.cwd);
    const statusLabel = activeTaskCount
      ? chinese ? '执行中' : 'RUNNING'
      : state?.unreadable
        ? chinese ? '状态异常' : 'STATE ERROR'
        : state?.status
          ? localizedStatus(state.status, ctx.cwd)
          : chinese ? '就绪' : 'READY';
    const statusParts = [`GSD · ${statusLabel}`];
    if (activeTaskCount) statusParts.push(chinese ? `${activeTaskCount} 个任务` : `${activeTaskCount} task${activeTaskCount === 1 ? '' : 's'}`);
    else if (progress) statusParts.push(`${progress.completed}/${progress.total} ${chinese ? '个计划' : 'plans'}`);
    if (goal) {
      const budget = goalBudgetText(goal, chinese, true);
      statusParts.push(`${chinese ? '目标' : 'GOAL'} ${goalStatusLabel(goal.status, chinese)}${budget ? ` ${budget}` : ''}`);
    }
    if (signal?.kind === 'compacting') statusParts.push(chinese ? '压缩中' : 'compacting');
    if (signal?.kind === 'retrying') statusParts.push(chinese ? `重试 ${signal.attempt}/${signal.maxAttempts}` : `retry ${signal.attempt}/${signal.maxAttempts}`);
    if (usage) statusParts.push(`${usage.percent}% ${chinese ? '上下文' : 'context'}`);
    const pendingUpdate = updateNotice();
    if (pendingUpdate) statusParts.push(updateNoticeStatus(pendingUpdate, chinese));
    const statusText = statusParts.join(' · ');
    if (typeof ctx.ui.setWidget === 'function') ctx.ui.setWidget('gsd', widgetLines(ctx.cwd, goalState), { placement: 'aboveEditor' });
    if (typeof ctx.ui.setStatus === 'function') {
      const goalWarning = goal && ['paused', 'budget-limited'].includes(goal.status);
      const statusColor = state?.unreadable || usage?.percent >= 100
        ? 'error'
        : usage?.percent >= 90 || signal || goalWarning
          ? 'warning'
          : activeTaskCount || goal?.status === 'active' ? 'accent' : 'muted';
      const styledStatus = typeof ctx.ui.theme?.fg === 'function' ? ctx.ui.theme.fg(statusColor, statusText) : statusText;
      ctx.ui.setStatus('gsd', styledStatus);
    }
    if (typeof ctx.ui.setWorkingMessage === 'function') {
      if (signal?.kind === 'compacting') ctx.ui.setWorkingMessage(chinese ? 'GSD：正在压缩上下文' : 'GSD: compacting context');
      else if (signal?.kind === 'retrying') ctx.ui.setWorkingMessage(chinese ? `GSD：正在自动重试（${signal.attempt}/${signal.maxAttempts}）` : `GSD: retrying (${signal.attempt}/${signal.maxAttempts})`);
      else if (activeTaskCount) ctx.ui.setWorkingMessage(chinese ? `GSD：${activeTaskCount} 个原生任务运行中` : `GSD: ${activeTaskCount} native task${activeTaskCount === 1 ? '' : 's'} running`);
      else ctx.ui.setWorkingMessage();
    }
  }

  return {
    localizedStatusSummary,
    nativeRuntimeStatusLines,
    setNativeRuntimeSignal,
    updateStatus,
    widgetLines,
  };
}

module.exports = {
  contextUsageFor,
  createStatusSurface,
};
