# Codex 功能调研报告

> 目的：为「DSH 桌面端插件」提供产品与架构参照。回答两个问题：**Codex 有哪些功能**、**它的产品力来自哪里**。
>
> 调研时间：2026-09-11。调研对象：开源仓库 `openai/codex`（`codex-rs/`、`sdk/`、`docs/`）+ 本机安装的 `@openai/codex@0.149.1-win32-x64` 二进制 + 公开报道（桌面端闭源）。

## 证据等级约定

全文每条结论标注来源等级，请勿混用：

| 标记 | 含义 |
|---|---|
| 【源码】 | 直接读 `codex-rs/` 的源码/manifest 得到，附文件路径 |
| 【二进制】 | 从 `@openai/codex@0.149.1` 可执行文件中提取的字符串得到（真实但可能不完整、丢失顺序） |
| 【文档】 | 来自公开网页报道（闭源部分，第三方信息） |
| 【推断】 | 由以上材料推理，未直接验证 |

**重要前提**：Codex 的 `docs/` 目录基本都是**指向 `developers.openai.com` 的空壳**（`docs/sandbox.md`、`docs/slash_commands.md` 都只有 3 行）。真正的资料在源码里。桌面应用本身**闭源**，本报告不替它编造未验证的行为。

---

## 一、结论速览

1. **Codex 的产品力不在 UI，在「引擎 / 协议 / 前端」三层彻底解耦。** 一个 Rust 引擎，一个版本化 JSON-RPC 协议，多个平级前端（TUI、exec、CLI、桌面 App、IDE 扩展、mobile、Python SDK）。
2. **桌面端是那个协议的私有消费者**，仓库里留下了它的完整集成痕迹（配置命名空间、worktree 契约、特性门、客户端身份、doctor 日志解析）。
3. **桌面端真正独有的能力只有 9 个特性门 + worktree 管理 + 会话交接**，其余全部由服务端提供。
4. 对 DSH 的含义：**DSH 的引擎层和协议层已经现成**（`typert` + `api-remotes` 之于 Codex 的 `app-server-protocol`，`__DSH_TRANSPORT__` 之于它的传输台阶）。缺的是**客户端**。

---

## 二、产品形态

Codex 同时以这些形态存在（【源码】`codex-rs/cli/src/main.rs`）：

| 形态 | 入口 | 说明 |
|---|---|---|
| TUI | `codex` | 终端交互式，`tui/src` 有 **1680 个文件**，是最大的客户端 |
| 非交互 | `codex exec` | `--json` 输出 JSONL 事件流；默认只把最终消息写 stdout |
| CLI 多工具 | 各子命令 | `codex` 本身是个多路子命令分发器 |
| **桌面 App** | `codex app` | **闭源**，仅 macOS / Windows |
| IDE 扩展 | VS Code / Cursor | 名 `codex_vscode`，**闭源** |
| mobile | — | 仓库明确点名"需要单独 rollout"（【源码】`app-server/README.md:49-58`） |
| Python SDK | `pip install openai-codex` | 驱动 `codex app-server` |
| TypeScript SDK | `@openai/codex-sdk` | 驱动 `codex exec --json` |

> 【文档】公开报道标题即概括了它的演化方向：「Codex 桌面重大更新：可操控电脑并内置浏览器」「几乎样样都做得到的 Codex」。

---

## 三、产品架构：三层解耦

```
   TUI (1680 文件) ─┐
   codex exec ──────┤
   Python SDK ──────┼──▶ app-server ──▶ codex-core（引擎）
   桌面 App ────────┤    MessageProcessor      │
   IDE 扩展 ────────┤                         └─▶ sandboxing / network-proxy
   mobile ──────────┘                             execpolicy / rollout / state
                                                  models-manager / mcp runtime
```

设计意图被明确写在源码里（【源码】`codex-rs/docs/protocol_v1.md:43`）：

> *"The term 'UI' is used to refer to the application driving `Codex`… The UI is external to `Codex`, as `Codex` is intended to be operated by **arbitrary UI implementations**."*

### 3.1 仓库规模

- `codex-rs/Cargo.toml` 的 workspace members 约 148 项；`**/Cargo.toml` 实测 **153 个**
- 协议生成产物：【源码】实测 `app-server-protocol/schema/typescript/**` = **721 个文件**，`schema/json/**` = **312 个文件**
- 这是「协议优先」的实证：**类型是先定协议再生成的**，不是手写的

### 3.2 crate 地图（按职责分组）

**核心引擎（引擎层）**

| crate | 职责 |
|---|---|
| `core` | 业务逻辑主体。README 自述 *"implements the business logic for Codex. It is designed to be used by the various Codex UIs written in Rust."* 持有 `Op`/`EventMsg` 提交/事件队列 |
| `core-api` | 基于 `core` 的线程管理对外门面 |
| `protocol` | 类型定义，**同时**承载内部（core↔TUI）与外部（app-server）两套契约 |
| `tools` | 可脱离 `core` 存在的工具定义与 Responses API 原语 |
| `apply-patch` | 补丁应用引擎，通过 arg0 暴露成虚拟 CLI |
| `arg0` | 一个二进制多种人格（`argv[0]` 分发，如 `codex-linux-sandbox`） |
| `config` / `config-schema` | 配置加载、分层、schema 生成 |
| `features` | 「集中式特性开关与元数据」注册表 —— **桌面端特性门就在这里** |
| `prompts` / `shell-command` / `utils/*` | 提示词资产、命令解析与安全、约 30 个小型工具 crate（`output-truncation`、`pty`、`sleep-inhibitor`、`approval-presets`、`sandbox-summary`…） |

**协议与传输（客户端接缝）**

| crate | 职责 |
|---|---|
| `app-server-protocol` | **线上契约**。用 4 组宏从 `ClientRequest`/`ServerRequest`/`ServerNotification`/`ClientNotification` 生成枚举；内置 JSON Schema + TypeScript 导出 |
| `app-server-protocol-noop-macros` | 生产构建用的 no-op schema derive（避免生成不可达 impl） |
| `app-server-transport` | 传输 + 连接认证 + 出站路由。导出 `AppServerTransport`、`start_stdio_connection`、`start_websocket_acceptor`、`start_control_socket_acceptor`、`start_remote_control`、`ConnectionAuth` |
| `app-server` | 服务端本体，`MessageProcessor` + `request_processors/`（约 60 个处理器），二进制名 `codex-app-server` |
| `app-server-daemon` | 「跨 CLI 调用与更新器序列化的受管 app-server 生命周期」 |
| `app-server-client` | 进程内客户端门面，供 TUI / exec 复用引导逻辑 |
| `app-server-test-client` | 驱动真实 app-server 的测试 CLI |
| `stdio-to-uds` / `uds` | MCP 用的 stdio↔UDS 适配；跨平台异步 UDS 助手（含 Windows peer 安全检查） |

**沙箱与安全**

