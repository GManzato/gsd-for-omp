'use strict';

/**
 * First-run language and interaction-style prompt persisted to .planning/config.json.
 */

const path = require('node:path');
const { nativeSelect } = require('./native-ui.cjs');
const { isGsdProject, planningFilePath, readProjectConfig } = require('./planning.cjs');
const { writeJsonAtomically } = require('./util.cjs');

function hasExplicitTextMode(config) {
  return Object.prototype.hasOwnProperty.call(config?.workflow || {}, 'text_mode');
}

function persistOnboarding(cwd, config, language, textMode) {
  const nextConfig = { ...config, response_language: language };
  if (textMode !== undefined) nextConfig.workflow = { ...(config.workflow || {}), text_mode: textMode };
  return writeJsonAtomically(planningFilePath(cwd, 'config'), nextConfig);
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
 * Schedules the onboarding prompt once per project (`state.onboardingPromptCwds`).
 */
function createOnboarding({ state, updateStatus }) {
  const { onboardingPromptCwds } = state;

  function scheduleOnboardingPrompt(ctx) {
    const projectPath = path.resolve(ctx.cwd);
    if (onboardingPromptCwds.has(projectPath)) return;
    onboardingPromptCwds.add(projectPath);
    void promptForOnboarding(ctx)
      .then((changed) => { if (changed) updateStatus(ctx); })
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
