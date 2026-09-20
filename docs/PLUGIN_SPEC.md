# DSH 插件开发规范（dsh-plugins）

> 本文件是本仓库的权威开发规范：定义"应该怎样"，不描述现状。现状与规范的差距见 [AUDIT.md](AUDIT.md)。改代码前必读；任何改动触及契约时必须同一 commit 更新本文件（见第 10 节）。

## 1. 三层架构定位

| 层 | 内容 | 本仓库角色 |
|---|---|---|
| npm 插件包（bundle 层） | `dsh plugin --profile <name> add <包名>` 安装，**boot 时读取，装完必须重启** | `plugins/` 下的正式插件 |
| host composition | 跨会话共享注册表（注册器、模型路由、沙箱、审批） | 不管理，只读 |
| agent preset | 单会话贡献（工具、persona、prompt section） | 不管理（需要时按官方约定在 `~/.dsh/.agent-presets/` 下开发） |

- 动态插件（`cordis_define`）= 会话内原型，进程结束即消失；**正式分发必须走 npm 包**。
- 永远不改 deployment 内置的预设与宿主核心；预设/插件不得放松自身沙箱边界。
- 预设里发布服务必须 isolate realm；bundle 行无此问题，但 patch 不能做越权的事。

## 2. 标准插件结构

```
plugins/<npm包名>/
├── package.json       # 第 3 节契约
├── cordis.patch.yml   # 第 4 节规范
├── lib/index.js       # Host 端入口（必须有；纯 UI 插件可为最小 apply）
├── lib/client.js      # Web 端入口（声明 dsh.client 时必须有）
├── README.md          # 用途、安装（三通道）、权限清单、副作用、Compatibility 表
├── LICENSE            # MIT
└── DESIGN.md          # 复杂插件写：设计、依赖策略选择理由
```

- 多模块拆 `lib/`，`index.js` 保持薄入口。
- 静态资源放子目录（如 `fonts/`）并进 `files` 白名单。

## 3. package.json 契约

| 字段 | 要求 |
|---|---|
| `name` | `@cxxl/dsh-<kebab>` |
| `version` | semver；发布前 bump；仓库版本必须与 npm 上一致 |
| `description` | 一句话用途；语言全仓库统一 |
| `type` / `main` | `"module"` / `"lib/index.js"` |
| `exports` | 必含 `.`、`./cordis.patch.yml`、`./package.json`；有 client 时必含 `./client`（声明 dsh.client 后为硬要求，缺失直接加载失败） |
| `files` | 运行时全部文件白名单；`prepublishOnly` 机械校验 |
| `engines` | 默认 `"^22.19.0 \|\| >=24.0.0"`；插件真实需要更高下限时（如 node:sqlite ≥22.5）写真实下限并在 README 说明理由。该字段是约定口径，运行时不被强制 |
| `peerDependencies` | 按第 3.1 节三形态择一，禁止混用 |
| `dsh.bundle.patch` | `"./cordis.patch.yml"` |
| `dsh.client` | `{ "platform": "web", "inject": [] }`。`platform` 只认 `'web'`；`inject` 是信息性包名依赖边（不排序、不参与激活）；`external` 仅基础设施/transport/生成装配可用，feature 插件禁止互相 external；`immediately: true` 仅限 stage-one 预取基建行 |
| `scripts.prepublishOnly` | `node ../../scripts/check-publish-files.mjs` |
| `publishConfig.access` | `"public"` |
| `keywords` / `license` / `repository` | 含 `dsh-plugin`；MIT；repository 带 `directory` |

### 3.1 依赖策略（三形态，选一个写进 DESIGN.md/README）

1. **peer 复用形态**：需要 harness 包的运行时值（如 `@deepseek-ai/dsh-tools` 的 `defineTool`）→ 把 cordis / dsh-tools / dsh-llm 声明为 `peerDependencies`。profile 解析会把 peer 也纳入模块闭包且不自动安装，因此 peer 会解析到 harness 自带实例而不是新装一份。peer 版本范围必须覆盖当前 harness 自带的版本（当前：cordis 4.0.2、schemastery 3.18.2）。进程内出现两份 cordis/dsh-tools 会因 Symbol key 不匹配静默 crash；peer 警告属预期，不要为消除警告写 dependencies。
2. **零 harness import 形态**：只用 Node 内置模块 + `ctx` 注入服务，不 import 任何 harness 包。省心、天然规避双实例，代价是拿不到类型级 API。
3. **Config 形态**：只需 schemastery 声明 Config → 仅 `peerDependencies: @deepseek-ai/schemastery`，版本 = 当前 harness 自带版本（3.18.2）。

