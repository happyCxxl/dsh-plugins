# dsh-ui-restyle

DSH Web 精致化插件。三件事，一套语言：

1. **字体** —— 自带 Inter Variable + JetBrains Mono，覆盖宿主字体变量，**全站排版一次性统一**；
2. **聊天列** —— 按「步骤模型 A」把工作行收成**一行组头**，点开才看**逐步状态列表**；
3. **交互面板** —— 审批提示与提问卡片按同一套半径 / 边框 / 字重纪律重排。

## 一、为什么自带字体（这是「好不好看」的关键）

DSH 的字体栈在 Windows 上落到 **Segoe UI + Consolas**：

```
--dsw-font-family:      -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', …
--ds-font-family-code:  'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, …
```

而成熟产品设计系统的质感恰恰建立在**可变字体**上：

- **Linear** 全站使用 Inter Variable 的 **字重 510**（介于 400 与 500 之间的中间档，"比粗体更响亮的排版低语"），并全局开启 `cv01` / `ss03` OpenType 特性；
- **Raycast** 用 Inter + **正字距**（+0.2px，深色底上"透气"）与 **500 字重基线**。

Segoe UI 是静态字体——**根本没有 510 这一档**，也不支持 `cv01/ss03`。所以不换字体，排版上限就被锁死了。

本插件把两款字体打进包里（**合计 88KB**，均为 OFL 许可可自由分发），由宿主注册 HTTP 路由喂给页面，并覆盖上述两个 CSS 变量。中文仍回落系统 Microsoft YaHei（打包 CJK 字体需数 MB，业界通行做法是不打包）。

```
GET /dsh-ui-restyle/fonts/inter-var-latin.woff2
GET /dsh-ui-restyle/fonts/jetbrains-mono-var-latin.woff2
```

## 二、步骤模型 A（聊天列）

### 默认只有一行组头

```
正文 A（永远可见）
▸ ✓  4 步  think · read×2 · edit                      1.4s
正文 B
```

组头自身承载全部状态信号（**不破格、不自动展开**）：

| 状态 | 组头表现 |
|---|---|
| 成功 | 细勾 · 三级文字色（刻意安静） |
| **运行中** | 呼吸**盲文转轮** + 计数/耗时转强调色 + **当前步骤在组成串里点亮** + 计时每秒跳 |
| **有失败** | **红叉** + `N 失败` 红字 + 整行从三级提亮到二级 |
| 已中止 | 琥珀短横 + 「已中止」 |

### 点开才是步骤列表

```
▾ ✕  4 步 · 1 失败  think · read×2 · edit · glob       3.2s
   ✓  think   分析报错来源                          1.2s
   ✓  read    lib/index.js                          12ms
   ✕  edit    lib/index.js                          34ms
      EPERM: operation not permitted — 被另一个进程占用
   –  pwsh    npm publish                          已中止
   ⟳  pwsh    pnpm dsh web                          0.4s
      └ ⟳ subcall  tsc --noEmit                     0.2s
   ○  glob    **/*.ts                                 —
```

六种状态各有独立语言：`○` 排队 / `⟳` 运行中 / `✓` 成功（**故意用三级色，不抢眼**）/ `✕` 失败（**错误摘要写在行内第二行**）/ `–` 中止 / `└` 嵌套（缩进 + 发丝折线归位父步骤）。点某一步会露出该步的**原生行**看完整详情。

三条原则：**成功故意变暗**、**列对齐**（工具/目标/耗时等宽 `tabular-nums`）、**信息就地**。

## 三、交互面板

以稳定钩子为锚给兄弟/父节点打标记，再用 CSS 精确命中，**不改结构**：

- **审批**：语义只用**一处**表达——左侧 **2px 琥珀杠**（而不是旧实现的「琥珀描边 + 整条色带 + 圆点」三重强调）；半径从 `20px` 收到 `8px`；命令进 mono 代码面；**幽灵「拒绝」+ 实心「允许一次」**（危险的默认不该醒目）。
- **提问**：序号用 mono（与步骤行同族）；**方形复选框**表示多选（用形状而非颜色区分单选/多选）；推荐项只给低调的边框小字；分隔线用发丝边。

## 安装

```powershell
dsh plugin --profile web add @cxxl/dsh-ui-restyle
# 装完重启一次 dsh web（bundle 层只在启动时读取）
```

卸载：`dsh plugin --profile web add` 换成 `remove`，重启后恢复原生界面。

> **改宿主侧代码（`lib/index.js`）必须重启**；只改 `lib/client.js` 时浏览器端 HMR 会热重载，刷新即可。

