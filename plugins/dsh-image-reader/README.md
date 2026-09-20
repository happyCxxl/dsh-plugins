# dsh-image-reader

让**纯文本模型**的会话也能读取用户上传的图片：透明地给原生 `deepseek-official` 适配器的纯文本模型装上读图能力——发图时由视觉模型把图片转成文字，再交给纯文本 DeepSeek 作答。**不改模型选择器、不新增路由**，主模型只看到文字，会话记录里仍保留图片本身。

## 解决的问题

会话模型为纯文本（如 `deepseek-v4-pro` / `deepseek-v4-flash`）时，在 GUI 里上传图片会被拒：

> 当前模型不支持图片，请切换支持图片的模型

本插件**不改会话模型、不加新路由**，直接让原生 DeepSeek 的 v4-pro / v4-flash 也能收图（自动转成文字）。

## 安装

```powershell
dsh plugin --profile web add @cxxl/dsh-image-reader
# 装完重启一次（bundle 层只在启动时读取）
```

本地开发推荐 tarball 通道（避免 junction 悬空）：

```powershell
cd plugins/dsh-image-reader
npm pack                                   # 产出 cxxl-dsh-image-reader-0.1.1.tgz
dsh plugin --profile web add ./cxxl-dsh-image-reader-0.1.1.tgz
```

## 使用

装好重启后**照常用**：模型选择器保持原样（只有原生「DeepSeek」组），选 v4-pro / v4-flash，直接拖 / 粘贴图片发送即可。图片会被视觉模型转成文字（带 `[图片内容（由视觉模型读出）]` 标记）交给 DeepSeek；对话里仍能看到图片缩略图。

需要 `DEEPSEEK_API_KEY`（读图走官方视觉模型 `deepseek-v4-flash-vision-exp`，凭据服务或环境变量均可）。

## 行为

| 条件 | 行为 |
|---|---|
| 消息无图片 | 原样转发，零开销 |
| 纯文本模型（v4-pro / v4-flash）+ 有图 | 逐图转译成文字后委托给 DeepSeek |
| 视觉模型（`deepseek-v4-flash-vision-exp`）+ 有图 | 原样通过，不二次转译 |
| 读图失败 / 超时 | **fail open**：图片位置换成 `[图片读取失败: …]` 文本，会话继续，绝不丢消息 |

## 目录结构

```
plugins/dsh-image-reader/
├── package.json       # 元数据：dsh.bundle.patch 指针、peerDependencies（仅 schemastery）、files 白名单
├── cordis.patch.yml   # 一行 insert：id=dsh-image-reader → @cxxl/dsh-image-reader
├── lib/
│   ├── index.js       # 入口：适配器包装（resolveModel / prepareCall）
│   ├── config.js      # 配置契约：DEFAULT_INSTRUCTION + schemastery Config（7 个可调项）
│   └── transcribe.js  # 转述管线：探测图片块 / 调视觉模型 / 替换消息内容
├── README.md          # 本文件
└── LICENSE            # MIT
```

## 入口与挂载

- **安装**：`dsh plugin --profile web add <npm包名|tgz>` → 包里的 `cordis.patch.yml` 把插件行插入 profile 的 bundle 层 → **重启后 boot 时读取**；
- **插件形态**：纯 Host 插件（**没有 client.js、没有 `dsh.client`**，浏览器端零代码）。Loader 经 `package.json` 的 `main`/`exports` 找到 `lib/index.js`，读它导出的 `name` / `inject` / `Config` / `apply`；
- `inject = ['llm', 'attachments']`：声明两个硬依赖服务（模型路由层与附件存储层），由 Cordis 在就绪后注入；
- `Config`（schemastery 声明）在 `apply` 执行前被 Loader 校验并填充默认值，`apply(ctx, config)` 拿到的永远是完整配置。

## 插件逻辑

**① 配置契约（config.js）**——7 个可调项全带默认值（见下方「配置」表）；`DEFAULT_INSTRUCTION` 是默认转述提示词。

