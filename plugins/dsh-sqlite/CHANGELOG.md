# Changelog — @cxxl/dsh-sqlite

本插件版本记录（语义化版本）。

## Unreleased

- 元数据与文档对齐规范：description 中文化、补 `publishConfig`、Host `name` 改短名、`npm run smoke` 冒烟接线、补「依赖策略/权限与副作用」文档（2026-09-19，随下次发布生效）。

## 0.3.2 — 2026-09-11

- fix: `CallId` → `ToolCallId`，兼容 dsh-llm 0.1.2-alpha.5。

## 0.3.1 — 2026-09-10

- fix: 修复发布包漏掉 `coordination.js`。

## 0.2.x（2026-09-08 ~ 09-09，具体版本号未留档）

- feat v2: 跨会话协作感知——命名库、meta 表、变更提醒、新库广播、表级提示、盘点去噪。
- feat v1.2: 持久化使用提示词规则（systemPrompt.section，order 1000）。
- feat v1.1: 只读表浏览设置页（settings.section + 同源只读路由）。
- fix: 库亲和隔离（未触碰库不再刷屏提醒）、db 删除工具。

## 0.1.1 — 2026-09-04

- chore: 管线验证发布。

## 0.1.0 — 2026-08-31

- 首个发布版：五个持久 SQLite 工具（query / exec / tables / export / import），scoped 包 `@cxxl/dsh-sqlite`。
