# GSD for Oh My Pi

[![CI](https://img.shields.io/github/actions/workflow/status/GManzato/gsd-for-omp/ci.yml?branch=main&logo=githubactions&logoColor=white&label=CI)](https://github.com/GManzato/gsd-for-omp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/gsd-for-omp?logo=npm&label=npm)](https://www.npmjs.com/package/gsd-for-omp)
[![License: MIT](https://img.shields.io/github/license/GManzato/gsd-for-omp?color=blue)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org)

[English](./README.md) · **简体中文**

`gsd-for-omp` 是面向 [GSD 嵌入式编排系统](https://github.com/open-gsd/gsd-core/blob/next/docs/explanation/embeddable-orchestration-system.md)的 Oh My Pi（OMP）宿主插件。它通过公共 Host-Integration SDK 的协议版本 1，将 OMP 原生的扩展、命令、事件、任务与文件系统接口绑定到 GSD。在提供 Goal Mode 的主机上，它会把可选的目标状态同步到 GSD 状态界面，但不会接管 OMP 的 GoalRuntime。

本项目为第三方软件，未由 OpenGSD 背书、审查或维护。它派生自 [tchivs/gsd-omp](https://github.com/tchivs/gsd-omp)，现作为独立项目继续维护。

## 环境要求

- Node.js 24 或更高版本
- 启用原生 ExtensionAPI 的 Oh My Pi
- GSD Core 1.12.0 或更高版本，作为本包的依赖自动安装

## 安装

```bash
npm install --global gsd-for-omp
gsd-for-omp install
```

`gsd-for-omp install` 会把托管的扩展、agents 与 skills 投影到 OMP（`~/.omp/agent`，设置了 `PI_CODING_AGENT_DIR` 时则为该目录）。随后重启 OMP，并校验安装：

```bash
gsd-for-omp doctor
```

健康的安装会报告 `"ok": true`、EoS profile 为 `programmatic-cli`、协议版本为 `1`。

## 使用

在 OMP 会话中、项目目录下：

```text
/gsd-next                           # 显示或准备下一个 GSD 动作
/gsd-status                         # 项目摘要、上下文预算、原生任务状态
/gsd-progress                       # 显示进度，或推进带门控的下一步
/gsd-plan-phase 1                   # 规划一个阶段
/gsd-execute-phase 1                # 通过 OMP 原生任务波次执行一个阶段
/gsd <family> <subcommand> [args]   # 直接调用公共 gsd-tools CLI
```

`gsd_invoke` 工具让 agent 以结构化方式访问同一个 `gsd-tools` CLI。所有 `/gsd-*` 命令都会出现在 OMP 的命令列表中；完整目录见[入门指南](docs/GETTING-STARTED.md#commands)。

## OMP 集成

- **状态 overlay** —— `Ctrl+Shift+G` 打开实时 GSD 状态 overlay（也可在启动时用 `--gsd-status` flag 打开）；widget 与 footer 显示同样的状态。
- **原生控制** —— `/gsd-status` 接受 `--compact`、`--stop`、`--branch`、`--tree`、`--switch`、`--reload`，对应 OMP 的原生会话控制。
- **Goal Mode** —— 当主机提供 `goal_updated` 事件时，目标、状态与 token 预算会同步到 `/gsd-status`；运行 `/gsd-next` 前请先暂停或放弃目标（`/goal pause`、`/goal drop`）。没有该事件的主机（如 OMP 17）仍可使用其余全部功能。
- **模型** —— 模型由 OMP 掌管。请使用 OMP 的 `/model` 切换；GSD 的 `model_profile` 设置在 OMP 下不起作用。详见[配置参考](docs/CONFIGURATION.md#model-routing)。

## 更新与卸载

```bash
gsd-for-omp update      # 从 npm 安装最新版本并重新投影；之后重启 OMP
gsd-for-omp uninstall   # 移除托管的 OMP 产物
npm uninstall --global gsd-for-omp
```

安装器会拒绝覆盖未托管或已被本地修改的文件；使用 `--force` 之前请阅读[配置参考](docs/CONFIGURATION.md#manifest-ownership-and---force)。Shell 输出通过 `GSD_FOR_OMP_LOCALE`、`LC_ALL`、`LC_MESSAGES`、`LANG` 本地化（英文与简体中文），详见[配置参考](docs/CONFIGURATION.md#environment-variables)。

## 文档

| 文档 | 用途 |
|---|---|
| [入门指南](docs/GETTING-STARTED.md) | 安装、校验、使用、升级与故障排查；命令目录 |
| [架构说明](docs/ARCHITECTURE.md) | 运行时边界、EoS 契约、数据流、投影和 OMP 集成 |
| [配置参考](docs/CONFIGURATION.md) | 环境变量、CLI 参数、模型路由、清单所有权与 Goal Mode 协调 |
| [开发指南](docs/DEVELOPMENT.md) | 本地开发、打包、host smoke 与发布流程 |
| [测试指南](docs/TESTING.md) | 单元测试和 OMP 宿主验证说明 |
| [贡献指南](./CONTRIBUTING.md) | 贡献、Pull Request 与文档规范 |
| [CHANGELOG](./CHANGELOG.md) | 按版本整理的发布历史 |

## 致谢

OMP 扩展最初基于 `open-gsd/gsd-core` 中以 MIT 许可发布的 pi 参考宿主，后被改造为这个独立维护的 EoS 插件。上游 Open GSD 的版权声明保留在 `LICENSE` 中。

## 许可证

MIT