官方 rc 包可能缺 peer 装不上：依赖前在干净 profile 实测安装。

## 4. cordis.patch.yml 规范

- 顶层必须是 YAML **数组**，非数组直接报错。
- `insert` 行列表：带 `id` 的 insert 追加到目标 group 行；不带 id 的 insert 追加到根列表。非 insert 的 patch **必须带 `id`**，`name` 不匹配会 warn+skip；命中后其余字段**整行覆盖**目标行（last write winning per row）。
- 同一次 update 内**重复 id 抛错**；缺 id 会自动生成随机 id——显式 id 是可控性的关键。
- `!!js` 表达式只允许出现在行的 `config` 与 `disabled` 字段；`id/name/inject/group` 等元数据必须字面量。

本仓库插件的标准形态：

```yaml
- insert:
    - id: <插件行id>      # profile 的 bundle 层内唯一，与包名一致即可
      name: <npm包名>
```

- 行级能力：`config`、`disabled`、`inject`。
- **坏 patch 能拖垮整个 DSH 启动**：id 唯一、不引用不存在的服务、发布前干净 profile 冒烟。
- 注释里的安装示例只准写三通道：`dsh plugin --profile <name> add <npm包名>` / `<tgz路径>` / `github:user/repo#sha`。**禁止出现本地目录 add**（第 8 节）。
- 不在 patch 里放松沙箱边界、不嵌入凭据。

## 5. Host 端契约（lib/index.js）

- **入口三形态**：函数 / 类 / `{apply}` 对象均可；共享元数据 `Plugin.Base`：`name?`、`Config?`、`inject?`、`provide?`、`intercept?`。函数形态签名 `(ctx, config)`，对象形态 `apply(ctx, config)`。
- `export const name`：**短名、不带 scope**。
- `export const inject = [...]`：硬依赖服务清单。可选用 `ctx.get(name)` + `undefined` 检查；未声明的 `ctx.x` 直取会被 Guard 拒绝。**服务名以 harness 生成式 Cordis API 参考为准**（`docs\subsystems\core.md` 的 Cordis API 区，或各包 README 的 `Requires:` 行），运行时用 `cordis_inspect` 核对。
- `export const Config = z.object({...})`（可选）：schemastery 声明 + `.default()/.description()`；有 Config 时 `apply` 收到校验后的配置。
- **副作用纪律**：所有注册走 `ctx.effect(() => { ...; return disposer }, '标签')` 或 `ctx.on()`；禁止模块级副作用。Effect 的 disposer 按注册逆序执行、可异步。
- **waterfall 监听**：默认必须调用并返回 `next()`；唯一豁免是**本监听器有意拥有决策**（policy listener 可以 return 而不 next，短路整条链）——只做注解/观察的监听器必须委托。
- **工具**（`@deepseek-ai/dsh-tools` 的 `defineTool`）：
  - `description` 写清 做什么 / 何时用 / 何时别用 / 副作用 / 防错提示——描述即接口；
  - 禁用 `{{...}}`（破坏 code-mode 组装）；
  - 错误信息必须带工具名与修复指引（防死循环）；
  - `parameters` / `output.schema` 是模型可见接口，改动即契约变更。
- systemPrompt 注入：`ctx.systemPrompt.section({ name, order, text })`。
- 动态插件与 npm 包是两套系统：`cordis_define` 只做会话内原型，正式分发必须 npm 包 + bundle patch。

## 6. Client 端契约（lib/client.js）

