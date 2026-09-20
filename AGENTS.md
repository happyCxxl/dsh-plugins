# AGENTS.md — dsh-plugins 会话入口

个人 DeepSeek Harness（DSH）插件仓库：`plugins/` 内每个插件是独立 npm 包，`scripts/` 是仓库工具。以本仓库为工作区的会话会自动注入本文件；任何会话动手改代码前，先读 [docs/PLUGIN_SPEC.md](docs/PLUGIN_SPEC.md)（开发规范）。

## 文档地图（一事实一归属）

- `docs/PLUGIN_SPEC.md` — 插件开发规范（契约，应然）：目录结构、package.json / cordis.patch.yml / Host / Client 契约、发布与验证流程。改代码前必读；改动涉及契约时必须同步更新它。
- `docs/AUDIT.md` — 现状偏差与整改路线（实然）：B1–B14 偏差清单 + Step 1–4 路线；修完一条勾一条。
- `README.md` — 仓库总览（含目录结构表）；`plugins/<pkg>/README.md` — 单个插件的用途与设计。
- Harness 权威文档（只读参考，不要改）：`D:\application\dsh\deepseek-harness\docs\cordis-primer.md`、`docs\cordis-api\`、`docs\cookbook\`。

## 常驻铁律

1. 改代码前先读 `docs/PLUGIN_SPEC.md`；任何影响插件契约、目录结构、发布流程的代码改动，必须同一 commit 更新对应文档。
2. 本仓库公开：禁止提交密钥、npm token、私密配置；插件 README 写清用途、权限与副作用。
3. 不改 DSH 自带预设与宿主核心；插件不得放松沙箱边界；所有副作用随 `ctx.effect` 回收，waterfall 监听默认必须 `next()`（仅有意短路、拥有决策时例外）。
4. 本地安装用 tarball 通道（目录 `add` 有 junction 悬空陷阱）；`dsh plugin add` 安装后必须重启 DSH。
5. 不得擅自执行任何 git 操作（add / commit / push / checkout / reset 等）；git 操作必须由用户明确指示。
