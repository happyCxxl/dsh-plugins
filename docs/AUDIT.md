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
| B6 | 🟠 | peek / terminal / ui-restyle | 客户端绕过 Slot 体系：猜 DOM、全局扫描、直接改 `document.head`（sqlite 面板已走 `slots.register`，此前误列，已更正） | ❌ 未做（逻辑类，Step 3） |
| B7 | 🟠 | peek / terminal / sqlite / ui-restyle | 客户端私有 RPC 自造：`webServer.register` 同源路由 + fetch，非官方契约面 | ❌ 未做（逻辑类，Step 3） |
| B8 | 🟡 | sqlite / image-reader | Host `name` 导出带 scope 全名，官方一律短名 | ✅ 已改：两处改短名（`dsh-sqlite` / `dsh-image-reader`） |
| B9 | 🟡 | dsh-peek | 客户端按中文文案 `'预览'` 匹配 tab 并 `.click()` | ❌ 未做（逻辑类，Step 3） |
| B10 | 🟡 | 全部 | description 语言混用 | ✅ 已改：统一中文 |
| B11 | 🟡 | ui-restyle | 缺 `repository`；误跟踪 `pnpm-lock.yaml`；字体重复 | ✅ 已改：补 repository、移除 pnpm-lock；`design/fonts/` 保留（原型 HTML 自包含引用 `./fonts/`，不属发布物） |
| B12 | 🟡 | dsh-sqlite | `scripts/` 未挂接、无说明 | ✅ 已改：`smoke.mjs` 接线为 `npm run smoke`（有 PASS/FAIL 断言与退出码）；`noise-check.mjs` 删除（一次性实验，结论已在 DESIGN.md） |
| B13 | 🟡 | sqlite | README 缺「权限与副作用」节 | ✅ 已改：sqlite 补节（权限=读写 `~/.dsh/data/*.db` 无网络；副作用=提示词规则/只读路由/协作观察/停用回收）。peek/terminal/image-reader/ui-restyle 原有节已覆盖，无需改 |
| B14 | 🟡 | 全部 | 无 CHANGELOG、无 tag 纪律 | ❌ 未做（随发布节奏一起定，Step 4） |
| B15 | 🟡 | 全部 | 5 个包都缺 `publishConfig.access: "public"`（规范 §3，官方包先例都有） | ✅ 已改：全部补齐 |

## 整改路线

- **Step 0 — 立契约（已完成）**：契约文档 PLUGIN_SPEC.md + 本清单。
- **Step 1 — 发布闭环**：B3 ✅；B1、B2 ⏸（发布动作用户决定延后，届时按 §8 流程执行）。
- **Step 2 — 元数据统一（已完成）**：B4 / B5 / B8 / B10 / B11 / B15 全部清零。
- **Step 3 — 客户端 Slot 化（待做，逻辑类）**：B6 / B7 / B9；按脆度 dsh-peek → ui-restyle → dsh-terminal → dsh-sqlite 评估；B7 需先评估官方 RPC 通道可行性。
- **Step 4 — 验证闭环（待做）**：B14（CHANGELOG/tag 纪律）+ 5 包干净 profile 冒烟（复用 `npm run smoke` 与社区 `dsh-plugin-dev check/verify`）。

每步纪律：改代码 + 同一 commit 更新对应文档（契约改 `docs/PLUGIN_SPEC.md`，目录结构改 `README.md` 总览表）；修完 AUDIT 条目勾选并记 commit。

## 完成记录

- B3 / B4 / B5 / B8 / B10 / B11 / B12 / B13 / B15 ✅ 本批整改（非逻辑类，未改任何运行行为；commit 见 git log）。
- B6 / B7 / B9 / B14 ❌ 待 Step 3 / Step 4。
- B1 / B2 ⏸ 暂缓（发布延后）。
