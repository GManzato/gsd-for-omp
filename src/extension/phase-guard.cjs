'use strict';

/**
 * Blocks parent-checkout source edits while a non-interactive native phase execution is active.
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolvedPlanningPaths, stateSnapshot } = require('./planning.cjs');

function nativeMutationPaths(event) {
  const input = event?.input || {};
  if (['edit', 'write'].includes(event?.toolName)) return [input.path || input.filePath || input.file_path || input.file || ''];
  if (['ast_edit', 'ast-edit'].includes(event?.toolName)) return Array.isArray(input.paths) && input.paths.length ? input.paths : [input.path || ''];
  if (event?.toolName === 'lsp' && (['rename', 'rename_file'].includes(input.action) || (input.action === 'code_actions' && input.apply === true))) {
    const paths = [input.file || input.path || '', input.new_name || input.newName || ''];
    if (input.action === 'code_actions' && Array.isArray(input.edits)) {
      for (const edit of input.edits) paths.push(edit?.file || edit?.path || '');
    }
    return paths.filter(Boolean).length ? paths.filter(Boolean) : [''];
  }
  return null;
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
 * Native phase execution guard bound to the shared runtime state.
 */
function createPhaseGuard({ state, nativeTaskActivityCount }) {
  const { nativePhaseExecutions } = state;

  function nativePhaseWriteBlock(event, cwd) {
    const execution = nativePhaseExecutions.get(path.resolve(cwd));
    if (!execution || execution.interactive) return null;
    const mutationPaths = nativeMutationPaths(event);
    if (!mutationPaths || mutationPaths.every((filePath) => isPlanningPath(filePath, cwd))) return null;
    return 'GSD OMP guard: native phase execution must dispatch an isolated gsd-executor task for repository file changes; do not edit source files in the parent checkout.';
  }

  function releaseInactiveNativePhase(cwd) {
    const projectPath = path.resolve(cwd);
    if (!nativePhaseExecutions.has(projectPath)) return;
    const status = String(stateSnapshot(cwd)?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (status === 'executing' || (status === 'ready_to_execute' && nativeTaskActivityCount(cwd) > 0)) return;
    nativePhaseExecutions.delete(projectPath);
  }

  return {
    nativePhaseWriteBlock,
    releaseInactiveNativePhase,
  };
}

module.exports = {
  createPhaseGuard,
};
