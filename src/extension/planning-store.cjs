'use strict';

/**
 * Persisted OMP state beside .planning/: pending next action, UI state and execution checkpoint.
 */

const fs = require('node:fs');
const { usesChinese } = require('./localize.cjs');
const { normalizePhaseId } = require('./phases.cjs');
const { planningFilePath } = require('./planning.cjs');
const { writeJsonAtomically } = require('./util.cjs');

function nextActionPath(cwd) {
  return planningFilePath(cwd, '.omp-next-action.json');
}

function normalizeNativeGsdCommand(command) {
  const value = String(command || '').trim();
  const match = /^\/(?:skill:)?gsd(?:(?:[-:])([A-Za-z0-9_-]+))?((?:[ \t]+[^\r\n]+)?)$/.exec(value);
  if (!match) return value;
  return `/gsd${match[1] ? `-${match[1]}` : ''}${match[2]}`;
}

function readNextAction(cwd) {
  try {
    const action = JSON.parse(fs.readFileSync(nextActionPath(cwd), 'utf8'));
    return typeof action?.command === 'string' && typeof action?.label === 'string'
      ? { ...action, command: normalizeNativeGsdCommand(action.command) }
      : null;
  } catch {
    return null;
  }
}

function persistNextAction(cwd, action) {
  return writeJsonAtomically(nextActionPath(cwd), { ...action, command: normalizeNativeGsdCommand(action?.command) });
}

function clearNextAction(cwd) {
  try {
    fs.unlinkSync(nextActionPath(cwd));
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function uiStatePath(cwd) {
  return planningFilePath(cwd, '.omp-ui-state.json');
}

function readUiState(cwd) {
  try {
    const state = JSON.parse(fs.readFileSync(uiStatePath(cwd), 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function persistUiState(cwd, state) {
  return writeJsonAtomically(uiStatePath(cwd), state);
}

function rememberRecentPhase(cwd, workflow, phase) {
  if (!workflow || !phase) return;
  const state = readUiState(cwd);
  const recentPhases = state.recentPhases && typeof state.recentPhases === 'object' ? state.recentPhases : {};
  persistUiState(cwd, { ...state, recentPhases: { ...recentPhases, [workflow]: String(phase) } });
}

function prioritizeRecentPhase(cwd, workflow, options) {
  const recent = readUiState(cwd).recentPhases?.[workflow];
  if (!recent) return options;
  const selected = options.find((option) => option.phase === recent);
  return selected ? [{ ...selected, description: `${selected.description} · ${usesChinese(cwd) ? '上次选择' : 'last selected'}` }, ...options.filter((option) => option !== selected)] : options;
}

function extractNextAction(output) {
  const text = String(output || '');
  const header = text.match(/(?:^|\n)\s*(?:#{1,6}\s+)?▶\s*Next Up(?:\s+—[^\n]*)?\s*\n/m);
  if (!header || header.index === undefined) return null;
  const block = text.slice(header.index + header[0].length).split(/\r?\n\s*(?:─{8,}|-{8,})\s*(?:\r?\n|$)/)[0];
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const command = lines.find((line) => /^\/(?:skill:)?gsd(?:[-:][A-Za-z0-9_-]+)?(?:\s|$)/.test(line));
  if (!command) return null;
  const label = lines.find((line) => line !== command && !/^\/(?:new|clear)\b/.test(line) && !/^then:?$/i.test(line));
  if (!label) return null;
  return {
    label,
    command: normalizeNativeGsdCommand(command),
    requiresFreshContext: lines.some((line) => /^\/(?:new|clear)\s+then:?$/i.test(line)),
  };

}

function checkpointPath(cwd) {
  return planningFilePath(cwd, '.omp-checkpoint.json');
}

function readCheckpoint(cwd) {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath(cwd), 'utf8'));
    const phase = normalizePhaseId(checkpoint?.phase);
    return phase && Number.isInteger(checkpoint?.wave) && Number.isInteger(checkpoint?.waveTotal) && Number.isInteger(checkpoint?.plansDone) && Number.isInteger(checkpoint?.plansTotal) && typeof checkpoint?.plan === 'string'
      ? { ...checkpoint, phase }
      : null;
  } catch {
    return null;
  }
}

function persistCheckpoint(cwd, checkpoint) {
  return writeJsonAtomically(checkpointPath(cwd), checkpoint);
}

function extractCheckpoint(output) {
  const matches = [...String(output || '').matchAll(/^\s*\[checkpoint\]\s+phase\s+(\d+(?:\.\d+)?)\s+wave\s+(\d+)\/(\d+)\s+plan\s+([^\s]+)\s+complete\s+\((\d+)\/(\d+)\s+plans\s+done\)\s*$/gmi)];
  const match = matches.at(-1);
  if (!match) return null;
  const [, phase, wave, waveTotal, plan, plansDone, plansTotal] = match;
  return {
    phase: normalizePhaseId(phase),
    wave: Number(wave),
    waveTotal: Number(waveTotal),
    plan,
    plansDone: Number(plansDone),
    plansTotal: Number(plansTotal),
  };
}

function checkpointRecoveryLines(checkpoint, chinese) {
  if (!checkpoint) return [];
  const phase = checkpoint.phase;
  return chinese
    ? [`检查点恢复：阶段 ${phase} / 计划 ${checkpoint.plan} / 波次 ${checkpoint.wave}/${checkpoint.waveTotal} / 已完成 ${checkpoint.plansDone}/${checkpoint.plansTotal} 个计划`, '恢复命令：/gsd-resume-work']
    : [`Checkpoint recovery: Phase ${phase} / plan ${checkpoint.plan} / wave ${checkpoint.wave}/${checkpoint.waveTotal} / ${checkpoint.plansDone}/${checkpoint.plansTotal} plans complete`, 'Resume command: /gsd-resume-work'];
}

function resumableCheckpoint(cwd, state) {
  const checkpoint = readCheckpoint(cwd);
  const phase = normalizePhaseId(state?.phase);
  if (!checkpoint || !phase || phase !== checkpoint.phase) return null;
  if (String(state?.status || '').toLowerCase() !== 'executing') return null;
  if (!checkpoint.plan.trim() || checkpoint.wave < 1 || checkpoint.wave > checkpoint.waveTotal) return null;
  if (checkpoint.plansDone < 0 || checkpoint.plansDone >= checkpoint.plansTotal) return null;
  return checkpoint;
}

module.exports = {
  checkpointRecoveryLines,
  clearNextAction,
  extractCheckpoint,
  extractNextAction,
  persistCheckpoint,
  persistNextAction,
  prioritizeRecentPhase,
  readNextAction,
  rememberRecentPhase,
  resumableCheckpoint,
};