| crate | 职责 |
|---|---|
| `sandboxing` | 调度器。`SandboxManager`、`SandboxType`、`SandboxCommand`、`spawn_process`、违规记录、按平台解析策略。模块：`bwrap`、`landlock`、`seatbelt`、`windows`、`windows_mxc`、`denial`、`policy_transforms` |
| `linux-sandbox` | Linux 助手入口：进程内限制（`no_new_privs` + seccomp）+ bubblewrap 文件系统隔离 |
| `bwrap` | bubblewrap 发现与 mount 参数构造 |
| `windows-sandbox-rs` | **Windows 沙箱**（详见 §4.2）；产出 `codex-windows-sandbox-setup`、`codex-command-runner`、`codex-windows-managed-deny-probe` |
| `windows-sandbox-service` | Windows 服务包装器，用于托管沙箱安装 |
| `mxc-sandbox` | 「原生 Windows 进程安全环境可用性与启动」 |
| `network-proxy` | MITM HTTP CONNECT 代理 + SOCKS5 + 凭据代理 + 域白名单 |
| `execpolicy` | **基于前缀的 Starlark 规则**，决定命令可否放行 |
| `shell-escalation` | 提权协议：`EscalateServer`/`EscalationPolicy`/`EscalationDecision` + `codex-execve-wrapper` |
| `process-hardening` | `pre_main_hardening()`：禁 core dump、拒 `ptrace`、剥 `LD_PRELOAD`/`DYLD_*` |

**存储与持久化**

`rollout`（JSONL 会话文件）、`rollout-trace`、`state`（SQLite 镜像 rollout 元数据）、`thread-store`（存储中立的线程持久化接口，`ThreadId` 是唯一持久句柄）、`history` / `message-history`（全局追加式 `~/.codex/history.jsonl`，`O_APPEND` 单次写保证并发安全）、`attachment-store`、`agent-graph-store`（父子拓扑）、`secrets` / `keyring-store`（OS 钥匙串）、`codex-home`、`file-watcher` / `file-search`（`nucleo` 模糊查找）、`thread-manager-sample`（`thread-store` 的参考实现）

**集成与产品面**

`codex-mcp` / `rmcp-client` / `ext/mcp`（作为 MCP **客户端**）、`connectors`（托管连接器 + 品牌/策略/快照）、`plugin` / `core-plugins` / `utils/plugins`（市场、加载器、manifest、npm 源、bundle 归档、远程）、`skills`、`hooks`、`memories/read` + `memories/write`（**刻意拆分**）、`models-manager`、`model-provider` / `model-provider-info`、`lmstudio` / `ollama`（本地模型）、`chatgpt` / `backend-client` / `cloud-config` / `cloud-tasks*`、`login` / `aws-auth` / `workload-identity` / `agent-identity`（Ed25519 签名、JWT/JWK）/ `user-verification`（设备凭据 + P-256 ECDSA，独立于 RPC/UI）、`otel` / `otel-trace-websocket` / `analytics` / `feedback` / `diagnostics`、`voice-host` / `realtime-webrtc` / `utils/audio`、`code-mode` / `code-mode-host` / `code-mode-protocol` / `code-mode-runtime` / `v8-poc`、`agent-roles` / `guardian-context` / `ext/guardian-reviewer` / `ext/guardian-v2` / `collaboration-mode-templates` / `external-agent-migration`（导入 Claude Code 配置，`/import` 斜杠命令）、`worktree`

**平台基础设施**

`terminal-detection`（终端名用于 OTel UA 与 TUI 配置；明确要求"不得执行由不可信 PATH 选出的助手"）、`git-utils` / `utils/git-discovery`（有界、可取消、非阻塞池的 git 根探测）、`utils/pty`、`utils/sleep-inhibitor`（macOS IOKit / Linux `systemd-inhibit` / Windows `PowerCreateRequest`）、`build-info`、`install-context`、`test-binary-support`

### 3.3 app-server 协议

**它不是真正的 JSON-RPC 2.0**（【源码】`app-server-protocol/src/rpc.rs:1-2`）：

```rust
//! We do not do true JSON-RPC 2.0, as we neither send nor expect the
//! "jsonrpc": "2.0" field.
```

信封（【源码】`rpc.rs:35-88`）：

```rust
pub enum JSONRPCMessage { Request(JSONRPCRequest), Notification(JSONRPCNotification),
                          Response(JSONRPCResponse), Error(JSONRPCError) }
pub struct JSONRPCRequest { pub id: RequestId, pub method: String,
    pub params: Option<serde_json::Value>, pub trace: Option<W3cTraceContext> }
```

注意 `trace: Option<W3cTraceContext>` —— **W3C 追踪上下文直接搭在 RPC 信封里**。

**规模**（【源码】从宏调用统计，grep 截断于 250/259 行，故为 ±数个）：
**约 167 个客户端→服务端请求、9 个服务端→客户端请求、约 84 个服务端→客户端通知、1 个客户端通知。**

**传输**（【源码】`app-server/src/main.rs:39-46`）：

```
--listen <URL>   支持：stdio://（默认）、unix://、unix://PATH、ws://IP:PORT、off
```

- **stdio**：换行分隔 JSON（JSONL），**不是 Content-Length 框架**
- **UDS**：控制 socket 路径由 `$CODEX_HOME` 推导；Windows 走 `uds_windows`，**受 108 字节 AF_UNIX 地址上限约束**；`ensure_non_elevated_peer()` 要求对端属于当前用户且双方都未提权，**必须在发送任何应用数据之前调用**
- **WebSocket**：`axum` + `tokio-tungstenite`，含 `authorize_upgrade`、`WebsocketAuthPolicy`、`ORIGIN` 校验、`is_unauthenticated_non_loopback_listener`
- **进程内**：用有界内存通道替换 socket，但**复用同一套 JSON-RPC 结果信封**，注释写明"避免产生第二套执行契约"

**认证**：每条连接绑定到建立它的认证主体；**主体版本变更会使已排队工作失效**（【源码】`connection_auth.rs:1-2`）。

**服务端→客户端请求（9 个）—— 这是审批交互的全部管道**：

```
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/tool/requestUserInput
item/permissions/requestApproval
item/tool/call                       （动态工具调用）
mcpServer/elicitation/request
account/chatgptAuthTokens/refresh
attestation/generate
currentTime/read
```

**关键设计含义**：**审批不是客户端主动轮询，而是服务端反向调用客户端。** 客户端只需渲染一个提示并把 `ReviewDecision` 回传。

**客户端方法表（按资源分组，线上方法名照抄）**——节选：

