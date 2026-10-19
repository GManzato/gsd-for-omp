'use strict';

/**
 * /gsd-status session controls: stop, compact and native session actions.
 */

const { usesChinese } = require('./localize.cjs');
const { contextUsageFor } = require('./status.cjs');
const { parseCommandLine } = require('./util.cjs');

function nativeSessionControlRequest(input) {
  const tokens = parseCommandLine(input);
  const entryId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
  if (tokens.length === 1 && tokens[0] === '--reload') return { operation: 'reload' };
  if (tokens.length === 2 && tokens[0] === '--branch' && entryId(tokens[1])) return { operation: 'branch', target: tokens[1] };
  if (tokens[0] === '--tree' && (tokens.length === 2 || tokens.length === 3) && entryId(tokens[1]) && (tokens.length === 2 || tokens[2] === '--summarize')) {
    return { operation: 'tree', target: tokens[1], summarize: tokens[2] === '--summarize' };
  }
  if (tokens.length === 2 && tokens[0] === '--switch' && tokens[1] && !tokens[1].includes('\0') && !/[\r\n]/.test(tokens[1]) && tokens[1].length <= 1024) {
    return { operation: 'switch', target: tokens[1] };
  }
  return null;
}

/**
 * /gsd-status session controls (stop, compact, native session actions).
 */
