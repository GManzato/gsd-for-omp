'use strict';

/**
 * Phase id normalization, phase artifact inventory, phase pickers and plan progress.
 */

const fs = require('node:fs');
const path = require('node:path');
const { usesChinese } = require('./localize.cjs');
const { planningFilePath, resolvedPlanningPaths } = require('./planning.cjs');
const { escapeRegExp } = require('./util.cjs');

const PHASE_ID_PATTERN = /^\d+(?:\.\d+)?$/;

function normalizePhaseId(value) {
  const token = String(value ?? '').trim();
  if (!PHASE_ID_PATTERN.test(token)) return null;
  const [whole, decimal] = token.split('.');
  const number = Number(whole);
  if (!Number.isInteger(number) || number < 1) return null;
  return `${String(number).padStart(2, '0')}${decimal === undefined ? '' : `.${decimal}`}`;
}

function displayPhaseId(value) {
  const phase = normalizePhaseId(value);
  if (!phase) return String(value ?? '');
  const [whole, decimal] = phase.split('.');
  return `${Number(whole)}${decimal === undefined ? '' : `.${decimal}`}`;
}

function canonicalPlanArtifactId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? String(Number.parseInt(text, 10)) : null;
}

function phaseArtifactInventory(cwd, phaseValue) {
  const phase = normalizePhaseId(phaseValue);
  if (!phase) return null;
  const phasesPath = resolvedPlanningPaths(cwd).phases;
  try {
    const phaseDirectory = fs.readdirSync(phasesPath, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith(`${phase}-`));
    if (!phaseDirectory) return null;
    const artifacts = fs.readdirSync(path.join(phasesPath, phaseDirectory.name));
    const escapedPhase = escapeRegExp(phase);
    const planPattern = new RegExp(`^${escapedPhase}-(\\d+)-PLAN\\.md$`);
    const summaryPattern = new RegExp(`^${escapedPhase}-(\\d+)-SUMMARY\\.md$`);
    const planIds = new Set(artifacts.flatMap((name) => {
      const planId = canonicalPlanArtifactId(planPattern.exec(name)?.[1]);
      return planId ? [planId] : [];
    }));
    const completedIds = new Set(artifacts.flatMap((name) => {
      const planId = canonicalPlanArtifactId(summaryPattern.exec(name)?.[1]);
      return planId && planIds.has(planId) ? [planId] : [];
    }));
    return planIds.size > 0 ? { planIds, completedIds } : null;
  } catch {
    return null;
  }
}

function taskResultPlanArtifactId(phaseValue, planValue) {
  const phase = normalizePhaseId(phaseValue);
  if (!phase) return null;
  const plan = String(planValue ?? '').trim();
  const direct = canonicalPlanArtifactId(plan);
  if (direct) return direct;
  const match = new RegExp(`^${escapeRegExp(phase)}-(\\d+)$`).exec(plan);
  return canonicalPlanArtifactId(match?.[1]);
}

function phaseArtifactProgress(cwd, state) {
  const inventory = phaseArtifactInventory(cwd, state?.phase);
  return inventory ? { plans: inventory.planIds.size, summaries: inventory.completedIds.size } : null;
}

function discussablePhaseOptions(cwd) {
  let roadmap;
  try {
    roadmap = fs.readFileSync(planningFilePath(cwd, 'roadmap'), 'utf8');
  } catch {
    return [];
  }
  return [...roadmap.matchAll(/^-\s+\[[ xX]\]\s+\*\*Phase\s+(\d+(?:\.\d+)?):\s+(.+?)\*\*/gmi)]
    .map(([, number, name]) => ({
      phase: normalizePhaseId(number),
      label: `Phase ${displayPhaseId(number)}: ${name.trim()}`,
      description: 'Discuss this phase',
    }));
}

function phaseArgumentCompletions(argumentPrefix, optionsForCwd, cwd = process.cwd()) {
  const input = String(argumentPrefix || '');
  if (/\s$/.test(input) || /\s/.test(input.trim())) return null;
  const prefix = input.trim().toLowerCase();
  const completions = optionsForCwd(cwd)
    .filter(({ phase, label }) => !prefix || phase.startsWith(prefix) || label.toLowerCase().startsWith(prefix))
    .map(({ phase, label, description }) => ({ label, value: phase, description }));
  return completions.length ? completions : null;
}

function phaseCompletions(optionsForCwd) {
  return (input, context) => phaseArgumentCompletions(input, optionsForCwd, context?.cwd || process.cwd());
}

function executablePhaseOptions(cwd) {
  let roadmap;
  try {
    roadmap = fs.readFileSync(planningFilePath(cwd, 'roadmap'), 'utf8');
  } catch {
    return [];
  }
  return [...roadmap.matchAll(/^-\s+\[[ xX]\]\s+\*\*Phase\s+(\d+(?:\.\d+)?):\s+(.+?)\*\*/gmi)]
    .map(([, number, name]) => {
      const phase = normalizePhaseId(number);
      const progress = phaseArtifactProgress(cwd, { phase });
      if (!progress || progress.summaries >= progress.plans) return null;
      return {
        phase,
        label: `Phase ${displayPhaseId(number)}: ${name.trim()}`,
        description: `${progress.summaries}/${progress.plans} plans complete`,
      };
    })
    .filter(Boolean);
}

