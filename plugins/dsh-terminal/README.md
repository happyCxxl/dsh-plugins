# dsh-terminal

给 DeepSeek Harness 的 Web 界面加一个**内置交互式终端**：在会话视图切换栏新增一个「Terminal」tab（位于「轨迹」tab 右边），运行真实的 PowerShell（PTY），在浏览器里敲命令。

## 安装

```powershell
dsh plugin --profile web add @cxxl/dsh-terminal
# 装完重启一次（bundle 层只在启动时读取）
```

本地开发可用目录或 tarball 安装（见仓库 dev-notes D15，推荐 tarball 通道避免 junction 悬空）：

```powershell
dsh plugin --profile web add ./plugins/dsh-terminal
```

## 使用

1. 在**视图切换栏**点 **`Terminal`** tab（位于「轨迹」右边），或在**输入框工具行**（模型选择器旁）点终端图标按钮跳转过去。
2. 终端作为会话视图占据主体区域（隐藏会话输入框），自动在**当前会话所在工作目录**（workspace 根）启动一个交互式 PowerShell。
3. 终端里可以：敲命令回车、`Ctrl+C` 中断、方向键 / 退格 / `Tab`、粘贴、看彩色输出。标题栏显示 shell 与工作目录；切走该 tab 会自动杀掉对应 PTY 进程。

## 架构

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | `subprocess.spawnTerminal`（node-pty）起 shell；`webServer` 注册 4 个同源 API 路由 `spawn/write/read/close` |
| Client | `lib/client.js` | `__ModuleLoader__` 载入，自写 ANSI 终端仿真器渲染，`fetch` 轮询 `read` 拉输出 |

Host↔Client 走同源 HTTP（与 `dsh-sqlite` 面板同一套 `webServer` 机制），无需 WebSocket，无需额外依赖。

## 权限与副作用

- **进程**：在**当前会话所在工作目录**起交互式 PowerShell（真 PTY；无 workspace 时回退 DSH 进程工作目录），拥有当前用户的全部权限（等价于本机开一个终端窗口）。
- **网络**：仅注册同源路由 `/dsh-terminal-api/*`，不发起任何出站请求。
- 插件停用时自动终止所有未关闭的 PTY 会话并回收进程树。

## 已知限制（v1）

- 面板**固定尺寸**、暂不能拖拽 / 缩放（PTY 列/行在启动时按容器测一次后固定）。
- 全屏 TUI 程序（`vim` / `less` / `htop` 等用备用屏幕缓冲区的）暂不支持；普通命令、彩色 `git` / `ls` 输出没问题。
- 中文输入法（IME）组合输入可能不完美。
- 未装 PowerShell 7 时自动回退 Windows PowerShell 5.1（`powershell.exe`）。

## 依赖

零运行时依赖（只用 Node 内置能力 + harness 宿主服务 `subprocess` / `webServer`），不 import 任何 harness 包。
