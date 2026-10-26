'use strict';

/**
 * Blocks parent-checkout source edits while a non-interactive native phase execution is active.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvedPlanningPaths, stateSnapshot } = require('./planning.cjs');

// OMP internal URLs that address settings, session artifacts, agents or jobs, never a checkout file.
const NON_CHECKOUT_URL = /^(?:cfg|local|agent|proc|artifact|skill|omp|history):\/\//i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// `write xd://<tool>` runs <tool> with the JSON `content` as its arguments, without a tool_call of its own.
const XD_DEVICE = /^xd:\/\/([^/?#\s]+)\/?$/i;
const CHECKPOINT_STATUS = /^\s*\[checkpoint\]\s+phase\s+\S+\s+wave\s+\d+\/\d+\s+plan\s+\S+\s+([a-z]+)/gmi;

// Edit payload grammars that carry their targets inside `input`.
const SLOPPY_TARGET = /^\s*\*\*\*\s+Edit\s+File:\s*(.+?)(?:\s+all)?\s*$/;
const APPLY_PATCH_TARGET = /^\s*\*\*\*\s+(?:(?:Add|Update|Delete)\s+File|Move\s+to):\s*(.+?)\s*$/;
// Hashline `[PATH#TAG]` (tag optional), legacy `¶PATH#TAG`, and `MV DEST` file operations.
const HASHLINE_TARGET = /^\s*(?:\[(.+?)(?:#[^#\]]*)?\]|¶+(.+?)(?:#[^#\s]*)?|MV\s+(.+?))\s*$/;

function unquote(value) {
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

function editPayloadPaths(text) {
  const lines = text.split(/\r?\n/);
  const pattern = lines.some((line) => /^\s*\*\*\*\s+Edit\s+File:/.test(line))
    ? SLOPPY_TARGET
    : lines.some((line) => /^\s*\*\*\*\s+(?:Add|Update|Delete)\s+File:/.test(line))
      ? APPLY_PATCH_TARGET
      : HASHLINE_TARGET;
  const paths = [];
  for (const line of lines) {
    const match = pattern.exec(line);
    const target = match && (match[1] ?? match[2] ?? match[3]);
    if (target) paths.push(unquote(target.trim()));
  }
  return paths.length ? paths : [''];
}

function jsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function targetPath(input) {
  return input.path || input.filePath || input.file_path || input.file || '';
}

/**
 * Paths a tool call would mutate; null when the tool does not write files.
 */
function mutationPaths(toolName, input) {
  const args = input && typeof input === 'object' ? input : {};
  if (toolName === 'write') {
    const target = targetPath(args);
    const device = typeof target === 'string' ? XD_DEVICE.exec(target) : null;
    return device ? mutationPaths(device[1], jsonObject(args.content)) : [target];
  }
  if (toolName === 'edit' || toolName === 'apply_patch') {
    // OMP also derives `path`/`paths` from hashline headers; the payload stays authoritative.
    const payload = typeof args.input === 'string' ? args.input : args._input;
    const paths = typeof payload === 'string' ? editPayloadPaths(payload) : [targetPath(args)];
    if (Array.isArray(args.paths)) paths.push(...args.paths.filter((target) => typeof target === 'string'));
    if (Array.isArray(args.edits)) {
      for (const edit of args.edits) if (typeof edit?.rename === 'string' && edit.rename) paths.push(edit.rename);
    }
    return paths;
  }
  if (['ast_edit', 'ast-edit'].includes(toolName)) return Array.isArray(args.paths) && args.paths.length ? args.paths : [args.path || ''];
  if (toolName === 'lsp' && (['rename', 'rename_file'].includes(args.action) || (args.action === 'code_actions' && args.apply === true))) {
    const paths = [args.file || args.path || '', args.new_name || args.newName || ''];
    if (args.action === 'code_actions' && Array.isArray(args.edits)) {
      for (const edit of args.edits) paths.push(edit?.file || edit?.path || '');
    }
    return paths.filter(Boolean).length ? paths.filter(Boolean) : [''];
  }
  return null;
}

