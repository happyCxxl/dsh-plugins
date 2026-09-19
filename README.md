# dsh-plugins

个人 DSH（DeepSeek Harness）插件开发与管理仓库。

## 目录结构

| 目录 | 用途 |
|---|---|
| `plugins/` | 正式插件，每个插件 = 独立 npm 包（`dsh plugin add` 一条命令安装），约定见 `plugins/README.md` |
| `scripts/` | 仓库工具脚本（`check-publish-files.mjs`：发布前校验 files 白名单） |

## 文档

| 文档 | 用途 |
|---|---|
| `docs/PLUGIN_SPEC.md` | 插件开发规范（权威）：结构、契约、发布与验证。改代码前必读 |
| `docs/AUDIT.md` | 现状偏差与整改路线（B1–B14 清单） |
| `dsh-plugin-dev-notes.md` | 踩坑调研证据（编号 A1–E17） |
| `AGENTS.md` | 面向 AI 会话的常驻铁律与文档地图（会话自动注入） |

## 注意事项

- 不要修改 DSH 自带（deployment 内置）的预设（如 `cordis`）与宿主核心。
- 正式插件以独立 npm 包发布，用户通过 `dsh plugin --profile <name> add <包名>` 安装；会话内 `cordis_define` 的临时实验代码不直接对外分发。
- 本仓库公开：请勿提交任何密钥、npm token 或私人敏感配置。
