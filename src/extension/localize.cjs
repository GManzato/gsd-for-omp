'use strict';

/**
 * Project-language (response_language) helpers for in-session messages.
 */

const { readProjectConfig } = require('./planning.cjs');

function usesChinese(cwd) {
  const language = String(readProjectConfig(cwd)?.response_language || '');
  return /(^zh\b|chinese|中文)/i.test(language);
}

function localizedUsage(cwd, syntax) {
  return usesChinese(cwd) ? `用法：${String(syntax).replace(/^Usage:\s*/, '')}` : syntax;
}

function localizedMessage(cwd, english, chinese) {
  return usesChinese(cwd) ? chinese : english;
}

function localizedStatus(status, cwd) {
  const label = {
    executing: { en: 'Executing', zh: '执行中' },
    planning: { en: 'Planning', zh: '规划中' },
    verifying: { en: 'Verifying', zh: '验证中' },
    blocked: { en: 'Blocked', zh: '已阻塞' },
    ready_for_verification: { en: 'Ready to verify', zh: '待验证' },
    completed: { en: 'Completed', zh: '已完成' },
  }[status];
  return label ? label[usesChinese(cwd) ? 'zh' : 'en'] : status;
}

function localizedNextStep(nextStep, cwd) {
  if (!nextStep || !usesChinese(cwd)) return nextStep;
  return {
    'Ready for phase verification': '等待阶段验证',
  }[nextStep] || nextStep;
}

function riskSummary(state, chinese) {
  if (!state.blockers && !state.concerns) return chinese ? '无' : 'None';
  const parts = [];
  if (state.blockers) parts.push(chinese ? `⛔ ${state.blockers} 阻塞` : `⛔ ${state.blockers} blocker${state.blockers === 1 ? '' : 's'}`);
  if (state.concerns) parts.push(chinese ? `⚠ ${state.concerns} 关注` : `⚠ ${state.concerns} concern${state.concerns === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

module.exports = {
  localizedMessage,
  localizedNextStep,
  localizedStatus,
  localizedUsage,
  riskSummary,
  usesChinese,
};
