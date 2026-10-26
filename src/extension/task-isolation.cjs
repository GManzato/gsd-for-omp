'use strict';

/**
 * Whether OMP's native task tool offers `isolated` dispatch in the current session.
 *
 * The task tool advertises `isolated` only while `task.isolation.enabled` is true and plan
 * mode is off, and it rebuilds its schema from live settings, so the schema is the answer.
 */

const ISOLATION_SETTING = 'task.isolation.enabled';

function schemaDeclaresIsolated(schema, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return false;
  seen.add(schema);
  const properties = schema.properties;
  if (properties && typeof properties === 'object' && Object.hasOwn(properties, 'isolated')) return true;
  return Object.values(schema).some((value) => schemaDeclaresIsolated(value, seen));
}

/**
 * @returns {boolean|null} whether the task tool accepts `isolated`; null when the host cannot tell
 */
function taskIsolationOffered(pi) {
  if (typeof pi.getAllTools !== 'function') return null;
  try {
    const tools = pi.getAllTools();
    const task = Array.isArray(tools) ? tools.find((tool) => tool?.name === 'task') : undefined;
    if (!task) return null;
    // OMP 18 tool schemas are arktype types; older hosts expose JSON Schema objects.
    const parameters = task.parameters;
    const schema = typeof parameters?.toJsonSchema === 'function' ? parameters.toJsonSchema() : parameters;
    return schema && typeof schema === 'object' ? schemaDeclaresIsolated(schema) : null;
  } catch {
    return null;
  }
}

function isolationSetting(pi, registry) {
  const scope = pi.pi?.settings;
  const setting = scope && typeof registry?.lookup === 'function' ? registry.lookup(ISOLATION_SETTING) : undefined;
  return setting ? { setting, scope } : null;
}

/**
 * Makes isolated task dispatch available when nothing configures it, through a session-only
 * override; an explicit user, project, env or protocol-host value is respected.
 *
 * @returns {{ available: boolean, enabled?: boolean, reason?: 'disabled' | 'plan-mode' }}
 */
function ensureTaskIsolation(pi, registry) {
  const offered = taskIsolationOffered(pi);
  if (offered !== false) return { available: true };
  const handle = isolationSetting(pi, registry);
  if (!handle) return { available: false, reason: 'disabled' };
  const { setting, scope } = handle;
  try {
    if (setting.get(scope) === true) return { available: false, reason: 'plan-mode' };
    if (setting.provenance(scope) !== 'default') return { available: false, reason: 'disabled' };
    setting.override(scope, true);
    if (taskIsolationOffered(pi) !== false) return { available: true, enabled: true };
    setting.clearOverride(scope);
    return { available: false, reason: 'plan-mode' };
  } catch {
    return { available: false, reason: 'disabled' };
  }
}

function taskIsolationMessage(reason, chinese) {
  if (reason === 'plan-mode') {
    return chinese
      ? '阶段执行需要 OMP 隔离任务，但计划模式会隐藏 `isolated` 选项。请退出计划模式后重新运行 /gsd-execute-phase，或使用 --interactive。'
      : 'Phase execution needs isolated OMP tasks, and plan mode hides the task `isolated` option. Leave plan mode and run /gsd-execute-phase again, or use --interactive.';
  }
  return chinese
    ? [
      '阶段执行需要 OMP 任务隔离，但当前 `task.isolation.enabled` 已关闭。启用方式：',
      '',
      'omp config set task.isolation.enabled true',
      '',
      '设置会实时生效；然后重新运行 /gsd-execute-phase，或使用 --interactive。',
    ].join('\n')
    : [
      'Phase execution needs OMP task isolation, and `task.isolation.enabled` is off. Enable it with:',
      '',
      'omp config set task.isolation.enabled true',
      '',
      'OMP reloads the setting live; then run /gsd-execute-phase again, or use --interactive.',
    ].join('\n');
}

module.exports = {
  ensureTaskIsolation,
  taskIsolationMessage,
  taskIsolationOffered,
};