- **声明**：`dsh.client = { platform: 'web', inject: [...] }`，且必须有 `./client` 导出（缺失直接加载失败）。`inject` 只是信息性包名依赖边（preflight 显示、HMR diff），激活顺序由 Cordis fiber 的 service inject 决定。
- **`dsh.client.external` 不是 feature 插件的依赖机制**：只有基础设施/transport/生成装配可以声明非基线模块请求；feature 插件之间禁止互相 external。
- **模块基线（无需声明）**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`。基线之外的 require 必须声明或自带。
- **入口形态**：`window.__ModuleLoader__.load({ id, factory: (require) => {...} })`；工厂内 require 只认基线模块。
- **UI 组合唯一通道是 Slot**：`ctx.slots.register({ name, children?, store?, inject? }, Component)`，等待声明用 `ctx.slots.inject(name, () => slots.register(...))`。**禁止** `document.querySelector*` 猜选择器、禁止 `document.body`/`window` 全局摆弄、禁止模块级 UI 副作用。
- **样式**：全局主题走 theme tokens（`Theme.listTokens` + theme Service）；插件私有样式走 `styles.insert(css)`。禁止硬编码产品选择器/构建哈希类名。
- **文案**：产品可见文案进 locale 字典；内部匹配用判别式/稳定 id，**禁止按本地化文本匹配**。
- **client↔host 通道**：动态插件的官方通道是 `harness.handle` + `host.call`（仅 `cordis_define` 沙箱存在）。**npm 插件的官方通道是 `ctx.webServer.register` 注册自定义同源路由 + 客户端 fetch**——`webServer` 是公开 Service（exact/prefix 协议，重复路由抛错），官方明示 feature 插件自持路由。`api-remotes` 的 Remote 路由是构建期装配，第三方运行时无注册面；`harness.handle`/`host.call` 对 npm bundle 插件不可用。安全边界见第 7 节。

## 7. 权限、安全与兼容性

- README 必须含**权限清单与副作用**（如 `filesystem:read`）；出站网络要写明端点。
- **自建 webServer 路由安全**：webServer 路由无鉴权、无 Origin 策略，属插件自管边界——必须校验入参、限定可访问路径（只读路由只读文件、写路由校验输入大小与合法性），不得把路由做成任意文件/命令代理。
- 绝不嵌入凭据；凭据走 credentials 服务或环境变量。
- 不改 DSH 自带预设与宿主核心；不放松沙箱。
- README 写 Compatibility 表：`Harness 0.1.2-alpha.5 / Node ^22.19 || >=24`。rc 期 API 变动快，发布必须标注。

## 8. 发布流程

1. bump `version`（semver）；发布成功后打 git tag（如 `@cxxl/dsh-<名>@<版本>`），确保仓库版本 = npm 版本。
2. `npm publish --access public`；`prepublishOnly` 自动跑 `check-publish-files.mjs`。
3. **干净 profile 冒烟**：临时 `DSH_HOME` 下 `dsh plugin --profile <临时名> add <tgz>` → 重启 → 自测 → `remove`。
4. 三通道至少实测一种：npm 名 / `github:user/repo#sha` / tarball。
5. **禁止本地目录 add**：`dsh plugin add` 把参数原样转发给 pnpm，本地目录走 pnpm link（Windows 上即 junction）→ 源目录改名/移动后成悬空链接，boot 解析 bundle 报 `cannot resolve profile bundle`、整机起不来（本仓库实战踩过）。DSH 自己在 boot 期也会把 bundle 依赖以 junction 链进 profile node_modules，同类陷阱。清理悬空链接用 `cmd /c rmdir <链接路径>`（只删链接，不碰目标）。
6. 装完**必须重启**：bundle 层只在 boot 时读取，热重载只覆盖用户 patch 层，不含 bundle 层。git 通道注意 pnpm≥10 的 allowBuilds prepare 阻断。

## 9. Windows 注意事项

- Node ≥22.19；koffi 锁 3.1.2（3.1.3/3.1.4 Windows 预编译损坏）。
- 常见雷：中文路径截断家族（readUtf16 U+XX00）、pwsh 假死、端口 3080 落在 Hyper-V 保留区间、大小写不敏感路径冲突、ReplaceFileW EIO。写路径/编码逻辑不要假设 POSIX，测试覆盖中文与空格路径。
- `dsh plugin add github:` 部分版本只加依赖不 append bundles：发布前实测。

## 10. 文档维护规则（本仓库纪律）

| 文档 | 职责 |
|---|---|
| 根 `AGENTS.md` | 会话入口 + 铁律 |
| 本文件 | **契约（应然）**，改动契约时同一 commit 更新 |
| `docs/AUDIT.md` | **现状偏差（实然）**与整改路线；修完一条勾一条并记 commit |
| `README.md` | 仓库总览（含目录结构表） |

- 改代码触及契约 → 先更新本文件；修完 AUDIT 条目 → 勾选该条。
- 目录结构变更 → 同步更新 `README.md` 的「目录结构」表。
