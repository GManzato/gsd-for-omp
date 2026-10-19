'use strict';

/**
 * Goal Mode state normalization, session-journal recovery and per-context caching.
 */

const GOAL_STATUS_LABELS = Object.freeze({
  active: ['执行中', 'active'],
  paused: ['已暂停', 'paused'],
  'budget-limited': ['预算受限', 'budget-limited'],
  complete: ['已完成', 'complete'],
  dropped: ['已放弃', 'dropped'],
});

function normalizeGoalModeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawGoal = value.goal;
  if (!rawGoal || typeof rawGoal !== 'object' || Array.isArray(rawGoal)) return null;
  const objective = typeof rawGoal.objective === 'string' ? rawGoal.objective.replace(/\s+/g, ' ').trim() : '';
  const status = String(rawGoal.status || '').trim().toLowerCase();
  const tokensUsed = Number(rawGoal.tokensUsed);
  if (!objective || !status || !Number.isFinite(tokensUsed) || tokensUsed < 0) return null;
  const tokenBudget = rawGoal.tokenBudget === undefined ? undefined : Number(rawGoal.tokenBudget);
  if (tokenBudget !== undefined && (!Number.isFinite(tokenBudget) || tokenBudget <= 0)) return null;
  const timeUsedSeconds = Number(rawGoal.timeUsedSeconds);
  const updatedAt = Number(rawGoal.updatedAt);
  return {
    enabled: value.enabled === true,
    mode: value.mode === 'exiting' ? 'exiting' : 'active',
    ...(value.reason === 'completed' ? { reason: 'completed' } : {}),
    goal: {
      id: typeof rawGoal.id === 'string' ? rawGoal.id : '',
      objective,
      status,
      tokensUsed: Math.max(0, Math.round(tokensUsed)),
      ...(tokenBudget === undefined ? {} : { tokenBudget: Math.round(tokenBudget) }),
      timeUsedSeconds: Number.isFinite(timeUsedSeconds) && timeUsedSeconds >= 0 ? Math.round(timeUsedSeconds) : 0,
      ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    },
  };
}

function goalModeStateFromSession(ctx) {
  const entries = ctx?.sessionManager?.getEntries?.();
  if (!Array.isArray(entries)) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'mode_change') continue;
    if (entry.mode !== 'goal' && entry.mode !== 'goal_paused') return null;
    const state = normalizeGoalModeState({
      enabled: entry.mode === 'goal',
      mode: 'active',
      goal: entry.data?.goal,
    });
    return state;
  }
  return null;
}

function goalStateFromEvent(event) {
  if (event && event.state !== undefined) return event.state;
  if (event && Object.hasOwn(event, 'goal')) {
    return event.goal
      ? { enabled: event.goal.status === 'active', mode: 'active', goal: event.goal }
      : null;
  }
  return undefined;
}

function formatGoalTokens(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString();
}

function compactGoalObjective(value, width = 64) {
  const objective = String(value || '').replace(/\s+/g, ' ').trim();
  if (objective.length <= width) return objective;
  return `${objective.slice(0, Math.max(1, width - 1))}…`;
}

function goalStatusLabel(status, chinese) {
  const labels = GOAL_STATUS_LABELS[status];
  return labels ? labels[chinese ? 0 : 1] : status;
}

function goalBudgetText(goal, chinese, compact = false) {
  const used = formatGoalTokens(goal.tokensUsed);
  if (goal.tokenBudget === undefined) return compact ? used : chinese ? `${used} 已用` : `${used} used`;
  const budget = formatGoalTokens(goal.tokenBudget);
  if (compact) return `${used}/${budget}`;
  const remaining = formatGoalTokens(Math.max(0, goal.tokenBudget - goal.tokensUsed));
  return chinese ? `${used}/${budget}，剩余 ${remaining}` : `${used}/${budget}, ${remaining} remaining`;
}

function nativeGoalStatusLines(goalState, chinese) {
  const goal = goalState?.goal;
  if (!goal) return [];
  const status = goalStatusLabel(goal.status, chinese);
  const objective = compactGoalObjective(goal.objective, 96);
  const details = chinese
    ? `OMP 目标：${status} · ${objective}`
    : `OMP Goal: ${status} · ${objective}`;
  return [details, chinese
    ? `目标预算：${goalBudgetText(goal, true)}`
    : `Goal budget: ${goalBudgetText(goal, false)}`];
}

/**
 * Per-instance Goal Mode state cache keyed by OMP context.
 */
function createGoalModeTracker() {
  const nativeGoalStatesByContext = new WeakMap();

  function rememberGoalModeState(ctx, value) {
    if (!ctx || typeof ctx !== 'object') return null;
    const state = normalizeGoalModeState(value);
    nativeGoalStatesByContext.set(ctx, state);
    return state;
  }

  function goalModeStateFor(ctx, fallback) {
    if (!ctx || typeof ctx !== 'object') return null;
    if (fallback !== undefined) return rememberGoalModeState(ctx, fallback);
    if (nativeGoalStatesByContext.has(ctx)) return nativeGoalStatesByContext.get(ctx);
    const persisted = goalModeStateFromSession(ctx);
    if (persisted !== undefined) {
      nativeGoalStatesByContext.set(ctx, persisted);
      return persisted;
    }
    return null;
  }

  function goalModeActiveFor(ctx) {
    const state = goalModeStateFor(ctx);
    return state?.enabled === true && state.goal.status === 'active';
  }

  function forgetGoalModeState(ctx) {
    nativeGoalStatesByContext.delete(ctx);
  }

  return {
    forgetGoalModeState,
    goalModeActiveFor,
    goalModeStateFor,
    rememberGoalModeState,
  };
}

module.exports = {
  compactGoalObjective,
  createGoalModeTracker,
  goalBudgetText,
  goalStateFromEvent,
  goalStatusLabel,
  nativeGoalStatusLines,
};