```
initialize                              server/diagnostics
userVerification/{status,enroll,delete,verify,cancel}
thread/{start,resume,fork,archive,delete,unarchive,rollback,revert,list,loaded/list,
        read,turns/list,items/list,inject_items,search,searchOccurrences,timeline/list,
        compact/start,shellCommand,approveGuardianDeniedAction,memoryMode/set}
thread/name/set   thread/goal/{set,get,clear}   thread/metadata/update
thread/queue/{add,list,update,delete,reorder,start}
thread/attachment/{add,list,remove}   thread/section/move   thread/settings/update
thread/backgroundTerminals/{clean,list,terminate}
thread/realtime/{start,stop,appendAudio,appendText,appendSpeech,listVoices}
threadSection/{list,create,update,delete}
project/{list,read,create,import,update,move,delete}
turn/{start,steer,interrupt}   turn/settings/update   review/start
memory/{status,reset}
skills/list  skills/extraRoots/set  skills/config/write  hooks/list
marketplace/{add,remove,upgrade}
plugin/{list,search,installed,reconcile,read,install,uninstall,skill/read}
plugin/share/{save,updateTargets,list,checkout,delete}
app/{list,installed,read}
fs/{readFile,writeFile,createDirectory,getMetadata,readDirectory,remove,copy,watch,unwatch}
model/list   modelProvider/capabilities/read   permissionProfile/list
experimentalFeature/{list,enablement/set}   collaborationMode/list
remoteControl/{enable,disable,status/read,pairing/start,pairing/status,client/list,client/revoke}
environment/{add,info,status}
config/mcpServer/reload   mcpServerStatus/list   mcpServer/oauth/login
mcpServer/resource/read   mcpServer/tool/call   mcpServer/event/stream/{start,stop}
windowsSandbox/{setupStart,readiness}
account/{login/start,login/cancel,logout,read,bedrock/discover,bedrock/setup}
account/{rateLimits/read,rateLimitResetCredit/consume,usage/read,workspaceMessages/read,…}
feedback/upload
command/exec   command/exec/{write,terminate,resize}   process/{spawn,writeStdin,kill,resizePty}
config/read   config/value/write   config/batchWrite   configRequirements/read
externalAgentConfig/{detect,import}   externalAgentConfig/import/{recordHistory,readHistories}
fuzzyFileSearch   fuzzyFileSearch/{sessionStart,sessionUpdate,sessionStop}
getConversationSummary   gitDiffToRemote   getAuthStatus        （v1 时代遗留，仍存在）
```

**通知（约 84 个）**——流式核心：

```
item/started  item/completed  item/agentMessage/delta  item/plan/delta
item/commandExecution/{outputDelta,terminalInteraction}
item/fileChange/{outputDelta,patchUpdated}
item/reasoning/{textDelta,summaryTextDelta,summaryPartAdded}
item/mcpToolCall/progress   item/autoApprovalReview/{started,completed}
turn/{started,completed,diff/updated,plan/updated,moderationMetadata}
thread/{started,closed,archived,deleted,unarchived,reverted,compacted,tokenUsage/updated,
        settings/updated,name/updated,queue/changed,attachment/updated,environment/{connected,disconnected}}
thread/status/changed   thread/goal/{updated,cleared}
hook/{started,completed}
command/exec/outputDelta   process/{outputDelta,exited}   fs/changed
account/{updated,rateLimits/updated,login/completed}
mcpServer/startupStatus/updated  mcpServer/oauthLogin/completed  mcpServer/event/stream/notification
app/list/updated   project/changed   skills/changed   remoteControl/status/changed
model/rerouted  model/verification  model/safetyBuffering/updated
modelProvider/authRecovery{Started,Completed}
error  warning  guardianWarning  deprecationNotice  configWarning
autoApprovalReview/strictReviewRequired   serverRequest/resolved
windows/worldWritableWarning   windowsSandbox/setupCompleted
thread/realtime/{started,closed,error,sdp,itemAdded,item/started,item/completed,
                 item/transcript/delta,transcript/delta,transcript/done,outputAudio/delta}
```

### 3.4 客户端如何共享代码

**是的：一个引擎，多个前端，只有两个分叉点。**

- **接缝 A**：`codex-core` 的 `Op`/`EventMsg` 队列对。**内部**接缝，进程内 Rust 类型，`non_exhaustive`，**不承诺稳定线上契约**
- **接缝 B**：`app-server-protocol`。**外部**接缝，进程内与跨进程走同一套语义

| 前端 | 分叉点 |
|---|---|
| `tui` | 进程内 app-server 客户端，**或** `--remote ws://…\|unix://…` + `--remote-auth-token-env`；额外只有表现层模块（`keymap.rs`、`theme_picker.rs`、`diff_render.rs`、`chatwidget/`） |
| `exec` | 同一进程内客户端，输出契约不同：`--json` 出 JSONL；默认只把最终消息写 stdout、其余进 stderr；`--output-last-message FILE`、`--output-schema FILE` |
| Python SDK | 拉起 `codex app-server --listen stdio://` 说 JSON-RPC |
| TypeScript SDK | 拉起 `codex exec --experimental-json` 解析 JSONL —— **是另一条接缝** |
| 桌面 App | 本地 stdio app-server 会话，自报身份 `"Codex Desktop"` |
| IDE 扩展 | `SessionSource::VSCode`，originator `codex_vscode`；**IDE 上下文走另一条私有 IPC** |

**IDE 上下文的私有 IPC（第三个接缝）**（【源码】`tui/src/ide_context/ipc.rs`）：

- socket 发现：`$CODEX_HOME/ipc/ipc.sock`，回退 `ipc.sock` → `ipc-<uid>.sock`；**Windows 用 `\\.\pipe\codex-ipc`**
- 走**未注册的方法路由**，带 `sourceClientId`/`handledByClientId`
- **5 秒预算**，注释写明「与桌面 IPC 客户端自身的超时对齐」
- 帧上限 256 MiB；错误分型 `Connect/Send/Read/InvalidResponse/ResponseTooLarge/RequestFailed`
- 提示语：「在 VS Code 或 Cursor 中打开此项目并启用 Codex 扩展」「IDE 扩展未提供上下文」「已连接的 IDE 扩展与本次 IDE 上下文请求不兼容」
- 序列化格式**与桌面端/IDE 逐字符锁定**：「Match the desktop app and IDE extension delimiter exactly.」

---

## 四、桌面端独有的能力

### 4.1 九个特性门（**已逐行核实**）

【源码】`codex-rs/features/src/lib.rs:244-277`，全部标注 *"Requirements-only gate: this should be set from requirements, not user config."*：

| 特性门 | 含义 |
|---|---|
| `InAppBrowser` | 内置浏览器 |
| `InAppChat` | 内置对话 |
| `InAppDictation` | 听写（语音输入） |
| `InAppLocalAutomation` | 本地自动化 |
| `InAppUpdates` | 应用内更新 |
| `BrowserUse` | 浏览器操作 |
| `BrowserUseFullCdpAccess` | CDP 全权控制 |
| `BrowserUseExternal` | 外部浏览器 |
| `ComputerUse` | **操控电脑** |

**这九个就是「桌面 App 比 CLI/Web 多了什么」的完整答案。** 它们是特性门而非实现——闭源部分不在仓库里。

> 术语含义为【推断】，依据是门名语义 + 【文档】公开报道「可操控电脑并内置浏览器」。

### 4.2 桌面端留下的其他集成痕迹

