# dsh-image-reader 设计文档

> 状态：**v3 设计定稿（透明适配器包装）**。v1（session-controller 子类 + 禁用核心行）与 v2（新增 provider 路由）都已在实现后实测发现问题（见 §2 决策记录）；v3 改为**运行时包装核心 `deepseek-official` 适配器**——不新增路由、不改模型选择器，纯文本模型直接就能读图。
>
> 环境基准：Harness `0.1.2-alpha.5`（HEAD `49a606bc5b`）、Node ≥22.19、Windows；profile 为 `web`。

---

## 1. 结论（TL;DR）

- 插件在 `apply` 里取到核心 `deepseek-official` 适配器，运行时包装它的两个方法：
  - `resolveModel`：对纯文本模型把 `inputModalities` 改成 `['text', 'image']` → 门禁放行图片 → 图片正常落盘（缩略图 / 回放 / 审计不丢）。
  - `prepareCall`：对纯文本模型返回包装过的 `stream`，先把图片块交给官方视觉模型 `deepseek-v4-flash-vision-exp` 转成文字，再委托原始流 → 主模型只看到文字。
- 视觉模型（`deepseek-v4-flash-vision-exp`）原样通过，不二次转译。
- **不新增路由、不改模型选择器、不禁用任何核心行**；安装只 `insert` 一行；卸载即恢复。

---

## 2. 决策记录（为什么走到 v3）

### 2.1 现象与根因

纯文本模型（`deepseek-v4-pro` / `deepseek-v4-flash`）在 GUI 里上传图片会被拒：

> 当前模型不支持图片，请切换支持图片的模型

拦截点：`packages/api/session-controller/src/commands.ts:313-326` —— 每次带图 prompt 进来，先解析会话当前模型，若 `inputModalities` 不含 `image` 就抛 `MODEL_DOES_NOT_SUPPORT_IMAGES`。该门禁无 hook / waterfall / 拦截缝。

### 2.2 v1 / v2 的问题

| 版本 | 做法 | 问题 |
|---|---|---|
| v1 | 子类替换 `session-controller` + 禁用核心行 | 「图片保留」与「门禁拒绝」在门禁上游互斥（content 里有图就拒、没图就不落盘），不可解 |
| v2 | 注册一条新 provider 路由 `deepseek-image-reader` | 模型选择器出现两组**一模一样的模型**（原生组 + 自动读图组），用户要多此一举地切路由；且 v2 的 `listModels` 直接透传内层，导致视觉模型也重复出现在代理组里 |

v2 冒烟虽能过（带图不再被拒），但 UX 冗余明显。用户明确要求「照常可用」→ v3 改为透明包装。

### 2.3 调研结论（市面同类插件）