**② 转述管线（transcribe.js）**——四层函数：

| 函数 | 职责 |
|---|---|
| `hasImage` | 递归探测消息内容块里是否有 `image`（含 tool-result 内层） |
| `resolveApiKey` | 凭据服务取 `DEEPSEEK_API_KEY`，回退环境变量 |
| `transcribeImage` | 从 attachments 服务读图片字节 → base64 dataURL → POST `baseURL/chat/completions`（visionModel），超时用 `AbortSignal.timeout` + 上游 signal → 解析 `choices[0].message.content` |
| `transcribeBlocks/Messages` | 逐块把图片替换为 `[marker]\n转述文字`；超 `maxImages` 上限给占位；**fail-open**——读图失败塞"读取失败"占位文本继续，绝不毒化会话；tool-result 递归处理 |

**③ 入口装配（index.js apply）**——三件事：

1. 取 `deepseek-official` 适配器（`ctx.llm.registration(provider).adapter`；找不到就记日志、能力不启用，插件不崩溃）；
2. 包装 `resolveModel`：对**纯文本模型**声明 `inputModalities: ['text','image']`——官方门禁（读的就是这个声明）由此放行图片附件；
3. 包装 `prepareCall`：**视觉模型原样通过**；纯文本模型返回包装流——消息里有图时先走转述管线把图换成文字，再委托原始流。

## 一次带图请求的数据流

用户发图 → 门禁见 `resolveModel` 声明 image 而放行 → LLM 调 `prepareCall` → 包装流收到 messages → `transcribeMessages` 把图替换成"`[图片内容（由视觉模型读出）]` + 转述文字" → 纯文本 DeepSeek 看到的是文字 → **会话记录里仍保留图片本身**（门禁放行后正常落盘）。

## 配置

可在 bundle 行的 `config:` 覆盖：

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | `deepseek-official` | 被包装的适配器路由 |
| `visionModel` | `deepseek-v4-flash-vision-exp` | 读图视觉模型 |
| `baseURL` | `https://api.deepseek.com` | 读图端点（OpenAI 兼容） |
| `marker` | `[图片内容（由视觉模型读出）]` | 转述前缀 |
| `maxImages` | `4` | 单条消息交给视觉模型的最多张数 |
| `timeoutMs` | `120000` | 读图超时 |
| `instruction` | 内置读图指令 | 转述风格/长度 |

## 依赖策略

Config 形态（见 `docs/PLUGIN_SPEC.md` §3.1）：仅 `@deepseek-ai/schemastery` 声明为 `peerDependencies`（版本对齐宿主自带 3.18.2，用于 Config 校验），不 import 其他 harness 包。

## 权限与副作用

- **运行时包装核心适配器**：插件在启动时对 `deepseek-official` 适配器做运行时包装（不修改任何源文件、不禁用任何核心行）。卸载 `dsh plugin --profile web remove @cxxl/dsh-image-reader` 后重启即恢复原状。
- **图片字节发往视觉端点**：读图请求会通过 HTTPS 把图片发给 `baseURL`（默认官方 DeepSeek）。敏感图片请把 `baseURL` 指向自建端点（如本地 Ollama），或卸载本插件。
- **作用范围**：所有走 `deepseek-official` 的纯文本模型（含子代理）都会获得读图能力。

## 已知限制

- 读图是**同步**的（发图后先等视觉模型读一次，数秒），主模型首答即带图内容。
- 同一张图重复发送会重复读图（不缓存）。
- 视觉模型默认值 `deepseek-v4-flash-vision-exp` 是 `-exp` 实验性模型，未来可能被替换或下线；届时改 `config.visionModel` 即可。

## 兼容性

- Harness `0.1.2-alpha.5` / Node `^22.19 || >=24`。
- 因为运行时包装了核心适配器，升级 harness 后建议先跑隔离实例冒烟（确认带图不再被拒、纯文本回归正常）。
