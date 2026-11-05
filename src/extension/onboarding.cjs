'use strict';

/**
 * First-run language and interaction-style prompt persisted to .planning/config.json.
 *
 * The chosen `response_language` (and an explicit `workflow.text_mode`) is also
 * remembered per project config path in the runtime root, outside the project
 * checkout. When something rewrites or resets `.planning/config.json` (a git
 * checkout, stash, pull or branch switch dropping an uncommitted edit), the next
 * session restores the remembered values instead of asking again.
 */

const fs = require('node:fs');
const path = require('node:path');
const { usesChinese } = require('./localize.cjs');
const { nativeSelect } = require('./native-ui.cjs');
const { isGsdProject, planningFilePath, readProjectConfig } = require('./planning.cjs');
const { writeJsonAtomically } = require('./util.cjs');

const PROJECT_PREFERENCES_FILE = '.gsd-for-omp-project-preferences.json';

function hasExplicitTextMode(config) {
  return Object.prototype.hasOwnProperty.call(config?.workflow || {}, 'text_mode');
}

function persistOnboarding(cwd, config, language, textMode) {
  const nextConfig = { ...config, response_language: language };
  if (textMode !== undefined) nextConfig.workflow = { ...(config.workflow || {}), text_mode: textMode };
  return writeJsonAtomically(planningFilePath(cwd, 'config'), nextConfig);
}

function rememberedProjects(preferencesPath) {
  try {
    const projects = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'))?.projects;
    return projects && typeof projects === 'object' && !Array.isArray(projects) ? projects : {};
  } catch {
    return {};
  }
}

function projectPreferences(config) {
  const language = config.response_language;
  if (typeof language !== 'string' || !language.trim()) return null;
  const textMode = config.workflow?.text_mode;
  return typeof textMode === 'boolean' ? { response_language: language, text_mode: textMode } : { response_language: language };
}

function rememberedPreferences(projects, configPath) {
  if (!Object.hasOwn(projects, configPath)) return null;
  const entry = projects[configPath];
  return entry && typeof entry === 'object' ? projectPreferences({ response_language: entry.response_language, workflow: { text_mode: entry.text_mode } }) : null;
}

/**
 * Remember the project's configured language, or restore the remembered one when
 * the config has lost it. Returns true when the project config was rewritten.
 */
function syncProjectPreferences(ctx, preferencesPath) {
  const config = readProjectConfig(ctx.cwd);
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const configPath = path.resolve(planningFilePath(ctx.cwd, 'config'));
  const projects = rememberedProjects(preferencesPath);
  const current = projectPreferences(config);
  if (current) {
    const remembered = rememberedPreferences(projects, configPath);
    if (remembered?.response_language !== current.response_language || remembered?.text_mode !== current.text_mode) {
      writeJsonAtomically(preferencesPath, { projects: { ...projects, [configPath]: current } });
    }
    return false;
  }
  const remembered = rememberedPreferences(projects, configPath);
  if (!remembered) return false;
  const textMode = hasExplicitTextMode(config) ? undefined : remembered.text_mode;
  if (!persistOnboarding(ctx.cwd, config, remembered.response_language, textMode)) return false;
  if (ctx.hasUI) {
    ctx.ui?.notify?.(usesChinese(ctx.cwd)
      ? `已恢复 GSD 界面语言：${remembered.response_language}`
      : `Restored GSD language: ${remembered.response_language}`, 'info');
  }
  return true;
}

async function promptForOnboarding(ctx) {
  const config = readProjectConfig(ctx.cwd);
  if (!ctx.hasUI || !isGsdProject(ctx.cwd) || !config || config.response_language || (typeof ctx.ui?.select !== 'function' && typeof ctx.ui?.askDialog !== 'function')) return false;
  const languageSelection = await nativeSelect(ctx, 'GSD language / GSD 界面语言', [
    { label: '简体中文', description: 'Use Simplified Chinese for GSD status and guidance.' },
    { label: 'English', description: 'Use English for GSD status and guidance.' },
  ]);
  const languageLabel = typeof languageSelection === 'string' ? languageSelection : languageSelection?.label || languageSelection?.value;
  const language = languageLabel === '简体中文' ? 'Simplified Chinese' : languageLabel === 'English' ? 'English' : null;
  if (!language) return false;

  let textMode;
  if (!hasExplicitTextMode(config)) {
    const interactionSelection = await nativeSelect(ctx,
      language === 'Simplified Chinese' ? 'GSD 交互方式' : 'GSD interaction style',
      language === 'Simplified Chinese'
        ? [
          { label: 'OMP 交互式（推荐）', description: '使用结构化单选和多选控件。' },
          { label: '终端文本式', description: '显示编号列表；通过输入 1,3 作答。' },
        ]
        : [
          { label: 'OMP interactive (recommended)', description: 'Use structured single-select and multi-select controls.' },
          { label: 'Terminal text', description: 'Show numbered lists; answer by typing 1,3.' },
        ],
    );
    const interactionLabel = typeof interactionSelection === 'string' ? interactionSelection : interactionSelection?.label || interactionSelection?.value;
    if (interactionLabel === '终端文本式' || interactionLabel === 'Terminal text') textMode = true;
    else if (interactionLabel === 'OMP 交互式（推荐）' || interactionLabel === 'OMP interactive (recommended)') textMode = false;
    else return false;
  }

  if (!persistOnboarding(ctx.cwd, config, language, textMode)) return false;
  const chinese = language === 'Simplified Chinese';
  ctx.ui.notify?.(chinese ? 'GSD 界面语言已设置为简体中文' : 'GSD language set to English', 'info');
  if (textMode !== undefined) ctx.ui.notify?.(chinese ? (textMode ? 'GSD 交互方式已设置为终端文本' : 'GSD 交互方式已设置为 OMP 交互式') : (textMode ? 'GSD interaction set to terminal text' : 'GSD interaction set to OMP interactive'), 'info');
  return true;
}

/**
 * Restores or remembers the project language, then schedules the onboarding
 * prompt once per project (`state.onboardingPromptCwds`) when none is known.
 */
function createOnboarding({ state, updateStatus, runtimeRoot }) {
  const { onboardingPromptCwds } = state;
  const preferencesPath = path.join(runtimeRoot, PROJECT_PREFERENCES_FILE);

  function scheduleOnboardingPrompt(ctx) {
    const projectPath = path.resolve(ctx.cwd);
    if (onboardingPromptCwds.has(projectPath)) return;
    if (syncProjectPreferences(ctx, preferencesPath)) return;
    onboardingPromptCwds.add(projectPath);
    void promptForOnboarding(ctx)
      .then((changed) => {
        if (!changed) return;
        syncProjectPreferences(ctx, preferencesPath);
        updateStatus(ctx);
      })
      .catch(() => {})
      .finally(() => onboardingPromptCwds.delete(projectPath));
  }

  return {
    scheduleOnboardingPrompt,
  };
}

module.exports = {
  createOnboarding,
};
