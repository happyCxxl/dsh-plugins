# docs/AUDIT.md — 审计结论与整改路线

> 审计日期：2026-09-19。审计基线：harness 官方契约与社区工具链（dsh-plugin-guide），**不是**本仓库自产文档——避免"用自己的文档审计自己代码"的循环论证。
> 本文件是整改工作清单：修完一条就勾选并在"完成记录"写 commit，未修的保持未勾。契约本身见 PLUGIN_SPEC.md，本文件只记录差距。
> 整改原则：**非逻辑类**（元数据/文档/注释/仓库卫生）先改，**逻辑类**（行为相关）单独评估后动，任何修改不得改变已有运行逻辑。

## 偏差清单

| # | 级别 | 涉及 | 问题 | 状态 |
|---|---|---|---|---|
| B1 | 🔴 | dsh-terminal | 仓库版本 0.1.7，npm 最新仍是 0.1.6——发布没闭环 | ⏸ 暂缓（发布动作延后，用户决定） |
| B2 | 🔴 | dsh-image-reader | npm 上查不到该包（从未发布），README 却教 `add @cxxl/dsh-image-reader`——按文档装不上 | ⏸ 暂缓（发布或改文档，用户决定延后） |
| B3 | 🔴 | peek / terminal / ui-restyle | patch 注释与 README 示例教 `add ./plugins/<目录>`——pnpm link（Windows 即 junction）悬空陷阱 | ✅ 已改：三份 patch 注释 + 两份 README 改两通道（npm / tarball） |
| B4 | 🟠 | 全部 | engines 口径不一；官方口径 `^22.19.0 \|\| >=24.0.0` | ✅ 已改：4 包统一官方口径；sqlite 保留 `>=22.5`（node:sqlite 硬要求，README 已说明） |
| B5 | 🟠 | 全部 | 三种依赖策略并存且无文档 | ✅ 已改：各 README 补「依赖策略」节（sqlite=peer 复用 / peek·terminal·ui-restyle=零 import / image-reader=Config 形态） |
| B6 | 🟠 | peek / terminal / ui-restyle | 客户端绕过 Slot 体系：猜 DOM、全局扫描、直接改 `document.head`（sqlite 面板已走 `slots.register`，此前误列，已更正） | ✅ 完成：peek（浮层 + turnTail 链 + 节点定义官方化，点击接管为文档化偏差）、terminal 全官方化；ui-restyle 字体走官方 `overrideTokens`，折叠保留为**文档化约定偏差**（调研证据：data-* 层 20 发布版零破坏；接管渲染路线高风险已放弃，见其 README 脆弱面清单） |
| B7 | 🟠 | 全部 client+host | 自建 `webServer.register` 同源路由 + fetch 是否合规 | ✅ 已解决（调研定性）：`webServer` 是公开 Service 契约，feature 插件自持路由被官方承认（README 原文 "feature plugins own every route"）；`harness.handle`/`host.call` 仅限动态插件、新增 Remote 为构建期装配，npm 插件均不可用。规范 §6/§7 已写明通道与安全边界 |
| B8 | 🟡 | sqlite / image-reader | Host `name` 导出带 scope 全名，官方一律短名 | ✅ 已改：两处改短名（`dsh-sqlite` / `dsh-image-reader`） |
| B9 | 🟡 | dsh-peek | 客户端按中文文案匹配 tab 点击（0.5.0 曾移除） | 🟡 重定（0.5.1）：「预览」tab 已删除——预览与官方一致走 `shell.overlay` 浮层；点击接管作为文档化约定偏差恢复（官方 openFile 无接管钩子；data-* 层 20 发布版零破坏） |
| B10 | 🟡 | 全部 | description 语言混用 | ✅ 已改：统一中文 |
| B11 | 🟡 | ui-restyle | 缺 `repository`；误跟踪 `pnpm-lock.yaml`；字体重复 | ✅ 已改：补 repository、移除 pnpm-lock；`design/fonts/` 保留（原型 HTML 自包含引用 `./fonts/`，不属发布物） |
| B12 | 🟡 | dsh-sqlite | `scripts/` 未挂接、无说明 | ✅ 已改：`smoke.mjs` 接线为 `npm run smoke`（有 PASS/FAIL 断言与退出码）；`noise-check.mjs` 删除（一次性实验，结论已在 DESIGN.md） |
| B13 | 🟡 | sqlite | README 缺「权限与副作用」节 | ✅ 已改：sqlite 补节（权限=读写 `~/.dsh/data/*.db` 无网络；副作用=提示词规则/只读路由/协作观察/停用回收）。peek/terminal/image-reader/ui-restyle 原有节已覆盖，无需改 |
| B14 | 🟡 | 全部 | 无 CHANGELOG、无 tag 纪律 | 🟡 部分完成：5 包 CHANGELOG.md 已补（历史回溯 + 未发布标注）；tag/发布纪律随发布执行 |
| B15 | 🟡 | 全部 | 5 个包都缺 `publishConfig.access: "public"`（规范 §3，官方包先例都有） | ✅ 已改：全部补齐 |

## 整改路线

- **Step 0 — 立契约（已完成）**：契约文档 PLUGIN_SPEC.md + 本清单。
- **Step 1 — 发布闭环**：B3 ✅；B1、B2 ⏸（发布动作用户决定延后，届时按 §8 流程执行）。
- **Step 2 — 元数据统一（已完成）**：B4 / B5 / B8 / B10 / B11 / B15 全部清零。
- **Step 3 — 客户端 Slot 化（已完成）**：B7 ✅ 定性、B9 🟡 重定（peek 0.5.1 去 tab 留浮层 + 点击接管为文档化偏差）；peek（0.5.1）、terminal（0.2.0）官方化；ui-restyle（0.4.0）字体官方化 + 折叠保留为文档化约定偏差（接管路线经调研为高风险，放弃）。
- **Step 4 — 验证闭环（待做）**：B14 剩余（tag/发布纪律，随发布执行）+ 5 包干净 profile 冒烟（复用 `npm run smoke` 与社区 `dsh-plugin-dev check/verify`）。

每步纪律：改代码 + 同一 commit 更新对应文档（契约改 `docs/PLUGIN_SPEC.md`，目录结构改 `README.md` 总览表）；修完 AUDIT 条目勾选并记 commit。

## 完成记录

- B3 / B4 / B5 / B8 / B10 / B11 / B12 / B13 / B15 ✅ 本批整改（非逻辑类，未改任何运行行为；commit 见 git log）。
- B14（CHANGELOG 部分）✅ 本批：5 包 CHANGELOG.md 从 git 历史回溯补齐并加入 files 白名单；tag/发布纪律待发布时执行。
- B7 ✅ 调研定性为官方契约（webServer.register 公开 Service），规范 §6/§7 已写明；B9 🟡 重定（peek 0.5.1：去「预览」tab 与官方一致走浮层，点击接管为文档化偏差）；B6 ✅ peek/terminal 官方化（peek 点击接管除外），ui-restyle（0.4.0）字体官方化 + 折叠为文档化约定偏差。
- B1 / B2 ⏸ 暂缓（发布延后）。
