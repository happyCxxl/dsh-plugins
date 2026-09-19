# dsh-peek

给 DeepSeek Harness 的 Web 界面加一个**内嵌文件预览器**：对话里每轮生成的**产物文件**（HTML / SVG / Markdown / 图片 / PDF / 音视频 / 代码等）会列成可点击 chips，点击后**在同一网页内弹出预览面板**——不用另开浏览器标签、也不用在本地打开文件。

## 安装

```powershell
dsh plugin --profile web add @cxxl/dsh-peek
# 装完重启一次（bundle 层只在启动时读取）
```

本地开发用 tarball 通道（不要 add 本地目录：junction 悬空陷阱，见仓库 dev-notes D15）：

```powershell
cd plugins/dsh-peek
npm pack                                   # 产出 cxxl-dsh-peek-0.4.0.tgz
dsh plugin --profile web add ./cxxl-dsh-peek-0.4.0.tgz
```

## 使用

1. 让 DSH 生成一些文件（`write` / `edit` 产出 HTML、SVG、Markdown、图片等）。
2. 每轮结束后，在对话流底部会出现一行**「预览」chips**（列出本轮成功产出的文件，与官方产物 chips 并存）。
3. 点击某个 chips → 页面内弹出预览面板（官方覆盖层）：标题栏显示文件名与大小，`✕` / 点击遮罩关闭。
4. 「预览」视图 tab（视图切换栏第三个）显示最近一次预览的文件。
5. 官方产物 chips 与行内文件提及的点击行为不变（系统打开文件）——本插件不再拦截任何宿主点击。

## 支持格式

| 格式 | 渲染方式 |
|---|---|
| PNG / JPG / GIF / WebP / BMP / ICO / AVIF | `<img>` |
| SVG | `<img>`（惰性，脚本不执行，安全） |
| HTML | `sandbox` iframe（脚本隔离，不能碰父页面） |
| Markdown | 轻量 Markdown → HTML |
| 代码 / JSON / TXT / CSV / XML / YAML 等 | 等宽 `<pre>` |
| PDF | iframe |
| 音频 / 视频 | `<audio>` / `<video>` |
| 其它二进制 | 大小 + 下载按钮 |

## 架构

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | `node:fs` 读文件；`webServer` 注册 `meta` / `file` 两个同源路由（公开 Service 契约） |
| Client | `lib/client.js` | 全部官方 Slot 席位：`conversation.view` 预览视图 + `shell.overlay` 预览面板 + `conversation.chat.turnTail` 链产物 chips；自注册 `ConversationNodeDefinition`（`dsh-peek-produced`）逐回合推导产物路径 |

Host↔Client 走同源 HTTP（与 `dsh-terminal` / `dsh-sqlite` / `dsh-ui-restyle` 同一套 `webServer` 机制），零运行时依赖。

- `GET /dsh-peek/meta?path=…` → 文件名、大小、MIME、归类（image/svg/html/markdown/code/text/pdf/audio/video/other）。
- `GET /dsh-peek/file?path=…` → 按正确 Content-Type 流式返回文件字节。

产物路径来源：回合内成功的 `write` / `edit` / 变更型 `str_replace_editor` 调用的 `file_path`（与官方 ui-deliverables 同款推导规则）。

## 权限与副作用

- **文件读取**：通过 `node:fs` 读取 DSH 进程可读的任意文件路径（等价于 dsh-terminal 在本地起 shell 的权限面）；路由仅注册在 loopback 同源地址。
- **网络**：仅注册同源路由 `/dsh-peek/meta` 与 `/dsh-peek/file`，不发起任何出站请求。
- 插件停用时自动注销路由与样式、关闭面板。

## 已知限制（v1）

- **HTML 相对资源**：HTML 用沙箱 iframe 内嵌渲染，自包含 HTML（内联 CSS/JS）可完整预览；引用外部相对资源 / 外链脚本的不保证。
- **Markdown 精简版**：支持标题 / 加粗 / 斜体 / 行内码 / 代码块 / 链接 / 图片 / 列表 / 引用 / 分隔线；复杂语法（表格、脚注等）可能不完美，md 里的相对图片路径不解析。
- **单文件上限**：内嵌预览约 512MB，超出提示改用下载。
- **行内代码提及与工具卡片路径**：一律走官方默认行为（系统打开文件）；本插件不拦截任何宿主点击，内嵌预览请用每轮末尾的「预览」chips 或「预览」视图。

## 依赖

零运行时依赖（只用 Node 内置能力 + harness 宿主服务 `webServer`），不 import 任何 harness 包。