## 与原生「回合过程折叠」的关系（重要）

DSH 自带 Turn-process 折叠（设置 → **对话视图**）：

- **紧凑（compact，默认）**：原生把回合内的思考/工具行打上 `data-turn-process-member` 并折叠，这些行**归原生管**，本插件主动让位；
- **常规（normal）**：原生不介入，本插件接管折叠。

**想看到本插件的步骤模型，请把「对话视图」设为「常规」。**

## 选择器策略：只依赖稳定 `data-*` 钩子

v0.1 曾硬编码 CSS Module 构建哈希类名（`.Md3f7G_column` / `.o3BgMG_root` / `.QWLzlG_root` 等）。这些哈希随前端重建而变（`dsh-web-app` 从 `0.1.1-rc.2` 到 `0.1.2-alpha.5` 就全部失配），插件 `querySelectorAll` 匹配不到任何元素，**静默失效且不报错**。v0.2 起改用稳定钩子：

| 用途 | 稳定选择器 |
|---|---|
| 聊天流节点 | `[data-chat-flow-kind]` / `[data-chat-flow-key]` |
| 思考行 | `[data-variant="think"]` |
| 工具行 | `[data-tool]` + `[data-state]`（`running` / `ok` / `error` / `stopped`） |
| 上下文行 | `[data-context-source]` |
| 流式标记 | `[data-streaming]`（**正在流式输出的步骤永远算正文，绝不收起**） |
| 原生折叠成员 | `[data-turn-process-member]`（跳过，归原生管） |
| 审批 / 提问 | `[data-approval-key]` `[data-approval-scroll]` / `[data-question-key]` `[data-question-scroll]` |

聊天列本身没有稳定类名，改为「对所有 `[data-chat-flow-kind]` 元素按父节点分组」反推。

## 不丢内容的工程保障

- **纯视图层**：不接管原生 renderer、不修改消息数据、不移动原生节点；
- 被收起的内容**仍在 DOM 里**（`display:none`），点步骤可见、插件卸载即全部恢复；
- **兜底自愈**：每 1.5s 检查一次"被收起但已不该收起"的行并立刻放出——从机制上消灭「必须手动刷新才显示」这类监听漏报问题（v0.3.0 修过一个：流式增量走 `characterData`，漏监听会让最终输出一直不可见）。

## 作用的边界与副作用

- 字体变量是**全站级**覆盖（这是"统一风格"的前提）；步骤模型只作用于聊天列，其余界面只受字体与交互面板样式影响；
- 注入一个 `<style>` 标签、若干步骤行 DOM 与若干 `data-dur-*` 标注（全部随插件卸载回收）；
- 不持久化任何数据；不发起除自身字体以外的任何网络请求；
- 颜色全部取自 DSH 主题 token，兼容浅色/深色主题。

## 已知边界

- 分组粒度是**聊天节点**（同一个 `assistant-step` 内"思考—正文—思考"不切开）；
- **步骤的"目标"列是启发式提取**：宿主没有独立的 target 钩子，实现方式是把该行文本去掉工具名后的剩余部分，个别工具可能显示不够干净；
- **历史消息的耗时留空**（不编造，只测本次会话内实测到的耗时）；
- 依赖 `display:none` 收起，因此被收起内容**不参与浏览器 Ctrl+F**（点开步骤或用轨迹视图查看）；
- 「对话视图 = 紧凑」时本插件让位于原生折叠，不生效（设计如此）。

## 字体许可

| 字体 | 许可 | 归属 |
|---|---|---|
| Inter Variable（latin 子集） | SIL Open Font License 1.1 | © Rasmus Andersson |
| JetBrains Mono Variable（latin 子集） | SIL Open Font License 1.1 | © JetBrains s.r.o. |

两file 均为上游官方发行的 latin 子集，未做字形修改，随包分发符合 OFL 要求。

## 开发迭代

```powershell
# 只改 lib/client.js：刷新浏览器即可（HMR 热重载），无需重启
# 改 lib/index.js 或 package.json：需要重启 dsh web
```

设计过程与四个方向样张留档在 [`design/`](design/)：

- `font-proof.html` —— 字体对照（Segoe UI vs Inter，同一设计只换字体）
- `step-model.html` / `step-model-c.html` —— 步骤模型 A（点开才看）/ C（破界露出）
- `interaction.html` —— 审批与提问的现状 vs 重做
- `research/` —— Linear 与 Raycast 的设计系统规格（抓取的原始资料）

## 许可

MIT（插件代码）。内置字体见上文「字体许可」。
