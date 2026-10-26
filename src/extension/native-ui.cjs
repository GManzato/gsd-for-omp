'use strict';

/**
 * OMP-native dialogs, message renderers, status overlay, shortcut and flag registration.
 */

const { usesChinese } = require('./localize.cjs');
const { readNextAction } = require('./planning-store.cjs');

async function nativeSelect(ctx, title, options, dialogOptions) {
  if (typeof ctx.ui?.askDialog === 'function') {
    const questionOptions = (Array.isArray(options) ? options : []).map((option) => {
      if (typeof option === 'string') return { label: option };
      return { label: option?.label || option?.value || '', description: option?.description, preview: option?.preview };
    }).filter((option) => option.label);
    try {
      const result = await ctx.ui.askDialog([{
        id: 'choice',
        question: title,
        header: title,
        options: questionOptions,
        multi: false,
        recommended: questionOptions.length ? 0 : undefined,
      }], dialogOptions);
      if (result?.kind === 'submit') return result.results?.find((item) => item.id === 'choice')?.selectedOptions?.[0];
      return undefined;
    } catch {
      // Fall back to the classic selector when the rich dialog is unavailable.
    }
  }
  return typeof ctx.ui?.select === 'function' ? ctx.ui.select(title, options, dialogOptions) : undefined;
}

const nativeMessageWorkflowNames = Object.freeze([
  'add-tests', 'ai-integration', 'audit-fix', 'audit-milestone', 'audit-uat', 'autonomous',
  'code-review', 'complete-milestone', 'debug', 'discuss-phase', 'eval-review', 'execute-phase',
  'fast', 'import', 'mvp-phase', 'new-milestone', 'new-project', 'pause-work', 'phase',
  'plan-phase', 'pr-branch', 'progress', 'quick', 'resume-work', 'secure-phase', 'settings',
  'ship', 'spec-phase', 'ui-phase', 'ui-review', 'undo', 'update', 'validate-phase',
  'verify-work', 'workspace', 'workstreams',
]);

const nativeMessageTypes = new Set([
  'gsd-command-result', 'gsd-status-summary', 'gsd-next-step', 'gsd-start-project',
  'gsd-continuation', 'gsd-continuation-deferred', 'gsd-continuation-dismissed',
  'gsd-continuation-error', 'gsd-continuation-preview', 'gsd-native-continuation',
  'gsd-native-skill-command', 'gsd-native-tasks-active', 'gsd-native-abort', 'gsd-native-compact', 'gsd-native-session', 'gsd-goal-mode-active', 'gsd-projected-skill-input-error', 'gsd-ship-ready', 'gsd-resume-ready',
  'gsd-workflow-advisory', 'gsd-hook-advisory', 'gsd-execute-isolation-required',
]);

for (const name of nativeMessageWorkflowNames) {
  nativeMessageTypes.add(`gsd-native-${name}`);
  nativeMessageTypes.add(`gsd-${name}-input-error`);
  nativeMessageTypes.add(`gsd-${name}-cancelled`);
}

function messageContentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n');
}

