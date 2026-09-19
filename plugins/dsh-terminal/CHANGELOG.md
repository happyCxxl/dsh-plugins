# Changelog — @cxxl/dsh-terminal

本插件版本记录（语义化版本）。

## Unreleased

- 元数据与文档对齐规范：安装示例改两通道（npm/tarball，删目录安装）、engines 统一官方口径、补 `publishConfig`（2026-09-19，随下次发布生效）。

## 0.1.7 — 2026-09-19

- fix: 终端输入自动聚焦、修复输出滚动跳动。
- 状态：仓库版本 0.1.7，**npm 最新仍为 0.1.6**（尚未发布，见仓库 `docs/AUDIT.md` B1）。

## 0.1.0 — 2026-09-18

- 首个入库版本：交互式 PowerShell 终端视图（真实 PTY，spawn/write/read/close 同源 API，浏览器端 ANSI 渲染）。
- 0.1.1–0.1.6 的版本号存在于 npm，但变更记录未留档（早期迭代）。