| 插件 | 层 | 做法 |
|---|---|---|
| [dsh-vision-proxy](https://github.com/Flyvhidbwo/dsh-vision-proxy) | LLM 适配器 | 注册新路由 `deepseek-vision` 包装 DeepSeek 适配器；`resolveModel` 声明 image，`stream` 里转译图片 |
| [dsh-vision](https://github.com/oil-oil/dsh-vision) | LLM 适配器 | **替换** `deepseek-official` 适配器（保留模型目录/设置/凭据）——与 v3 同思路 |
| [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 新路由变体 | 给文本模型注册 `<model> (Vision Toolkit)` 变体 |
| [dsh-auto-vision](https://github.com/NormanFxxkingRockwell/dsh-auto-vision) | 工具 | 注册 `vision` 工具读文件路径（粘贴图在准入层被硬拒、无扩展点） |

v3 与 `dsh-vision`（oil-oil）的「替换适配器」一致：透明、不加路由。

---

## 3. 技术路线

| 决策 | 依据 |
|---|---|
| **运行时包装核心适配器**（不新增路由） | 门禁读 `resolveModelInfo(provider, model).inputModalities`；给核心适配器的 `resolveModel` 加 image 声明，门禁即放行，且模型选择器保持原样 |
| **包装 `prepareCall` 而不是 `stream`** | `DeepSeekAdapter` 覆写了 `prepareCall`（`adapter.ts:432-438`），内部直接调 `modelInfoFor` / `streamWithConnection`，不走 `resolveModel` / `stream`；所以要在 `prepareCall` 层拦 |
| **只对纯文本模型转译，视觉模型原样** | 视觉模型能原生看图，转译会浪费且降质；`prepareCall` 返回的 `call.model.inputModalities` 是原始事实，据此判断 |
| **声明 image 防止运行时投影** | `adapterStream`（`llm/src/index.ts:996-1002`）对「text-only + 含图」会把图片投影成占位符；`prepareCall` 返回的 `model` 声明 image 后，原始图片才到我们的 `stream` |
| **读图走官方视觉模型（直接 HTTP）** | 复用用户已配置的 `DEEPSEEK_API_KEY`（凭据服务 → 环境变量），不新增第三方依赖 |
| **失败 fail open（占位文本）** | 视觉服务挂了也不毒化会话 |
| **只 `insert`、不改任何核心行** | 卸载一条命令即恢复 |

---

## 4. 关键机制（依据源码实查，本会话核实）

| 机制 | 位置 | 事实 |
|---|---|---|
| 图片门禁 | `packages/api/session-controller/src/commands.ts:313-326` | `hasImage` → `resolveModelInfo(current.provider, current.model)` → 不含 image 即拒 |
| `resolveModelInfo` 走 `resolveModel` | `packages/llm/llm/src/index.ts:712-727` | `registration.adapter.resolveModel(provider.id, model, signal)` |
| DeepSeekAdapter 覆写 `prepareCall` | `packages/llm/llm-deepseek/src/adapter.ts:432-438` | 直接调 `modelInfoFor` + `streamWithConnection`，**不经** `resolveModel` / `stream` |
| 运行时图片投影 | `packages/llm/llm/src/index.ts:996-1002` | text-only + 含图 → `projectImagesForTextModel` 占位符；声明 image 则不投影 |
| 取适配器 | `packages/llm/llm/src/index.ts:937` | `registration(provider)` 是 TS-private（JS 可访问），找不到时 throw `NO_ADAPTER` |
| 图片块形态 | `packages/attachment/attachment/src/types.ts:71-73` | 落盘后 `{type:'image', attachment: ImageAttachmentRef}` |
| 读图 | `packages/attachment/attachment/src/index.ts:111` | `readImage(ref, signal)` → `{ref, data: Uint8Array}` |
| DeepSeek 图片线格式 | `packages/llm/llm-deepseek/src/serialize.ts:155-159` | base64 路径 `{type:'image_url', image_url:{url:'data:…;base64,…'}}` |
| 凭据解析 | `packages/llm/llm-deepseek/src/index.ts:430-451` | `ctx.get('credentials').resolve('DEEPSEEK_API_KEY')` → `.value` |
| 官方视觉模型 | `packages/llm/llm-deepseek/src/index.ts:106-113` | `deepseek-v4-flash-vision-exp`，`inputModalities: ['text','image']` |

---

## 5. 实现规格

### 5.1 行为

| 条件 | 行为 |
|---|---|
| 消息无图片 | 原始流原样转发，零开销 |
| 纯文本模型 + 有图 | 逐图转译成 `marker + 文字`，替换图片块后委托原始流 |
| 视觉模型 + 有图 | 原始流原样转发，不二次转译 |
| 单条消息图超过 `maxImages` | 超出部分只留占位文本 |
| 读图失败 / 超时 | fail open：占位文本 `[图片读取失败: …]`，会话继续 |

### 5.2 Config

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | `deepseek-official` | 被包装的适配器路由 |
| `visionModel` | `deepseek-v4-flash-vision-exp` | 读图视觉模型 |
| `baseURL` | `https://api.deepseek.com` | 读图端点（OpenAI 兼容） |
| `marker` | `[图片内容（由视觉模型读出）]` | 转述前缀 |
| `maxImages` | `4` | 单条消息交给视觉模型的最多张数 |
| `timeoutMs` | `120000` | 读图超时 |
| `instruction` | 内置读图指令 | 转述风格/长度 |

### 5.3 参考实现

见 `lib/index.js`（全量，含 `resolveModel` 与 `prepareCall` 的包装）。

---

## 6. 工程结构与装载

```
plugins/dsh-image-reader/
├── package.json      # dsh.bundle.patch；peerDependencies 仅 schemastery
├── cordis.patch.yml  # 只 insert 一行
├── lib/index.js      # 透明适配器包装
├── README.md
├── LICENSE
└── DESIGN.md
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-image-reader
      name: '@cxxl/dsh-image-reader'
```

装载链路：`dsh plugin add` → pnpm 安装 → boot 时 `apply(ctx, config)` 执行 → 取 `deepseek-official` 适配器并包装其 `resolveModel` / `prepareCall`。**无层顺序要求**，但要求 `deepseek-official` 已注册（由 `dsh-base`/`dsh-web-app` 注册，天然早于本插件——本插件在 bundles 末尾）。

---

## 7. 错误处理与边界

| 场景 | 处理 |
|---|---|
| 找不到 `provider` 适配器 | 记 error，跳过（本插件不生效，不拖垮整机） |
| `readImage` 失败 / 校验不通过 | 该图占位文本，其余图继续 |
| 视觉模型 HTTP 非 2xx / 非 JSON / 空文本 | 记 warn，占位文本，fail open |
| 无 `DEEPSEEK_API_KEY` | 读图请求 401 → 占位文本 |
| 用户取消（signal abort） | signal 透传给 `readImage` / fetch / 原始流 |
| 一条消息多图 | 逐图转译（受 `maxImages` 上限）；会话保留全部图片 |
| 视觉模型走本插件 | 原样通过，不二次转译 |

---

## 8. 验证计划

### 8.1 隔离实例冒烟

独立 `DSH_HOME` + 独立端口，装 tarball 后起实例（本会话已实测通过）：

判据：
1. `modelCatalog` 的 `routableProviders` **只有** `deepseek-official`（没有第二条路由）。
2. 原生 `deepseek-official` / `deepseek-v4-flash` 带图 prompt → `{accepted:true}`（不再 `MODEL_DOES_NOT_SUPPORT_IMAGES`）。
3. 会话历史里图片以 `{type:'image', attachment}` 落盘。
4. `dsh plugin remove` 后重启 → 回到原状。

### 8.2 真实环境验收

装到真实 `web` profile、重启 GUI，模型选择器保持原样（只有原生 DeepSeek 组），选 v4-pro 拖图发送：不再被拒、有缩略图、主模型回复体现图内容（需 `DEEPSEEK_API_KEY`）。

---

## 9. 风险与维护点

| 风险 | 说明 | 对策 |
|---|---|---|
| **运行时包装核心适配器** | 依赖 `registration()`（private）与 `resolveModel` / `prepareCall` 的方法形态 | 升级 harness 后必须跑 §8.1 冒烟；这是唯一长期维护点 |
| 上游改 `prepareCall` 契约 | DeepSeekAdapter 内部实现变化 | 升级后冒烟；本插件只依赖公开方法名，不依赖内部字段 |
| 视觉模型默认 `-exp` 实验性 | 可能被替换/下线 | 走 Config，改 `visionModel`/`baseURL` 即可 |
| 图片字节发往视觉端点 | 隐私 | README 明示；`baseURL` 可指向本地 Ollama |
| 双份读图成本 | 同一张图重复发送重复转译 | v3 不缓存；后续可加内容哈希缓存 |

---

## 10. 明确不做（v3）

- 不缓存转述。
- 不做降级链 / 本地 Ollama 自动探测 / 图片降采样。
- 不做非图片附件（PDF/音频/视频）。
- 不做异步转述、不做「正在读图」的 UI 指示。

---

## 11. 决策记录

| # | 决策 | 依据 |
|---|---|---|
| 1 | v1（session-controller 子类）被推翻 | 图片保留 vs 门禁拒绝在门禁上游互斥（§2.2） |
| 2 | v2（新增路由）被推翻 | 模型选择器两组重复、多此一举（§2.2） |
| 3 | v3 透明包装核心适配器 | 与 dsh-vision 同思路，不新增路由（§2.3） |
| 4 | 包装 `prepareCall` 而非 `stream` | DeepSeekAdapter 覆写了 `prepareCall`（§3/§4） |
| 5 | 只对纯文本模型转译 | 视觉模型原生看图，避免降质 |
| 6 | 失败 fail open（占位文本） | 用户消息优先，读图是增强不是前置条件 |
| 7 | 只 insert、不改核心行 | 卸载即恢复 |
| 8 | 全部可调项进 `Config` | dev-notes「不要硬编码可调项」 |
| 9 | peerDependencies 只留 `@deepseek-ai/schemastery` | 只真正 import 它；其余服务经 `ctx` 运行时访问 |
