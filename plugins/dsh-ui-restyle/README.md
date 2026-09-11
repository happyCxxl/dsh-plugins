# dsh-ui-restyle

DSH Web 执行过程优雅化插件：**正文为阅读主线**，正文之间的思考 / 工具调用 / 命令 / 上下文工作行折叠为**单条时序摘要**，并收紧执行区排版。

## 效果

```text
正文 A（永远可见）
▸ ✓ 思考 · read ×2 · edit · glob
正文 B
▸ ⟳ glob（运行中，实时展开）
正文 C
```

- 运行中的工作段实时展开，完成后自动收成摘要；
- 点击摘要行展开 / 收起，手动意图在流式输出中不被重置；
- 摘要只列动作类型，不复制推理全文；展开后原生工作行原样显示，每行自身的开合不受影响。

## 不丢内容的工程保障

- 纯 DOM 视图层：不接管原生 renderer、不修改消息数据、不移动原生节点；
- 折叠使用 `hidden="until-found"`：**Ctrl+F 搜索可定位到被折叠的内容并自动展开**（Chromium 系浏览器）；
- 插件卸载/重载时全部内容自动恢复可见。

## 安装

```powershell
# 从本仓库目录安装（本地目录链接安装，改代码后刷新页面即可迭代）
dsh plugin --profile web add ./plugins/dsh-ui-restyle

# 或发布 npm 后按包名安装（与 @cxxl/dsh-sqlite 同 scope）
# dsh plugin --profile web add @cxxl/dsh-ui-restyle

# 或打包成 tgz 后安装（真实拷贝，不依赖源目录）
# npm pack，然后：
# dsh plugin --profile web add <生成的tgz绝对路径>
```

安装后**重启一次 `dsh web`**（bundle 层只在启动时读取），刷新页面生效。
卸载：`dsh plugin --profile web remove @cxxl/dsh-ui-restyle`，重启后恢复原生界面。

## 与原生「回合过程折叠」的关系（重要）

DSH 自带一套 Turn-process 折叠（设置 → **对话视图**）：

- **紧凑（compact，默认）**：原生把回合内的思考/工具行打上 `data-turn-process-member` 并折叠。这些行**归原生管**，本插件主动让位（跳过），避免双层折叠、也避免互相撤销 `hidden`。
- **常规（normal）**：原生不介入，本插件用自己的摘要风格折叠。

**想看到本插件的摘要风格，请把「对话视图」设为「常规」。** 若保持「紧凑」，你看到的是原生折叠（只显示数量，如「3 次工具调用 · 2 条消息」），本插件不参与。

## 选择器策略（v0.2 起）

**只依赖宿主稳定的 `data-*` 钩子，不再依赖构建哈希类名。**

v0.1 曾硬编码 CSS Module 哈希类名（`.Md3f7G_column` / `.o3BgMG_root` / `.QWLzlG_root` / `.Sxvs8a_body` 等）。这些哈希随前端重新构建而改变——`dsh-web-app` 从 `0.1.1-rc.2` 到 `0.1.2-alpha.5` 就全部失配，插件 `querySelectorAll` 匹配不到任何元素，**静默失效且不报错**。v0.2 起改用稳定钩子：

| 用途 | 稳定选择器 |
|---|---|
| 聊天流节点 | `[data-chat-flow-kind]`（`user` / `assistant-step` / `tool-call` / `command` / `context` / …） |
| 思考行 | `[data-variant="think"]` |
| 工具行 | `[data-tool]` + `[data-state]`（`running` / `ok` / `error` / `stopped`） |
| 上下文行 | `[data-context-source]` |
| 原生折叠成员 | `[data-turn-process-member]`（跳过，归原生管） |

聊天列本身没有稳定类名，因此改为「对所有 `[data-chat-flow-kind]` 元素按父节点分组」反推得到列。

## 作用范围与副作用

- 只作用于聊天列的执行过程展示，不动侧边栏、设置、轨迹视图等其他界面；
- 仅注入一个 `<style>` 标签与摘要行 DOM（随插件卸载回收），不持久化任何数据；
- 兼容浅色/深色主题（颜色全部取自 DSH 主题 token）。

## 已知边界（v0.2）

- 同一个 `assistant-step` 内"思考—正文—思考"不切开：以聊天节点为分组粒度；
- `hidden="until-found"` 的搜索展开特性仅 Chromium 系浏览器支持（其余浏览器退化为普通隐藏，内容不丢失）；
- 摘要行数量过多时截断显示前 6 项（展开后内容完整）；
- 排版收紧只能作用在行容器上：细粒度内层元素没有稳定 `data-*` 钩子，因此收紧程度弱于 v0.1；
- 「对话视图 = 紧凑」时本插件让位于原生折叠，不生效（设计如此，见上文）。

## 开发迭代

```powershell
# 修改 lib/client.js 后刷新浏览器页面即可看到效果（无需重启 dsh web，
# 只要 bundle 组合本身没有变化）。
```

## 许可

MIT