function nativeMutationPaths(event) {
  return mutationPaths(event?.toolName, event?.input);
}

function expandHome(filePath) {
  return filePath === '~' || filePath.startsWith('~/') ? path.join(os.homedir(), filePath.slice(1)) : filePath;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Realpath of the deepest existing ancestor, with the missing tail re-attached.
function realTarget(target) {
  const missing = [];
  let current = target;
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

// The enclosing Git checkout; the project directory when it is not in one.
function checkoutRoot(cwd) {
  const projectRoot = path.resolve(cwd);
  for (let current = projectRoot; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    if (path.dirname(current) === current) return projectRoot;
  }
}

function hasSymlinkComponent(cwd, target) {
  const projectRoot = path.resolve(cwd);
  const relative = path.relative(projectRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  let current = projectRoot;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      return true;
    }
  }
  return false;
}

function isPlanningPath(filePath, cwd) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const planningRoot = path.resolve(resolvedPlanningPaths(cwd).planning);
  const resolved = path.resolve(cwd, filePath);
  const inside = resolved === planningRoot || resolved.startsWith(`${planningRoot}${path.sep}`);
  return inside && !hasSymlinkComponent(cwd, resolved);
}

/**
 * True for a file in the parent checkout outside the planning directory. Unknown targets and
 * unrecognized URL schemes count as checkout files, so the guard fails closed.
 */
function isParentCheckoutSource(filePath, cwd) {
  if (typeof filePath !== 'string' || !filePath.trim()) return true;
  if (NON_CHECKOUT_URL.test(filePath)) return false;
  if (URL_SCHEME.test(filePath)) return true;
  const resolved = path.resolve(cwd, expandHome(filePath));
  const root = checkoutRoot(cwd);
  // A path outside the checkout can still reach into it through a symlink.
  const inCheckout = isWithin(root, resolved) || isWithin(realTarget(root), realTarget(resolved));
  return inCheckout && !isPlanningPath(resolved, cwd);
}

/**
 * Native phase execution guard bound to the shared runtime state.
 */
function createPhaseGuard({ state, nativeTaskActivityCount }) {
  const { nativePhaseExecutions } = state;

  function nativePhaseWriteBlock(event, cwd) {
    const execution = nativePhaseExecutions.get(path.resolve(cwd));
    if (!execution || execution.interactive) return null;
    const paths = nativeMutationPaths(event);
    if (!paths || !paths.some((filePath) => isParentCheckoutSource(filePath, cwd))) return null;
    return 'GSD OMP guard: native phase execution must dispatch an isolated gsd-executor task for repository file changes; do not edit source files in the parent checkout.';
  }

  function releaseInactiveNativePhase(cwd) {
    const projectPath = path.resolve(cwd);
    if (!nativePhaseExecutions.has(projectPath)) return;
    const status = String(stateSnapshot(cwd)?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (status === 'executing' || (status === 'ready_to_execute' && nativeTaskActivityCount(cwd) > 0)) return;
    nativePhaseExecutions.delete(projectPath);
  }

  function recordNativePhaseCheckpoint(cwd, output) {
    const execution = nativePhaseExecutions.get(path.resolve(cwd));
    if (!execution) return;
    const statuses = [...String(output || '').matchAll(CHECKPOINT_STATUS)];
    if (statuses.length) execution.lastCheckpointStatus = statuses.at(-1)[1].toLowerCase();
  }

  // STATE.md can say `executing` long after a run stopped, so an agent run that ends with no
  // native task running releases the guard when it never dispatched or its last plan failed.
  function releaseStoppedNativePhase(cwd) {
    const projectPath = path.resolve(cwd);
    const execution = nativePhaseExecutions.get(projectPath);
    if (!execution || nativeTaskActivityCount(cwd) > 0) return;
    if (!execution.dispatched || execution.lastCheckpointStatus === 'failed') nativePhaseExecutions.delete(projectPath);
  }

  return {
    nativePhaseWriteBlock,
    recordNativePhaseCheckpoint,
    releaseInactiveNativePhase,
    releaseStoppedNativePhase,
  };
}

module.exports = {
  createPhaseGuard,
};