function phasePlanningStatus(cwd, phaseValue) {
  const phase = normalizePhaseId(phaseValue);
  if (!phase) return { context: false, research: false, plans: 0 };
  const phasesPath = resolvedPlanningPaths(cwd).phases;
  try {
    const phaseDirectory = fs.readdirSync(phasesPath, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith(`${phase}-`));
    if (!phaseDirectory) return { context: false, research: false, plans: 0 };
    const phasePath = path.join(phasesPath, phaseDirectory.name);
    const progress = phaseArtifactProgress(cwd, { phase });
    return {
      context: fs.existsSync(path.join(phasePath, 'CONTEXT.md')),
      research: fs.existsSync(path.join(phasePath, 'RESEARCH.md')),
      plans: progress?.plans || 0,
    };
  } catch {
    return { context: false, research: false, plans: 0 };
  }
}

function plannablePhaseOptions(cwd) {
  let roadmap;
  try {
    roadmap = fs.readFileSync(planningFilePath(cwd, 'roadmap'), 'utf8');
  } catch {
    return [];
  }
  return [...roadmap.matchAll(/^-\s+\[ \]\s+\*\*Phase\s+(\d+(?:\.\d+)?):\s+(.+?)\*\*/gmi)]
    .map(([, number, name]) => {
      const phase = normalizePhaseId(number);
      const status = phasePlanningStatus(cwd, phase);
      if (status.plans) return null;
      return {
        phase,
        label: `Phase ${displayPhaseId(number)}: ${name.trim()}`,
        description: `CONTEXT ${status.context ? 'ready' : 'missing'} · RESEARCH ${status.research ? 'ready' : 'missing'} · no plans`,
      };
    })
    .filter(Boolean);
}

function phaseVerificationStatus(cwd, phaseValue) {
  const phase = normalizePhaseId(phaseValue);
  if (!phase) return 'pending';
  const phasesPath = resolvedPlanningPaths(cwd).phases;
  try {
    const phaseDirectory = fs.readdirSync(phasesPath, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith(`${phase}-`));
    if (!phaseDirectory) return 'pending';
    const uatPath = path.join(phasesPath, phaseDirectory.name, `${phase}-UAT.md`);
    if (!fs.existsSync(uatPath)) return 'pending';
    const content = fs.readFileSync(uatPath, 'utf8');
    return content.match(/^\s*status:\s*"?([^"\r\n]+)"?\s*$/mi)?.[1]?.trim().toLowerCase() || 'in progress';
  } catch {
    return 'pending';
  }
}

function verifiablePhaseOptions(cwd) {
  let roadmap;
  try {
    roadmap = fs.readFileSync(planningFilePath(cwd, 'roadmap'), 'utf8');
  } catch {
    return [];
  }
  return [...roadmap.matchAll(/^-\s+\[[ xX]\]\s+\*\*Phase\s+(\d+(?:\.\d+)?):\s+(.+?)\*\*/gmi)]
    .map(([, number, name]) => {
      const phase = normalizePhaseId(number);
      const progress = phaseArtifactProgress(cwd, { phase });
      if (!progress || progress.summaries !== progress.plans) return null;
      const uat = phaseVerificationStatus(cwd, phase);
      if (uat === 'complete') return null;
      return {
        phase,
        label: `Phase ${displayPhaseId(number)}: ${name.trim()}`,
        description: `${progress.summaries}/${progress.plans} plans complete · UAT ${uat}`,
      };
    })
    .filter(Boolean);
}

function planProgress(cwd, state, width = 10) {
  const artifactProgress = phaseArtifactProgress(cwd, state);
  const total = artifactProgress?.plans ?? Number(state?.totalPlans);
  const completed = artifactProgress?.summaries ?? Number(state?.completedPlans);
  if (!Number.isInteger(total) || !Number.isInteger(completed) || total < 1 || completed < 0 || completed > total) return null;
  const filled = Math.round((completed / total) * width);
  return { completed, total, scope: artifactProgress ? 'phase' : 'project', bar: `${'█'.repeat(filled)}${'░'.repeat(width - filled)}` };
}

function localizedPlanProgress(progressValue, cwd, compact = false) {
  const chinese = usesChinese(cwd);
  const scope = progressValue.scope === 'phase'
    ? chinese ? '阶段计划' : 'Phase plans'
    : chinese ? '项目计划' : 'Plans';
  const counts = compact
    ? `${progressValue.completed}/${progressValue.total}`
    : `${progressValue.completed} / ${progressValue.total}`;
  return chinese ? `${scope} ${counts} 已完成` : `${scope} ${counts} complete`;
}

function completedPhaseOptions(cwd) {
  let roadmap;
  try {
    roadmap = fs.readFileSync(planningFilePath(cwd, 'roadmap'), 'utf8');
  } catch {
    return [];
  }
  return [...roadmap.matchAll(/^\-\s+\[[ xX]\]\s+\*\*Phase\s+(\d+(?:\.\d+)?):\s+(.+?)\*\*/gmi)]
    .map(([, number, name]) => {
      const phase = normalizePhaseId(number);
      const progress = phaseArtifactProgress(cwd, { phase });
      if (!progress || progress.summaries !== progress.plans) return null;
      return {
        phase,
        label: `Phase ${displayPhaseId(number)}: ${name.trim()}`,
        description: `${progress.summaries}/${progress.plans} plans complete`,
      };
    })
    .filter(Boolean);
}

module.exports = {
  completedPhaseOptions,
  discussablePhaseOptions,
  executablePhaseOptions,
  localizedPlanProgress,
  normalizePhaseId,
  phaseArgumentCompletions,
  phaseArtifactInventory,
  phaseCompletions,
  phaseVerificationStatus,
  planProgress,
  plannablePhaseOptions,
  taskResultPlanArtifactId,
  verifiablePhaseOptions,
};
