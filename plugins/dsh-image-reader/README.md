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

本地开发推荐 tarball 通道（见仓库 dev-notes D15，避免 junction 悬空）：

```powershell
cd plugins/dsh-image-reader
npm pack                                   # 产出 cxxl-dsh-image-reader-0.1.0.tgz
dsh plugin --profile web add ./cxxl-dsh-image-reader-0.1.0.tgz
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

## 架构

Host 端透明适配器包装（无浏览器端，不声明 `dsh.client`）：`apply` 里取到核心 `deepseek-official` 适配器后，运行时包装它的 `resolveModel`（对纯文本模型声明 `inputModalities: ['text','image']`，让门禁放行）和 `prepareCall`（对纯文本模型返回包装过的 `stream`，先转译图片再委托原始流）。

## 权限与副作用

- **运行时包装核心适配器**：插件在启动时对 `deepseek-official` 适配器做运行时包装（不修改任何源文件、不禁用任何核心行）。卸载 `dsh plugin --profile web remove @cxxl/dsh-image-reader` 后重启即恢复原状。
- **图片字节发往视觉端点**：读图请求会通过 HTTPS 把图片发给 `baseURL`（默认官方 DeepSeek）。敏感图片请把 `baseURL` 指向自建端点（如本地 Ollama），或卸载本插件。
- **作用范围**：所有走 `deepseek-official` 的纯文本模型（含子代理）都会获得读图能力。

## 已知限制

- 读图是**同步**的（发图后先等视觉模型读一次，数秒），主模型首答即带图内容。
- 同一张图重复发送会重复读图（不缓存）。
- 视觉模型默认值 `deepseek-v4-flash-vision-exp` 是 `-exp` 实验性模型，未来可能被替换或下线；届时改 `config.visionModel` 即可。

## 兼容性

- Harness `0.1.2-alpha.5` / Node `>=22.19`。
- 因为运行时包装了核心适配器，升级 harness 后建议先跑隔离实例冒烟（确认带图不再被拒、纯文本回归正常）。
