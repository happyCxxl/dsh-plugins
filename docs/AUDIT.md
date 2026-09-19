# docs/AUDIT.md — 审计结论与整改路线

> 审计日期：2026-09-19。审计基线：harness 官方契约与社区工具链（dsh-plugin-guide），**不是**本仓库自产文档——避免"用自己的文档审计自己代码"的循环论证。
> 本文件是整改工作清单：修完一条就勾选并在"完成记录"写 commit，未修的保持未勾。契约本身见 PLUGIN_SPEC.md，本文件只记录差距。

## 偏差清单

| # | 级别 | 涉及 | 问题 | 官方依据 | 归属步骤 |
|---|---|---|---|---|---|
| B1 | 🔴 | dsh-terminal | 仓库版本 0.1.7，npm 最新仍是 0.1.6——发布没闭环 | 发布纪律（PLUGIN_SPEC §8.1） | Step 1 |
| B2 | 🔴 | dsh-image-reader | npm 上查不到该包（疑似从未发布），README 却教 `add @cxxl/dsh-image-reader`——按文档装不上 | §8.1 | Step 1 |
| B3 | 🔴 | peek / terminal / ui-restyle | patch 注释与 README 示例还在教 `add ./plugins/<目录>`——目录 spec 走 pnpm link（Windows 即 junction），源目录改名/移动 → 悬空链接 → boot 报 `cannot resolve profile bundle` | `harness\apps\cli\src\plugin.ts#L49-50、#L104-112`（pnpm link/file 语义）；`harness\packages\boot\app-boot\src\profile.ts#L228-267`（boot 期 junction 回退，同类陷阱）；editing skill 只认 npm/git/tarball | Step 1 |
| B4 | 🟠 | 全部 | engines 口径不一：4 个 `>=22.5`、1 个 `>=22.19`；官方口径 `^22.19.0 \|\| >=24.0.0`。sqlite 因 node:sqlite 需 ≥22.5 可保留（README 已说明），其余 3 个无依据 | harness 根 package.json#L8-10；PLUGIN_SPEC §3 | Step 2 |
| B5 | 🟠 | 全部 | 三种依赖策略并存且无文档。规范已定标准（PLUGIN_SPEC §3.1），各插件需按形态补齐 DESIGN.md/README 说明 | §3.1 | Step 2 |
| B6 | 🟠 | 全部 client | 客户端全部绕过 Slot 体系：`querySelectorAll` 猜 DOM、全局扫描、直接改 `document.head`。官方唯一 UI 通道是 `ctx.slots.register`，明令禁止 DOM 猜测 | `harness\packages\client\AGENTS.md#L7-17`、#L107 | Step 3 |
| B7 | 🟠 | 全部 client+host | 客户端私有 RPC 自造：`webServer.register` 开同源路由 + fetch，非官方契约面（动态插件官方通道是 harness.handle/host.call；npm 插件无文档化替代）。能用但上游动 webserver 就可能碎 | `harness\packages\client\AGENTS.md`；cordis skill#L321-348 | Step 3 |
| B8 | 🟡 | image-reader | Host `name` 导出带 scope 全名（`@cxxl/dsh-image-reader`），官方一律短名 | inventory src/index.ts#L26 | Step 2 |
| B9 | 🟡 | dsh-peek | 客户端按中文文案 `'预览'` 匹配 tab 并 `.click()`——硬编码文案 + DOM 猜测双重违规 | client/AGENTS.md#L113 | Step 3 |
| B10 | 🟡 | 全部 | description 语言混用（英文 / 中文 / 混合），统一为一种 | §3 | Step 2 |
| B11 | 🟡 | ui-restyle | 缺 `repository` 字段；误跟踪 `pnpm-lock.yaml`；`design/fonts/` 与 `fonts/` 字体重复 | §3；git ls-files | Step 2 |
| B12 | 🟡 | dsh-sqlite | `scripts/`（smoke.mjs / noise-check.mjs）未挂到 package.json scripts、无说明，疑似死代码——处置或接线 | §8 | Step 4 |
| B13 | 🟡 | sqlite / peek / image-reader | README 权限清单不齐（缺"权限与副作用"节或未写明网络出站端点） | §7；社区 `permissions:` 范式 | Step 4 |
| B14 | 🟡 | 全部 | 无 CHANGELOG、无 tag 纪律；terminal 0.1.0→0.1.7 每次小修都发版 | §8.1 | Step 4 |

## 整改路线（用户已确认：先立契约，代码后动）

- **Step 0 — 立契约（本步，已完成）**：按官方契约重建 PLUGIN_SPEC.md，每条带 file:line 出处；新建本文件。
- **Step 1 — 发布闭环（B1/B2/B3）**：核对 5 包 npm 状态；terminal 发 0.1.7；image-reader 定"发布或改文档"；统一 patch 注释与 README 安装示例（npm / tarball / git#sha 三通道，删目录 add）。
- **Step 2 — 元数据统一（B4/B5/B8/B10/B11）**：engines、依赖策略说明、name 短名、description 语言、ui-restyle 仓库卫生。
- **Step 3 — 客户端 Slot 化（B6/B7/B9，最大工程）**：按脆度逐个重写交互入口：dsh-peek → ui-restyle → sqlite 面板 → terminal；重评估 B7 的 RPC 通道。
- **Step 4 — 验证闭环（B12/B13/B14）**：权限清单补齐、死代码处置、CHANGELOG/tag 纪律；引入 `dsh-plugin-dev check` 或自建等价校验，5 包干净 profile 冒烟。

每步纪律：改代码 + 同一 commit 更新对应文档（契约改 `docs/PLUGIN_SPEC.md`，目录结构改 `README.md` 总览表）；修完 AUDIT 条目勾选并记 commit。

## 完成记录

（尚无。修完一条在这里写：`Bx ✅ <commit hash> <一句话>`）