| 证据 | 位置 | 含义 |
|---|---|---|
| `cli/src/desktop_app/{mac,windows}.rs` + `mod.rs` | 【源码】实测存在 | 安装器 + **Apple Team ID 签名校验**，注释含「拒绝安装未验证的桌面应用」；**仅 macOS/Windows** |
| `cli/src/doctor/desktop.rs` | 【源码】实测存在 | doctor 会解析桌面端日志：日志根为 `~/Library/Logs/<identity>` / `%LOCALAPPDATA%\Codex\Logs`；检查项含「桌面应用已安装」「未运行」「app-server 初始化成功/失败」「未记录到 app-server 握手」 |
| `[desktop] git-worktree-root` / `worktree-auto-cleanup-enabled` / `worktree-keep-count` | 【源码】`worktree/src/settings.rs` 实测存在 | **桌面端管理并行 git worktree**，含自动清理与保留数量 |
| `(ConnectionOrigin::Stdio, "Codex Desktop")` | 【源码】`initialize_processor.rs` | 桌面端持有**特权客户端身份**；`userVerification` 只对 `(InProcess,"codex-tui")` 和 `(Stdio,"Codex Desktop")` 激活 |
| TUI 的 `/app` = 「continue this session in the Desktop app」 | 【源码】`tui/` | 终端 → 桌面的**会话交接**；`app/history_ui.rs` 有 `DESKTOP_THREAD_OPENED_MESSAGE`，Linux 上明确拒绝并提示「仅 macOS 与 Windows 可用」 |
| TUI 自带桌面通知 | 【源码】`config/src/types.rs:709` | `tui` 段有桌面通知配置 |

---

## 五、功能全清单（按域）

### 5.1 审批与权限 —— **最值得抄的部分**

**双轴模型**：**「什么权限」与「谁决策」是两个正交维度**，而非一个模式旋钮。

**审批策略**（【二进制】）：`untrusted`、`on-request`、`on_request_auto_review`、`unless_trusted`、`granular`、`never`

`granular` 变体含 **5 个独立开关**：`sandbox_approval`、`rules`、`skill_approval`、`request_permissions`、`mcp_elicitations`

**第二轴：审批复核者**
- `approvals_reviewer` + **auto-review** 系统：`on_request_auto_review`、`auto_review_model_override`、`auto_review.required_on_models`、`default_tools_approval_mode`
- 两个面向用户的预设名：**"Ask for approval"** 与 **"Approve for me"**
- 文案：「仅对检测为可能不安全的操作询问。」
- **有每轮拒绝上限**：「自动审批复核在本轮拒绝了过多审批请求」——**有界自主，不会陷入无限询问循环**

**审批交互动作**（【二进制】TUI 与 App 共用词汇）：

```
批准  /  批准本次会话  /  按 exec-policy 前缀批准  /  显式拒绝  /  拒绝并给出纠正指导
```

**「按前缀批准」是关键**：批准的是**模式**而非单次实例，把重复审批收敛成一次性规则。

**`request_permissions` 是一等公民工具**：*"Request additional filesystem or network permissions from the user and wait for the client to grant a subset of the requested permission profile."* —— **支持部分授予**，且授予在本轮/本会话后续调用中持续有效。

**策略被注入模型提示词**，让模型自知提权无望：
> *"You should not ask for escalated permissions if the approval policy is X; reject command"*
> *"you cannot request additional permissions unless the approval policy is OnRequest"*

**会话级 vs 一次性**在 API 层显式建模（`accept` / `acceptForSession`）。

**网络独立门控**：`sandbox_network_access`、`domains`、`allowed_domains`、`denied_domains`、`allow_upstream_proxy`、`dangerously_allow_non_loopback_proxy`

**execpolicy**：**前缀式 Starlark 规则**。"If the command already matches an exec-policy allow rule, the command can be auto-approved without an extra prompt… including any sandbox bypass."

**权限档案切换是事务性的、可恢复的**（【二进制】）：
> *"failed to refresh config before thread transition; continuing with current in-memory config"*

**全权访问的警告文案是个 UX 范本**：
> *"Enable full access? When Codex runs with full access, it can edit any file on your computer and run commands with network, without your approval. Exercise caution when enabling full access. This significantly increases the risk of data loss, leaks, or unexpected behavior. We strongly recommend selecting "Ask for approval" instead."*

**三档旧模式的官方文案**（可作为自己产品的措辞参照）：

| 档位 | 文案 |
|---|---|
| `read-only` | 「Codex 可以读取当前工作区的文件。编辑文件或访问互联网需要审批。」 |
| `auto`（默认） | 「Codex 可以读取和编辑当前工作区的文件，并运行命令。访问互联网或编辑其他文件需要审批。」 |
| `danger-full-access` | 「Codex 可以编辑你电脑上的任何文件，并在无需审批的情况下带网络运行命令。」 |

### 5.2 沙箱（分平台）

**两代模型并存**
- 旧：`sandbox_mode` = `read-only` / `workspace-write` / `danger-full-access`
- 新：**权限档案** `permission_profile`、`active_permission_profile`、`[permissions] profiles`、`default_permissions`、`PermissionProfileToml{extends, workspace_roots, filesystem, network,…}`

**文件系统权限是 glob 感知、作用域化的**：`ExecFileSystemPath::{Path, Special, GlobPattern}`，`Special` 含 `Root`/`Minimal`/`Tmpdir`/`SlashTmp`，另有 `missing_path_behavior` 与 `glob_scan_max_depth`。

**有明确的迁移方向**（【二进制】）：
> *"`readOnly.access` is no longer supported; use permissionProfile for restricted reads"*
> *"derived permission profile cannot be represented as a legacy sandbox policy; falling back to read-only"*

**Linux**：`no_new_privs` + seccomp + bubblewrap（`use_linux_sandbox_bwrap`、`use_legacy_landlock`）

**macOS**：Seatbelt（【二进制】字符串中未见更多证据，实现细节**无法确定**）

**Windows —— 是真的有，而且很实**【二进制】：
- 独立助手二进制：`codex-windows-sandbox-setup.exe`（15.4 MB）、`codex-command-runner.exe`（8.2 MB）
- 特性门：`experimental_windows_sandbox`、`elevated_windows_sandbox`、`windowsSandboxPrivateDesktop`
- 安装命令：**`codex sandbox setup --elevated --user <user> --codex-home <home>`**，且「当前必须 `--elevated`」、「需从提权 shell 运行」
- 成功提示：「沙箱就绪。Codex 现在可以安全地在你电脑上编辑文件并执行命令」
- 提权模型串：`elevated backend`、`denied-read restrictions`
- 安装失败上报本身被加固：失败报告「不可读」「大于 64 KiB」「不是常规文件」都要处理
- 托管策略杠杆：`allowedWindowsSandboxImplementations`、`windows.sandbox`、`windowsManagedDir`

**能力边界被诚实声明**：
> *"only restricted managed filesystem permissions can be enforced by the Windows sandbox"*
> *"only managed permission profiles can be enforced by the Windows sandbox"*

即 Windows 上 `External` 类档案**无法强制**，会回退。**这种诚实比"悄悄不生效的沙箱"好得多，值得照抄态度。**

### 5.3 工具集

