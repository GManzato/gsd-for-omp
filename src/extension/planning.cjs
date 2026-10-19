'use strict';

/**
 * GSD planning-tree paths, project detection, config and STATE.md readers.
 */

const fs = require('node:fs');
const path = require('node:path');
const { GSD_CORE } = require('./engine.cjs');
const { escapeRegExp } = require('./util.cjs');

let corePlanningPaths;

try {
  ({ planningPaths: corePlanningPaths } = require(path.join(GSD_CORE, 'bin', 'lib', 'planning-workspace.cjs')));
} catch {
  corePlanningPaths = null;
}

function resolvedPlanningPaths(cwd) {
  const flat = path.join(cwd, '.planning');
  const fallback = {
    planning: flat,
    state: path.join(flat, 'STATE.md'),
    roadmap: path.join(flat, 'ROADMAP.md'),
    project: path.join(flat, 'PROJECT.md'),
    config: path.join(flat, 'config.json'),
    phases: path.join(flat, 'phases'),
  };
  if (!corePlanningPaths) return fallback;
  try {
    return { ...fallback, ...corePlanningPaths(cwd) };
  } catch {
    return fallback;
  }
}

function planningFilePath(cwd, name) {
  const paths = resolvedPlanningPaths(cwd);
  return paths[name] || path.join(paths.planning, name);
}

function readProjectConfig(cwd) {
  try {
    return JSON.parse(fs.readFileSync(planningFilePath(cwd, 'config'), 'utf8'));
  } catch {
    return null;
  }
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isGsdProject(cwd) {
  const active = resolvedPlanningPaths(cwd);
  const flatRoot = path.join(cwd, '.planning');
  return [active.project, active.roadmap, active.state, ...['PROJECT.md', 'ROADMAP.md', 'STATE.md'].map((name) => path.join(flatRoot, name))]
    .some((filePath) => isRegularFile(filePath));
}

function stateReminder(cwd) {
  const config = readProjectConfig(cwd);
  if (!config?.hooks?.workflow_guard) return null;

  const statePath = planningFilePath(cwd, 'state');
  let stateHead = '';
  try {
    if (fs.statSync(statePath).isFile()) stateHead = fs.readFileSync(statePath, 'utf8').split(/\r?\n/).slice(0, 20).join('\n');
  } catch {
    // Session-start reminders are advisory and must not block the host.
  }
  const lines = ['## Project State Reminder', ''];
  lines.push(stateHead
    ? 'STATE.md exists — check blockers and the current phase before acting.\n' + stateHead
    : 'No STATE.md exists — use /gsd-new-project when starting a new project.');
  lines.push('', `Config mode: "${config.mode || 'unknown'}"`);
  return lines.join('\n');
}

function stateSnapshot(cwd) {
  const statePath = planningFilePath(cwd, 'state');
  if (!fs.existsSync(statePath)) return null;

  let state;
  try {
    state = fs.readFileSync(statePath, 'utf8');
  } catch {
    return { unreadable: true };
  }
  const match = state.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { unreadable: true };
  const [, frontmatter, body] = match;
  const cleanValue = (raw) => {
    let value = String(raw ?? '').trim();
    if (!((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    return value || null;
  };
  const fields = new Map();
  let section;
  for (const line of frontmatter.split(/\r?\n/)) {
    const nested = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (nested && section === 'progress') fields.set(`progress.${nested[1]}`, cleanValue(nested[2]));
    const scalar = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (scalar) {
      section = scalar[1];
      fields.set(scalar[1], cleanValue(scalar[2]));
    }
  }
  const field = (name) => fields.get(name) || null;
  const progressField = (name) => fields.get(`progress.${name}`) || null;
  const bodyValue = (name) => body.match(new RegExp(`^\\s*(?:\\*\\*)?${escapeRegExp(name)}(?:\\*\\*)?:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
  const phaseLine = bodyValue('Phase');
  const phase = phaseLine?.match(/^(\d+(?:\.\d+)?)/)?.[1] || field('current_phase') || '—';
  const phaseName = field('current_phase_name')
    || phaseLine?.match(/\(([^)\r\n]+)\)\s*$/)?.[1]?.trim()
    || bodyValue('Current focus');
  const riskHeadings = [...body.matchAll(/^(#{2,6})\s+(Blockers|Concerns|Blockers\/Concerns)\s*$/gmi)];
  const allHeadings = [...body.matchAll(/^(#{2,6})\s+.+$/gmi)];
  const risks = [];
  for (const heading of riskHeadings) {
    const level = heading[1].length;
    const sectionStart = heading.index + heading[0].length;
    const nextHeading = allHeadings.find((candidate) => candidate.index > heading.index && candidate[1].length <= level);
    const section = body.slice(sectionStart, nextHeading?.index ?? body.length);
    const headingName = heading[2].toLowerCase();
    for (const bullet of section.matchAll(/^\s*-\s+(.+)$/gm)) {
      const title = bullet[1].trim();
      const blocker = headingName === 'blockers' || /^(?:\[blocker\]|⛔)/i.test(title);
      risks.push({ severity: blocker ? 'blocker' : 'concern', title });
    }
  }
  const blockers = risks.filter(({ severity }) => severity === 'blocker').length;
  const concerns = risks.length - blockers;
  return {
    phase,
    phaseName,
    status: field('status') || bodyValue('Status') || 'unknown',
    totalPlans: field('total_plans') || progressField('total_plans'),
    completedPlans: field('completed_plans') || progressField('completed_plans'),
    blockers,
    concerns,
    risks,
    nextStep: body.match(/^\s*(?:Next(?: Step)?|Recommendation):\s*(.+)$/mi)?.[1]?.trim() || null,
  };
}

module.exports = {
  isGsdProject,
  planningFilePath,
  readProjectConfig,
  resolvedPlanningPaths,
  stateReminder,
  stateSnapshot,
};