function createSessionControls({ pi, goalModeActiveFor, nativeTaskActivityCount, setNativeRuntimeSignal, updateStatus }) {
  async function abortNativeOperation(ctx) {
    const chinese = usesChinese(ctx.cwd);
    const goalActive = goalModeActiveFor(ctx);
    if (typeof ctx.abort !== 'function') {
      await pi.sendMessage({
        customType: 'gsd-native-abort',
        content: chinese ? '当前 OMP 运行时没有提供中止接口。' : 'The current OMP runtime does not expose an abort operation.',
        display: true,
      }, { triggerTurn: false });
      return;
    }
    const activeTaskCount = nativeTaskActivityCount(ctx.cwd);
    if (!activeTaskCount && typeof ctx.isIdle === 'function' && ctx.isIdle()) {
      if (goalActive) {
        await pi.sendMessage({
          customType: 'gsd-goal-mode-active',
          content: chinese
            ? '当前没有正在运行的 GSD turn，但 OMP 目标模式仍会自动续接。请运行 /goal pause 暂停目标，再运行 /gsd-next。'
            : 'No GSD turn is currently running, but OMP Goal Mode may continue automatically. Run /goal pause to pause the goal, then run /gsd-next.',
          display: true,
        }, { triggerTurn: false });
      } else {
        await pi.sendMessage({
          customType: 'gsd-native-abort',
          content: chinese ? '当前没有正在运行的 GSD 操作。' : 'No GSD operation is currently running.',
          display: true,
        }, { triggerTurn: false });
      }
      return;
    }
    let confirmed = false;
    try {
      confirmed = typeof ctx.ui?.confirm === 'function' && await ctx.ui.confirm(
        chinese ? '停止当前 GSD 操作？' : 'Stop the current GSD operation?',
        goalActive
          ? (chinese ? '这会请求 OMP 中止当前 agent turn；Goal Mode 会按 OMP 原生规则暂停当前目标，已派发的异步任务仍会保留并继续被跟踪。' : 'This asks OMP to abort the current agent turn; OMP will pause the active Goal Mode objective according to its native rules, while detached tasks remain tracked.')
          : (chinese ? '这会请求 OMP 中止当前 agent turn；已派发的异步任务仍会保留并继续被跟踪。' : 'This asks OMP to abort the current agent turn; already detached tasks remain tracked.'),
      );
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      await pi.sendMessage({
        customType: 'gsd-native-abort',
        content: chinese ? '已取消停止请求。' : 'Stop request cancelled.',
        display: true,
      }, { triggerTurn: false });
      return;
    }
    setNativeRuntimeSignal(ctx.cwd, { kind: 'stopping' });
    updateStatus(ctx);
    try {
      ctx.abort();
      await pi.sendMessage({
        customType: 'gsd-native-abort',
        content: goalActive
          ? (chinese ? '已请求 OMP 停止当前 GSD 操作；目标模式会按 OMP 原生规则处理后续续接。' : 'OMP was asked to stop the current GSD operation; Goal Mode continuation will follow OMP native rules.')
          : (chinese ? '已请求 OMP 停止当前 GSD 操作。' : 'OMP was asked to stop the current GSD operation.'),
        display: true,
      }, { triggerTurn: false });
    } catch {
      setNativeRuntimeSignal(ctx.cwd, null);
      updateStatus(ctx);
      await pi.sendMessage({
        customType: 'gsd-native-abort',
        content: chinese ? '停止请求失败；当前 GSD 状态已保留。' : 'The stop request failed; the current GSD state was preserved.',
        display: true,
      }, { triggerTurn: false });
    }
  }

  async function compactNativeContext(ctx) {
    const chinese = usesChinese(ctx.cwd);
    if (typeof ctx.compact !== 'function') {
      await pi.sendMessage({
        customType: 'gsd-native-compact',
        content: chinese ? '当前 OMP 运行时没有提供上下文压缩接口。' : 'The current OMP runtime does not expose context compaction.',
        display: true,
      }, { triggerTurn: false });
      return;
    }
    const usage = contextUsageFor(ctx);
    let confirmed = false;
    try {
      confirmed = typeof ctx.ui?.confirm === 'function' && await ctx.ui.confirm(
        chinese ? '压缩当前 OMP 上下文？' : 'Compact the current OMP context?',
        usage
          ? (chinese ? `当前使用量约为 ${usage.percent}%。压缩会保留会话状态并减少上下文占用。` : `Current usage is about ${usage.percent}%. Compaction preserves the session while reducing context size.`)
          : (chinese ? '压缩会保留会话状态并减少上下文占用。' : 'Compaction preserves the session while reducing context size.'),
      );
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      await pi.sendMessage({
        customType: 'gsd-native-compact',
        content: chinese ? '已取消上下文压缩。' : 'Context compaction cancelled.',
        display: true,
      }, { triggerTurn: false });
      return;
    }
    setNativeRuntimeSignal(ctx.cwd, { kind: 'compacting', reason: 'manual', action: 'context-full' });
    updateStatus(ctx);
    try {
      await ctx.compact();
      setNativeRuntimeSignal(ctx.cwd, null);
      updateStatus(ctx);
      await pi.sendMessage({
        customType: 'gsd-native-compact',
        content: chinese ? 'OMP 上下文压缩已完成。' : 'OMP context compaction completed.',
        display: true,
      }, { triggerTurn: false });
    } catch (error) {
      setNativeRuntimeSignal(ctx.cwd, null);
      updateStatus(ctx);
      await pi.sendMessage({
        customType: 'gsd-native-compact',
        content: chinese ? `上下文压缩失败：${error instanceof Error ? error.message : String(error)}` : `Context compaction failed: ${error instanceof Error ? error.message : String(error)}`,
        display: true,
      }, { triggerTurn: false });
    }
  }

  async function runNativeSessionControl(ctx, input) {
    const request = nativeSessionControlRequest(input);
    if (!request) return false;
    const chinese = usesChinese(ctx.cwd);
    const target = request.target ? ` ${request.target}` : '';
    let confirmed = true;
    if (ctx.hasUI && typeof ctx.ui?.confirm === 'function') {
      try {
        confirmed = await ctx.ui.confirm(
          chinese ? '切换 OMP Session 状态？' : 'Change the OMP session state?',
          chinese ? `将执行 ${request.operation}${target}。当前会话历史会保留，但活动上下文可能改变。` : `This will run ${request.operation}${target}. Session history is preserved, but the active context may change.`,
        );
      } catch {
        confirmed = false;
      }
    }
    if (!confirmed) {
      await pi.sendMessage({
        customType: 'gsd-native-session',
        content: chinese ? '已取消 Session 操作。' : 'Session operation cancelled.',
        display: true,
      }, { triggerTurn: false });
      return true;
    }
    try {
      await ctx.waitForIdle?.();
      let result;
      if (request.operation === 'reload') result = await ctx.reload?.();
      else if (request.operation === 'branch') result = await ctx.branch?.(request.target);
      else if (request.operation === 'tree') result = await ctx.navigateTree?.(request.target, { summarize: request.summarize });
      else result = await ctx.switchSession?.(request.target);
      const cancelled = result?.cancelled === true;
      const operationLabel = chinese
        ? { reload: '重新加载', branch: '创建分支', tree: '导航 Session 树', switch: '切换 Session' }[request.operation]
        : { reload: 'Reload', branch: 'Branch', tree: 'Navigate session tree', switch: 'Switch session' }[request.operation];
      const content = cancelled
        ? (chinese ? `${operationLabel} 已取消。` : `${operationLabel} cancelled.`)
        : (chinese ? `${operationLabel} 已完成${target}。` : `${operationLabel} completed${target}.`);
      updateStatus(ctx);
      await pi.sendMessage({ customType: 'gsd-native-session', content, display: true }, { triggerTurn: false });
    } catch (error) {
      await pi.sendMessage({
        customType: 'gsd-native-session',
        content: chinese ? `Session 操作失败：${error instanceof Error ? error.message : String(error)}` : `Session operation failed: ${error instanceof Error ? error.message : String(error)}`,
        display: true,
      }, { triggerTurn: false });
    }
    return true;
  }

  return {
    abortNativeOperation,
    compactNativeContext,
    runNativeSessionControl,
  };
}

module.exports = {
  createSessionControls,
};