【源码】+【二进制】确认存在的工具：

| 工具 | 说明 |
|---|---|
| `shell_command`（别名 `Bash` / `exec_command`） | 支持 `tty: true`；**Windows 上 yield 有效区间是 10000–30000 ms**（其他平台默认 10000） |
| `apply_patch` | **FREEFORM 工具**：「不得包成 JSON」 |
| `update_plan` | TODO/清单工具；**在 Plan 模式下不允许使用** |
| `view_image` | **受模型图像能力门控**：「因为你不支持图像输入，view_image 不被允许」；`detail` 限 `high`/`original` |
| `web_search` | 独立响应项 `web_search_call`；带 `WebSearchLocation`（国家/地区/城市/时区） |
| `request_permissions` | 见 §5.1 |
| 子代理工具 | `spawn_agent` / `send_message` / `followup_task` / `wait_agent` / `interrupt_agent` / `list_agents` |
| `request_user_input` | `RequestUserInputQuestion{header,question,options,isOther,isSecret}` |
| `wait_for_environment` | 等待环境就绪 |
| `write_stdin` | 「向已存在的统一 exec 会话写入字符」 |
| `list_files` / `search` | 解析后的命令类型 |
| MCP 工具 | `McpToolCallItem{server,connectorId,mcpAppResourceUri,linkId,appName,actionName,pluginId,readOnlyHint}` |
| `js_repl` / `code_mode` | 代码模式（见 §5.9） |

**工具暴露面与延迟加载**（【二进制】）：`ToolExposureSurface` = `code_mode` / `deferred` / `direct`，配套 **`tool_search_call` / `tool_search_output`** —— 工具清单**按需延迟加载以节省上下文**。

### 5.4 多代理与并行

**工具层**：`spawn_agent`、`send_message`、`followup_task`、`wait_agent`、`interrupt_agent`、`list_agents`、`resume_agent`、`close_agent`

**一条硬约束**：
> *"collaboration tools cannot be called from inside `functions.exec`… since they are intentionally absent from the `functions.exec` `tools.*` namespace."*

**层级任务路径**（很值得抄的命名设计）：
> *"If your current task is `/root/task1` and you spawn_agent with task_name "task_3" the agent will have canonical task name `/root/task1/task_3`."*

**并发配置** `[features.multi_agent_v2]` 含 16 个字段：`max_concurrent_threads_per_session`、`min/max/default_wait_timeout_ms`、`subagent_developer_instructions`、`tool_namespace`、`hide_spawn_agent_metadata`、`expose_spawn_agent_model_overrides`、`disable_in_process_fallback` 等。

**成本提示写在提示词里而非只写在文档里**：
> *"…subagents which can increase usage quickly. Consider setting features.multi_agent_v2.max_concurrent_threads_per_session below 8."*

**模型继承是默认行为**，提示词明说：*"Do not set the `model` field unless the user explicitly asks for a different model."*

**分叉**：`fork` 需要 `thread-spawn session source` / `fork mode` / `parent spawn call id`；携带 `forked_from_thread_id`、`parent_thread_id`、`parent_turn_id`、`root_turn_id`。

**Guardian**：一个独立的审查/闸门子代理 —— `guardianv2`、`guardian_subagent`、`GuardianWarningNotification`、`guardian_policy_config`、`thread/approveGuardianDeniedAction`。

**后台工作**：`thread/backgroundTerminals/{list,terminate}`、`wait_for_environment`、`EnvironmentSnapshot`、`thread/environment/{connected,disconnected}`。

**注意**：并行是**线程式**的（`agent-graph-store` 管父子拓扑），`worktree` crate 管隔离工作树。二者配合，而非"每代理一 worktree"。【推断】

### 5.5 技能（Skills）

- **一个技能 = 一个文件夹**，必须有 `SKILL.md`，可选 `scripts/`、`templates/`、`examples/`、`references/`
- 技能根：`$CODEX_HOME/skills/<name>`（默认 `~/.codex/skills`）、`skills/.system/`（预装：`imagegen`、`openai-docs`、`plugin-creator`、`skill-creator`、`skill-installer`、`review-agent`）、`skills/.curated`、`skills/.experimental`
- 触发方式：**`$SkillName`** 或纯文本，或描述匹配
- frontmatter 是 YAML 且**被校验**：「SKILL.md frontmatter 中有意外键」「允许的属性为…」
- **两条值得抄的提示词纪律**：
  - **~500 行上限**：「保持 SKILL.md 在 500 行以内；把详细参考内容移到支撑文件。」
  - **「不要把技能指令的阅读、总结或解释委派给子代理。」**
  - **「技能不跨轮携带，除非重新提及。」**
- API：`skills/list`、`skills/read`、`skills/config/write`、`skills/extraRoots/set`、`skills/changed` 通知；`skill://` 资源协议

### 5.6 钩子（Hooks）