function nativeMessageTitle(customType) {
  const raw = String(customType || 'gsd-message').replace(/^gsd-/, '').replace(/^native-/, '');
  return raw.split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

/**
 * Message renderers, status overlay and shortcut/flag registration for one host API.
 */
function createNativeUi({ pi, localizedStatusSummary, nativeRuntimeStatusLines }) {
  function renderGsdMessage(message, _options, theme) {
    const Text = pi.pi?.Text;
    if (typeof Text !== 'function') return undefined;
    const customType = String(message?.customType || 'gsd-message');
    const raw = messageContentText(message?.content).trim();
    const body = raw.replace(/^# OMP (?:native|projected) GSD[^\r\n]*(?:\r?\n)+/i, '').trim();
    const tone = /(?:error|failed|cancelled)/i.test(customType)
      ? 'error'
      : /(?:active|advisory|deferred|resume|attention)/i.test(customType)
        ? 'warning'
        : 'accent';
    const label = `GSD · ${nativeMessageTitle(customType)}`;
    const styledLabel = typeof theme?.fg === 'function' ? theme.fg(tone, label) : label;
    const renderedLabel = typeof theme?.bold === 'function' ? theme.bold(styledLabel) : styledLabel;
    return new Text(body ? `${renderedLabel}\n${body}` : renderedLabel, 0, 0);
  }

  function registerGsdMessageRenderers() {
    if (typeof pi.registerMessageRenderer !== 'function' || typeof pi.pi?.Text !== 'function') return false;
    for (const customType of nativeMessageTypes) pi.registerMessageRenderer(customType, renderGsdMessage);
    return true;
  }

  function nativeStatusOverlayText(ctx, theme) {
    const chinese = usesChinese(ctx.cwd);
    const title = chinese ? 'GSD / OMP 状态' : 'GSD / OMP STATUS';
    const hint = chinese ? 'Esc 关闭 · e 编辑下一步命令' : 'Esc close · e edit the next action';
    const styledTitle = typeof theme?.bold === 'function'
      ? theme.bold(typeof theme?.fg === 'function' ? theme.fg('accent', title) : title)
      : title;
    const body = [localizedStatusSummary(ctx.cwd), ...nativeRuntimeStatusLines(ctx)].filter(Boolean).join('\n');
    return `${styledTitle}\n\n${body}\n\n${typeof theme?.fg === 'function' ? theme.fg('dim', hint) : hint}`;
  }

  async function editNativeNextAction(ctx) {
    const chinese = usesChinese(ctx.cwd);
    if (typeof ctx.ui?.editor !== 'function') {
      ctx.ui?.notify?.(chinese ? '当前 OMP 没有提供编辑器接口。' : 'The current OMP runtime does not expose an editor.', 'warning');
      return;
    }
    const action = readNextAction(ctx.cwd);
    let edited;
    try {
      edited = await ctx.ui.editor(
        chinese ? '编辑 GSD 下一步命令' : 'Edit GSD next action',
        action?.command || '',
      );
    } catch {
      return;
    }
    if (typeof edited !== 'string' || !edited.trim()) return;
    ctx.ui.setEditorText?.(edited.trim());
    ctx.ui.notify?.(chinese ? '下一步命令已载入编辑器。' : 'The next action is loaded into the editor.', 'info');
  }

  async function showNativeStatusOverlay(ctx) {
    const fallback = async () => {
      const content = [localizedStatusSummary(ctx.cwd), ...nativeRuntimeStatusLines(ctx)].filter(Boolean).join('\n');
      await pi.sendMessage({ customType: 'gsd-status-summary', content, display: true }, { triggerTurn: false });
    };
    const Container = pi.pi?.Container;
    const Text = pi.pi?.Text;
    if (!ctx.hasUI || typeof ctx.ui?.custom !== 'function' || typeof Container !== 'function' || typeof Text !== 'function') return fallback();
    let result;
    try {
      result = await ctx.ui.custom((tui, theme, _keybindings, done) => {
        const container = new Container();
        const text = new Text(nativeStatusOverlayText(ctx, theme), 1, 1);
        container.addChild(text);
        let closed = false;
        const timer = typeof ctx.setInterval === 'function'
          ? ctx.setInterval(() => {
            const next = nativeStatusOverlayText(ctx, theme);
            if (typeof text.setText === 'function' && text.setText(next)) {
              container.invalidate?.();
              tui.requestRender?.();
            }
          }, 500)
          : null;
        const close = (value) => {
          if (closed) return;
          closed = true;
          if (timer && typeof ctx.clearTimer === 'function') ctx.clearTimer(timer);
          done(value);
        };
        container.handleInput = (data) => {
          if (data === '\u001b' || data === '\u0003' || data === '\r' || data === '\n') close('close');
          else if (data === 'e' || data === 'E') close('edit');
        };
        container.dispose = () => {
          if (timer && typeof ctx.clearTimer === 'function') ctx.clearTimer(timer);
        };
        return container;
      }, { overlay: true });
    } catch {
      return fallback();
    }
    if (result === 'edit') await editNativeNextAction(ctx);
  }

  function registerNativeUiIntegrations() {
    if (typeof pi.registerShortcut === 'function') {
      pi.registerShortcut('ctrl+shift+g', {
        description: 'Open the GSD status overlay.',
        handler: async (ctx) => showNativeStatusOverlay(ctx),
      });
    }
    if (typeof pi.registerFlag === 'function') {
      pi.registerFlag('gsd-status', {
        description: 'Open the GSD status overlay when the OMP session starts.',
        type: 'boolean',
        default: false,
      });
    }
  }

  return {
    registerGsdMessageRenderers,
    registerNativeUiIntegrations,
    showNativeStatusOverlay,
  };
}

module.exports = {
  createNativeUi,
  nativeMessageTitle,
  nativeSelect,
};