**12 个生命周期事件**：
`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`SubagentStart`、`SubagentStop`、`Stop`

**处理器类型**：`command`、`mcp_tool`、`prompt`、`agent`；执行模式 `sync` / `async`；每个钩子可配 `matcher`、`timeout`、`statusMessage`

**协议是退出码 + JSON 驱动的，且校验很严**：
- **退出码 2 = 阻断**，且**必须往 stderr 写原因**：「PreToolUse 钩子以退出码 2 退出但未向 stderr 写入阻断原因」
- JSON 字段：`decision`、`reason`、`hookSpecificOutput`、`permissionDecision`（`allow`/`deny`/`ask`）、`additionalContext`、`updatedInput`、`updatedMCPToolOutput`、`continue`、`stopReason`、`suppressOutput`
- **schema 以 JSON Schema 内嵌在二进制里**（`PreToolUseDecisionWire` 等）
- 甚至精确上报不支持的组合：「PreToolUse 钩子返回了不支持的 permissionDecision:ask」

**哈希信任**：`HookStateToml{enabled, trusted_hash}` —— **被编辑过的钩子会重新询问**，这是很好的安全设计。

`allow_managed_hooks_only` 供企业策略收紧。

**Windows 特例**：有 `commandWindow` 变体 —— 即 Windows 上异步钩子需要特殊处理以避免弹控制台窗口。

### 5.7 插件与市场

- `codex plugin marketplace {add,list,remove,upgrade}`
- `codex plugin {list,search,install,uninstall,installed,read}`
- 源形式：`owner/repo[@ref]`、`--sparse`、HTTPS/SSH git
- 个人市场：`~/.agents/plugins/marketplace.json`；另含 `openai-curated-remote`
- 协议面：14 个 `plugin/*` + 7 个 `marketplace/*` + 5 个 `plugin/share/*` RPC

### 5.8 记忆（Memories）

- **读写路径刻意拆成两个 crate**（`memories/read` 管注入与引用解析；`memories/write` 管启动管线、Phase-1/Phase-2 提示渲染、工作区 diff）
- 配置：`disable_on_external_context`、`generate_memories`、`use_memories`、`dedicated_tools`、`max_raw_memories_for_consolidation`、`max_unused_days`、`max_rollout_age_days`、`max_rollouts_per_startup`、`min_rollout_idle_hours`、`min_rate_limit_remaining_percent`、`extract_model`、`consolidation_model`
- API：`memory/{status,reset}`、`thread/memoryMode/set`

### 5.9 代码模式（Code Mode）

- crate 组：`code-mode`、`code-mode-host`、`code-mode-protocol`、`code-mode-runtime`，外加 **独立的 host 可执行文件 `codex-code-mode-host.exe`**（65.9 MB）
- 能力：在沙箱内执行 JavaScript，带 `exec`/`wait` **嵌套工具协议**；`render_json_schema_to_typescript` 把 JSON Schema 渲染成 TS 类型
- 源码路径显示其结构：`core/src/tools/code_mode/{mod,delegate,execute_handler,wait_handler}.rs`
- 相关开关：`code_mode`、`code_mode_buffered_exec`、`code_mode_host`、`code_mode_interrupt`、`code_mode_only`、`js_repl`、`js_repl_tools_only`
- **`v8-poc` 是空壳**：自述"为未来 V8 实验保留的 Bazel 接线概念验证 crate"

### 5.10 语音与实时

- crate：`voice-host`、`realtime-webrtc`、`utils/audio`
- API：`thread/realtime/{start,stop,appendAudio,appendText,appendSpeech,listVoices}`
- 通知：`thread/realtime/{started,closed,error,sdp,itemAdded,item/started,item/completed,item/transcript/delta,transcript/delta,transcript/done,outputAudio/delta}`
- 即：**WebRTC 传输 + SDP 协商 + 音频增量 + 转写增量**，是完整的实时语音管道

### 5.11 MCP 与连接器

- 配置 `[mcp_servers]`，`RawMcpServerConfig` 有 **28 个字段**：`command`、`args`、`env`、`env_vars`、`cwd`、`http_headers`、`env_http_headers`、`bearer_token_env_var`、`http_headers_helper`、`oauth`、`oauth_resource`、`url`、`enabled`、`startup_timeout_sec/_ms`、`tool_timeout_sec`、`required`、`supports_parallel_tool_calls`、`omit_tools_from`、`scopes`、`environment_id`、`auth`…
- 命令：`codex mcp add <NAME> (--url <URL> | -- <COMMAND>...)`、`list`/`get`/`remove`/`login`/`logout`
- **`codex mcp-server` 已废弃**：「警告：`codex mcp-server` 已废弃，将在未来版本移除」
- **MCP elicitation（服务端→客户端结构化输入）**：`ElicitationRequest::{OpenAiForm,Form,Url}` —— 服务端可以反向要求客户端弹出表单
- 通知：`McpStartupUpdate`/`McpStartupComplete`、`McpToolCallBegin/End`、`McpToolCallProgressNotification`
- **连接器（Connectors）**：`codex_apps` 托管连接器，带 `AppInfo`、`AppBranding`、`AppToolPolicy`、`connector_runtime`、`metadata_store`

### 5.12 模型与提供商

- `model_providers`（`ModelProviderInfo` **18 字段**：`base_url`、`env_key`、`wire_api`、`query_params`、`http_headers`、`request_max_retries`、`stream_max_retries`、`requires_openai_auth`…）
- **推理力度阶梯**：`minimal` → `low` → `medium` → `high` → `xhigh` → `max` → `ultra`
- 其他旋钮：`model_context_window`、`model_auto_compact_token_limit`、`model_reasoning_summary`、`model_verbosity`、`service_tier`、**`personality`（`default`/`friendly`/`pragmatic`）**
- 本地提供商：`lmstudio`、`ollama`
- `models-manager`：内置 `models.json` 目录 + 预设 + `collaboration_mode_presets` + 远程刷新
- 压缩：`compaction`/`compaction_trigger`/`context_compaction` 响应项、`compact_prompt`、`experimental_compact_prompt_file`、`compact_remote_request`
- 传输扩展：WebSocket 支持（`supports_websockets`、`websocket_connect_timeout_ms`、`stream_idle_timeout_ms`）、`use_responses_lite`

### 5.13 会话 / 线程 / 存储

- **rollout**：JSONL 会话文件 + `rollout-trace` 追踪包格式
- **SQLite**：`codex.sqlite`，镜像 rollout 元数据（特性门 `sqlite`）
- **`thread-store` 是存储中立的**：`ThreadId` 是唯一持久句柄，实现可指向本地文件、RPC 等
- `message-history`：全局追加式 `~/.codex/history.jsonl`，`O_APPEND` 单次写保证并发安全
- **线程方法全家桶**：`start`/`resume`/`fork`/`archive`/`unarchive`/`delete`/`rollback`/`revert`/`list`/`read`/`search`/`searchOccurrences`/`timeline/list`/`turns/list`/`items/list`/`inject_items`/`compact/start`
- **`threadSection`（用户自建分组/文件夹）**：`list`/`create`/`update`/`delete`/`move`
- **`thread/queue`（队列）**：`add`/`list`/`update`/`delete`/`reorder`/`start` —— 可以先把消息排进队列
- **`thread/goal`（目标）**：`set`/`get`/`clear`，配 `GoalsToml{max_goal_token_budget}`；且**目标要求已持久化的线程**（「本线程是临时的」会拒绝）
- 附件：`thread/attachment/{add,list,remove}`
- CLI：`codex resume` / `fork` / `archive` / `delete` / `queue` / `review`

### 5.14 配置分层（很值得抄的设计）

**配置层是具名且可枚举的**（【二进制】）：

```
thread  system  user  project  mdm  session_flags  plugin  unknown
cloud_requirements  cloud_managed_config
legacy_managed_config_file  legacy_managed_config_mdm
enterprise  managed  profile  defaults  file  domain  key
```

**企业 `requirements` 层有 36 个元素**，含 `allowed_login_methods`、`allowed_approval_policies`、`allowed_sandbox_modes`、`allowed_permission_profiles`、`allowed_web_search_modes`、`allow_managed_hooks_only`、`allow_remote_control`、`computer_use`、`browser_use`、`enforce_residency`、`feature_requirements`。

**它能否决默认值并"响亮回退"**：
> *"default approval policy is disallowed by requirements; falling back to required default"*

**特性门约 80 个**，且提供命令面：`codex features list` / `enable` / `disable`。

### 5.15 云与后端

- `codex cloud`（`--cursor=`）、`--query`、`--environment`、**`--attempts`（best-of-N）**、`--branch`
- 错误文案：「环境 '…' 未找到；运行 `codex cloud` 列出可用环境」「环境标签 '…' 有歧义」
- `backend-client`、`cloud-config`、`cloud-tasks-mock-client`（测试用）
- 远程/外部环境：`ExternalSandbox`、`EnvironmentSnapshot`、`RemoteSandboxConfig`、`wait_for_environment`
- **跨操作系统**：`app-server` 与 `exec-server` 可以运行在不同操作系统上（`AGENTS.md:319`）
- `remoteControl/*` 配对 + 客户端列表/吊销；`allow_remote_control`

### 5.16 TUI 呈现细节（客户端 UX 的最完整范本）

**命令面**：`codex`、`codex exec`、`codex review`、`codex resume`、`codex queue`、`codex archive`、`codex delete`、`codex unarchive`、`codex fork`、`codex mcp`、`codex sandbox`、`codex debug prompt-input`、`codex app`、`codex cloud`、`codex agents`、`codex login`、`codex plugin`、`codex features`、`codex app-server`、`codex doctor`
**斜杠命令**：「输入 / 打开命令弹窗；Tab 补全斜杠命令」；确认存在 `/compact`、`/resume`、`/fast`、`/keymap`、`/diff`、`/ide`、`/worktree`、`/import`（**完整清单未能提取，属不确定**）

**键位（实测提取）**：

| 场景 | 键位 |
|---|---|
| **审批覆盖层** | `y` 批准 · `a` 批准本次会话 · `p` 按前缀批准 · `d` 拒绝 · `n`/`Esc` 婉拒 · `c` 取消 · `o` 打开线程 |
| **会话选择器（agents overview）** | `Ctrl+O` 恢复 · `Ctrl+F` 搜索 · `Ctrl+N` 新任务 · `Ctrl+R` 重命名 · `Ctrl+X` 停止 · `Ctrl+E` 归档 · `Delete` 删除 · `Ctrl+W` 隐藏 · `Ctrl+S` 切换分组 |
| **输入框** | `Enter` 提交 · `Tab` 入队 · `Alt+Up`/`Shift+Left` 编辑已排队消息 · `Alt+Down`/`Shift+Right` 提示栈后退 · `Ctrl+R/S` 历史搜索 · `Ctrl+A/E` 行首尾 · `Ctrl+U/K` 杀到行首/尾 · `Ctrl+Y` yank |
| **vim 普通模式** | 完整一套：`i/a/A/I/o/O/R`、`h/j/k/l`、`w/b/e`、`f/F/t/T`、`x`、`r`、`.`、`s`、`D`/`C`、`Y`/`y`/`d`/`c`、`u`、`Ctrl+R` |
| **vim 文本对象** | `iw`/`aw`、`i(`/`a(`、`i[`/`a[`、`i{`/`a{`、`i"`/`a"`、`i'`、`` i` `` |
| **滚动回看** | `q`/`Ctrl+C` 关闭 · `Ctrl+T` 关闭 transcript · `Home`/`End` 跳转 · `Ctrl+U/D` 半页 |

键位可由配置覆盖，有 `keymap_picker.rs` 界面与保留键列表校验。

**状态栏项目**（`bottom_pane/status_line_setup.rs`）：`context-used`、`project-name`、`run-state`、`thread-credits`、`estimated-thread-cost`、`pull-request-number`、`branch-changes`
其官方描述值得抄：「当前分支的开放 PR 号（不可用时省略）」「相对默认分支的已提交变更」「当前权限档案或沙箱模式」「当前命令审批模式」「上下文窗口总量」「本线程预估成本（仅企业工作区）」
**终端标题是另一套独立可配置项列表。**

**主题选择器**：列出内置主题 + `{CODEX_HOME}/themes/` 下的自定义 `.tmTheme`；**导航时实时预览**、**Esc/Ctrl+C 取消并还原**、确认后写回 `config.toml`；两种响应式预览布局。

**diff 视图**：`diff_model.rs` + `diff_render.rs`，语法高亮，行号宽度计算，`/diff` 含未跟踪文件。

**滚动历史**：字节锚定（`HistoryByteAnchor{position,revision}`）、批次游标、`Reveal`/`QuietLinger`/`removal_deadline` 生命周期、分页 `initialTurnsPage`/`turnsBackwardsCursor`、`thread/search` + `searchOccurrences` 字节范围命中。

**其他**：pets（`TuiPetAnchor`，可锚定到输入框或屏幕底部）、animations、tooltips、`vim_mode_default`、`raw_output_mode`、`alternate_screen`、`terminal_resize_reflow` + 行数上限、`session_picker_view`、transcript 导出 markdown、重连 UI、安全缓冲 UI。

**线程状态机**（让 UI 能解释"为什么卡住"）：
`waitingOnApproval` / `waitingOnUserInput` / `paused` / `blocked` / `usageLimited` / `budgetLimited`

### 5.17 可观测性与诊断

- `otel` + `otel-trace-websocket`（把回环 OTLP 批次尽力转发到独立 WebSocket 监听器）、`analytics`、`feedback`、`diagnostics`、`runtime_metrics`
- 内嵌 Sentry DSN
- **`codex doctor`** 检查面很广：`install`、`sandbox`、`security`、`network`、`disk`、`git`、`updates`、`system`、`runtime`、`thread_inventory`、`windows_dev_drive`、`background`、`desktop`（桌面端专用）
- app-server 的 `server/diagnostics` **刻意不含内容**、进程本地

---

## 六、值得抄的产品决策（汇总）

1. **双轴权限模型**：`什么权限`（档案：根 + glob + 网络）与 `谁决策`（审批策略 + 复核者 + 自动复核）分离，远胜单一模式旋钮
2. **服务端反向调用客户端做审批**，客户端只需渲染提示 + 回传决策 —— 审批 UX 完全由服务端编排
3. **"按 exec-policy 前缀批准"**：批准**模式**而非实例，把重复审批收敛成规则
4. **`request_permissions` 一等公民 + 部分授予 + 会话级持续**
5. **自动复核有每轮拒绝上限**：有界自主，不陷入无限询问
6. **策略注入模型提示词**，让模型自知提权无望，避免无效尝试
7. **全权访问的警告文案**：说清后果 + 给出更好的替代方案，而不是简单确认框
8. **恢复优先的错误处理**：`继续使用当前内存配置` —— 降级而非中止
9. **诚实声明能力边界**（Windows 只能强制受限托管权限），不交付"悄悄不生效的沙箱"
10. **技能 = 无构建步骤的文件夹** + 渐进披露 + ~500 行上限 + 不跨轮携带 + 不委派给子代理
11. **钩子哈希信任**：改过的钩子重新询问；退出码 2 = 带原因阻断；发布 JSON Schema
12. **延迟工具命名空间 + 工具搜索**，把工具清单挡在上下文之外
13. **层级代理任务路径**（`/root/task1/task_3`）比不透明 ID 可读得多
14. **成本提示写进提示词**，不只写文档
15. **富状态机**：UI 能解释"为什么卡住"，不只是"忙"
16. **具名可枚举的配置层** + 企业 requirements 层**能禁用默认值并响亮回退**
17. **字节锚定的历史滚动** + reveal/quiet-linger 生命周期 —— 流式 transcript 的细致力学
18. **协议优先**：先定协议再生成 721 个 TS 文件 + 312 个 schema，而不是手写类型
19. **进程内模式复用线上信封**：注释写明"避免第二套执行契约" —— 避免了双契约腐化
20. **客户端身份是安全边界**：`(Stdio, "Codex Desktop")` 这种特权身份是显式建模的，而非隐含约定

---

## 七、对 DSH 桌面端插件的启示

### 7.1 核心判断

**Codex 的产品力 = 三层解耦，而不是某个 UI 魔法。**
而 **DSH 的引擎层与协议层已经现成**：

| Codex | DSH 对应 |
|---|---|
| `codex-core`（引擎） | DSH 核心 + `packages/*`（session/goal/plan/subagent/workflow/skill/mcp/hooks/sandbox…） |
| `app-server-protocol` + 721 TS 文件 | `packages/typert` + `packages/api` + `packages/api-remotes` |
| `app-server-transport`（4 种传输） | `packages/client/connection` + **`__DSH_TRANSPORT__` 页面全局** |
| 桌面 App（私有客户端） | **← 这就是你要做的东西** |

所以这个桌面插件的工作量主体**不是造功能，而是把 DSH 已有的能力做成桌面级的交互与呈现**。

### 7.2 能力对照

（DSH 侧依据 `packages/` 目录名判断，**带 ~ 者未逐一读 README**）

| Codex | DSH | 判断 |
|---|---|---|
| 会话/线程持久化 | `session` + `session-query` + `storage` | ✅ |
| 审批与权限 | `interaction` + `guard` + `permission-presets` | ✅ |
| 沙箱 | `sandbox` + `shell/pwsh-local`（Windows 受限令牌） | ✅ |
| 计划模式 | `plan` | ✅ |
| 目标 | `goal` | ✅ |
| 子代理 | `subagent`（有注册表与多后端） | ✅ |
| 工作流 | `workflow` | ✅ |
| 技能 | `skill` | ✅ |
| MCP | `mcp` | ✅ |
| 钩子 | `hooks` | ✅ |
| 终端 / PTY | `terminal` + `jobs` | ✅ |
| LSP | `lsp` | ✅ |
| 远程沙箱 | `e2b` | ~ |
| 代码执行 | `experimental` + `code-runtime` | ~ |
| 类型化 RPC 契约 | `typert` + `api-remotes` | ✅ |
| **插件市场** | 无内置商店（**已核实**） | ❌ |
| **内置浏览器** | — | ❌ |
| **computer use** | — | ❌ |
| **语音 / 实时** | — | ❌ |
| **worktree 并行** | `workspace` 有多工作区 | ~ 部分 |
| **任务队列** | `jobs` + `schedule` | ~ 形态不同 |
| **应用内更新** | — | ❌（纯桌面原生） |
| **通知 / 托盘 / 多窗口** | — | ❌（纯桌面原生） |

### 7.3 建议的优先级

| 优先级 | 做什么 | 理由 |
|---|---|---|
| **P0** | 窗口 + 标题栏 + 托盘 + 系统通知 + 多窗口 | 让"是个 app"成立；纯桌面原生，上游零耦合 |
| **P0** | 审批交互升级（**按会话批准 / 按前缀批准 / 拒绝并给指导**） | Codex 最值得抄的一处；DSH 引擎已有审批服务 |
| **P1** | 子代理 / 工作流可视化面板 | DSH 有 `subagent` + `workflow` + 层级信息，缺的是呈现（对应 Codex 的 agents overview） |
| **P1** | 多会话并行视图 + 工作区切换 | 对应 Codex 的 thread sections / worktree |
| **P2** | 应用内更新、开机自启、协议唤起、全局热键 | 桌面原生补全 |
| **P3** | 内置浏览器 / computer use / 语音听写 | Codex 独有且重，**建议先不做** |

### 7.4 明确不建议做的

- **自绘 UI 布局**：社区项目 `lansi-ai/dsh-desktop` 为此返工三次，其中一次用 `return null` 占位导致**整个应用锁死而 typecheck/lint/build 全绿**。走官方 slots —— **只加，不接管**。

---

## 八、无法确定的部分

**桌面 App 本身（闭源）**
- 界面框架、布局、交互设计：仓库中**无任何前源代码**
- 九个特性门的具体实现方式
- 桌面端与 app-server 的精确握手序列（只知道它解析自己的日志里的"app-server 握手"记录）
- IDE 扩展的 agent 工作是否也走 app-server（只证明了 IDE 上下文走私有 IPC）
- 是否有协议版本号（未找到；协商靠能力标志 + 增量演进 + 废弃通知）
- `sdk/` 的完整面（本次未逐行读完）

**整体**
- 完整斜杠命令表与键位表（clap/bashly 命令表不会以纯字符串存活，故 §5.16 不完整）
- macOS Seatbelt 沙箱的实现细节
- 大部分配置键的**默认值与优先级**
- `guardian-v2`、`ext/image-generation`、`ext/web-search` 等的行为（只读到存在与导出面）

---

## 附录：证据索引

| 材料 | 位置 |
|---|---|
| Codex 开源仓库 | `openai/codex`，本次浅克隆于会话临时目录（含 `codex-rs/`、`sdk/`、`docs/`） |
| 协议定义 | `codex-rs/app-server-protocol/src/protocol/common.rs`、`src/rpc.rs` |
| 传输 | `codex-rs/app-server-transport/src/{lib.rs,transport/{stdio,websocket,mod}.rs}`、`connection_auth.rs` |
| 进程内模式 | `codex-rs/app-server/src/in_process.rs` |
| 特性门（含 9 个桌面门） | `codex-rs/features/src/lib.rs:244-277` |
| worktree 桌面契约 | `codex-rs/worktree/src/settings.rs` |
| 桌面端安装器 | `codex-rs/cli/src/desktop_app/{mac,windows,mod}.rs` |
| 桌面端诊断 | `codex-rs/cli/src/doctor/desktop.rs` |
| IDE 上下文私有 IPC | `codex-rs/tui/src/ide_context/ipc.rs` |
| 设计意图声明 | `codex-rs/docs/protocol_v1.md:43,57` |
| 二进制字符串审计 | 本机 `@openai/codex@0.149.1-win32-x64`（DSH 依赖），提取约 519 万条可打印字符串 |
| 闭源桌面端公开报道 | 见下 |

外部链接（第三方来源，仅供交叉参考）：

- [隆重介绍 Codex](https://openai.com/zh-Hant/index/introducing-codex/)
- [推出 Codex 应用](https://openai.com/zh-Hans-CN/index/introducing-the-codex-app/)
- [（几乎）样样都做得到的 Codex](https://openai.com/zh-Hant-HK/index/codex-for-almost-everything/)
- [OpenAI's Codex Desktop can run your computer now - and has its own browser（ZDNET）](https://www.zdnet.com/article/openai-codex-desktop-update/)
- [OpenAI's Codex Mac app adds three key features that go beyond agentic coding（9to5Mac）](https://9to5mac.com/2026/04/16/openais-codex-app-adds-three-key-features-for-expanding-beyond-agentic-coding/)
- [Codex App 客户端功能详解：支持工作树、自动化、内置浏览器](https://cloud.tencent.com/developer/article/2690056)
- [Codex 四种形态怎么选：CLI、App、Web、IDE 插件完整对比](https://news.qiniu.com/archives/1785123863147)
