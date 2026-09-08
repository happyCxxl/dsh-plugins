# dsh-sqlite 设计文档

> 状态：v1 设计定稿（代码未动工）。本文档是开发前的最终规格与决策记录。

## 1. 背景与目标

DSH 官方存储栈（`@deepseek-ai/dsh-storage-sqlite`）是给 DSH 内部服务使用的键值（KV）后端，模型无法使用；社区 1804 个插件仓库中数据库类仅 14 个。agent 目前跨会话"记录、统计、查询"只能靠写普通文件（md/json），无法结构化查询、聚合与安全并发。

**目标**：给 DSH 的 agent 提供可建表、可查询的持久关系型 SQL 能力——跨会话、跨工作区、多会话并发安全、跨机器可同步，并为后续"跨会话通信"插件（v2）提供存储底座。

## 2. 技术路线决策（依据侦察事实）

| 决策 | 依据 |
|---|---|
| 直接按 npm 包开发，不做会话内动态原型 | 动态插件受限环境无 require / node:sqlite / fs，无法开数据库 |
| 引擎用 Node 内置 `node:sqlite` | 本机 Node v22.18 已支持（实验性警告可忽略）；零原生依赖，跨机器免 node-gyp 编译 |
| 不复用官方 storage 中枢 | 其 SQLite 后端为 KV 形态，不支持建表 / JOIN / 聚合 |
| 开发循环用本地目录安装 | `dsh plugin add` 底层为 pnpm add，支持目录 / 本地包，无需先发布 npm |
| 跨机器同步走"导出 SQL 文本"而非同步 .db | .db 为二进制：进 git 无法 diff、冲突不可合并、每次改动整文件膨胀；SQL 文本可提交、可审查、兼作备份 |

## 3. 功能规格 v1

五个模型工具（工具数少 = 省 prompt token）：

### sqlite_query（只读）
- 参数：`sql`（必填）、`db`（可选，默认 default）、`maxRows`（可选，默认 100，硬上限 500）
- 行为：仅允许 SELECT / WITH / EXPLAIN 及**固定只读 PRAGMA 白名单**；结果渲染为 Markdown 表格；超过 maxRows 截断并注明剩余行数
- 目的：读操作最高频；只读保底防误删；模型敢用

### sqlite_exec（写）
- 参数：`sql`（必填，可多语句）、`db`（可选）、`confirm`（可选布尔）
- 行为：CREATE / INSERT / UPDATE / DELETE / DROP / ALTER / REPLACE 等标准 DDL/DML；返回影响行数等执行信息
- 危险拦截：**DROP 语句、无 WHERE 的 DELETE / UPDATE、含 DROP 的 ALTER、VACUUM / REINDEX 必须显式携带 `confirm: true`**，否则拒绝执行并提示
- 目的：一个工具覆盖全部写操作，减少模型记忆负担

### sqlite_tables（发现性）
- 参数：`db`（可选）
- 行为：列出数据库文件、各表名、列定义、行数；附 `PRAGMA quick_check` 完整性检查结果
- 目的：模型不知道库内容时会盲查 sqlite_master，专用工具省 token、少试错

### sqlite_export（跨机器同步 / 备份）
- 参数：`db`（可选）、`tables?`（可选，表名数组，省略 = 全部表）、`to`（可选）
- 行为：把选定表（或全部）导出为 SQL 文本（DROP TABLE IF EXISTS + CREATE + INSERT 形式）；默认写到 `~/.dsh/data/<name>.sql`（本地备份），`to` 可指向仓库内路径（如 `<repo>/data/agent.sql`）供 git 提交
- 返回：目标文件路径、导出的表数与行数
- 目的：跨机器同步 + 手动备份；支持按表粒度选择同步范围

### sqlite_import（跨机器同步 / 恢复）
- 参数：`db`（可选）、`from`（可选）
- 行为：读取 SQL dump 并执行；**替换 dump 中包含的表，库中其余表原样保留**（全量 dump = 全量恢复；部分 dump = 部分同步）
- 目的：换机器 / 拉取仓库后恢复数据

> 同步工具调用方式：**全手动**——由用户决定、或用户让模型执行、或模型在合适场景主动提议；插件不做任何自动导出/导入。

## 4. 写操作风险与对策

| 风险 | 问题场景 | v1 解决方案 |
|---|---|---|
| 误删/误改数据 | 模型 DROP 表、无 WHERE 全表 DELETE/UPDATE | confirm:true 拦截（DROP、无 WHERE 的 DELETE/UPDATE、含 DROP 的 ALTER、VACUUM/REINDEX）；手动 export 即快照 |
| 语句越界（安全） | ATTACH 挂载任意文件、PRAGMA 改库配置、LOAD_EXTENSION | exec 仅允许标准 DDL/DML；**ATTACH / DETACH / LOAD_EXTENSION / 全部 PRAGMA 一律拒绝** |
| 只读路径被绕过 | PRAGMA 赋值经 query 通道改库 | query 仅允许 SELECT/WITH/EXPLAIN 及固定只读 PRAGMA 白名单（table_info / table_list / index_list / index_info / foreign_key_list / quick_check / integrity_check / freelist_count / page_count） |
| 并发写冲突 | 多会话同时写，SQLite 单写者 | WAL + busy_timeout 3000ms；每条 exec 为短事务自动提交；超时返回"库忙，稍后重试" |
| 巨量写入卡死 | 一次 INSERT 数十万行，工具长时间不返回 | 单次 exec SQL 长度上限 64KB；工具描述提示大批量分批写入（≤1000 行/批） |
| schema 变更损坏数据 | ALTER 改列/删列破坏既有数据与依赖 | 危险 ALTER 需 confirm；工具描述警示"改表前先 sqlite_export 备份" |
| 库文件损坏 | 崩溃/断电写一半 | WAL + journal 默认开启（大幅降低概率）；sqlite_tables 附 quick_check；export 即恢复点 |
| 磁盘占用只增不减 | 删数据后 .db 文件不缩小 | VACUUM 可用但需 confirm:true；文档说明 |
| 部分导出破坏引用 | 外键跨表，只导出子表缺父表 | 文档警示：部分导出前确认表间引用关系 |
| 类型直觉陷阱 | SQLite 动态类型，值与列类型不符 | README 注意事项：SQLite 类型亲和性说明 |

## 5. 工具设计原则（模型接口设计）

> 工具是给模型的 API：模型只通过名称、描述、参数 schema 认识它，接口质量决定使用质量。参考 DSH 官方工具（如 `pwsh`）的描述范本：信息密度高、含"不要…视为…"式防错句式。

### A. 接口层（模型怎么认识工具）

| # | 注意什么 | 怎么解决 | 本插件落法 |
|---|---|---|---|
| 1 | 描述是模型唯一的使用手册——它只读 name/description/parameters，看不到你的代码 | 描述写清五要素：做什么、何时用、何时**别**用、副作用、防错提示 | sqlite_exec 描述含危险语句规则与 confirm 用法；query 描述写"只读，勿用于修改"；**所有描述禁用 `{{...}}`**（会破坏 code-mode 组装，见 `dsh-plugin-dev-notes.md` C10） |
| 2 | 命名可预测 | 前缀_动作模式，动词清晰、无缩写歧义 | `sqlite_query / exec / tables / export / import`，符合生态惯例 |
| 3 | 参数过多/过宽 | 必填最小化（仅 `sql`）；默认值友好；用 JSON Schema 收窄取值而非自由文本 | db 名 `pattern: [a-zA-Z0-9_-]{1,64}`；maxRows `maximum: 500` |
| 4 | schema 即契约 | 发布后改参数名/语义 = 破坏性变更（模型已按旧习惯调用）；加可选参数安全，改语义发大版本 | 本文档定稿 = 接口契约冻结 |

### B. 行为层（调用后的交互质量）

| # | 注意什么 | 怎么解决 | 本插件落法 |
|---|---|---|---|
| 5 | 错误信息是给模型的反馈信号——模型靠它自我纠正下一步 | 错误必须可行动、明确、防呆 | "该语句是危险操作，请带 confirm:true 重试"；"库忙（busy_timeout 3000ms 超时），请稍后重试" |
| 6 | 成功返回要有信息量 | 返回影响行数、截断提示（"还有 N 行未显示"） | 所有工具返回结构化文本结果 |
| 7 | 输出稳定 + 最坏情况有界 | 格式稳定（模型会形成调用模式）；行数/长度上限 | Markdown 表格；maxRows 500；SQL ≤ 64KB |
| 8 | 幂等/可重试（模型可能重复调用） | 教模型写防御性 SQL | 描述建议 `CREATE TABLE IF NOT EXISTS`、`INSERT OR REPLACE`；exec 支持多语句 |
| 9 | 可中断 | 尊重取消信号；长操作不进默认路径 | VACUUM 在 confirm 名单 = 天然缓冲；快语句短事务 |

### C. 安全层

| # | 注意什么 | 怎么解决 | 本插件落法 |
|---|---|---|---|
| 10 | 工具面越大，误用面越大 | 单一职责 + 读写分离 + 边界写进描述 | query/exec/tables 分工；描述明示"ATTACH/PRAGMA 被拒绝"——模型知道边界就不瞎试 |

### D. 成本与生命周期

| # | 注意什么 | 怎么解决 | 本插件落法 |
|---|---|---|---|
| 11 | 每个工具的 name+描述+schema 每回合都发给模型（永久占上下文） | 工具少而精；描述信息密度高但不冗长 | 5 个为上限，不再加 |
| 12 | 注册必须随生命周期回收 | 注册属于插件 Fiber，disposer 随 stop/update 自动移除；不留在模块顶层 | 用 `ctx.tools.register` 返回的 disposer；开发前用 `Tool.listTools` 查重避免撞名 |

> 核心结论：工具设计的关键不是"功能全"，而是"模型在正确的时间、以正确的方式、拿得到可行动的反馈"——描述、约束、错误信息三件事比 SQL 引擎本身更决定插件好不好用。

## 6. 存储设计

- 位置：`~/.dsh/data/agent.db`（默认库）；命名库 `~/.dsh/data/<name>.db`
- 库名安全：`name` 仅允许 `[a-zA-Z0-9_-]`，防路径穿越
- 路径解析：用 `os.homedir()` 解析 `~/.dsh`，防中文用户名/空格路径（Windows 重灾区，见 `dsh-plugin-dev-notes.md` D14）
- 表的位置：表是 .db 文件内部的逻辑结构，不占独立文件；命名库 = 独立的 .db 文件（隔离用途）
- 为什么放 `~/.dsh/data/`：跨会话固定可达；不污染 git/工作区；插件升级重装不丢数据；避开 DSH 自有的 `storages/` 目录边界
- 并发：WAL 模式 + busy_timeout 3000ms，多会话同时读写同一库
- 生命周期：首次工具调用时懒打开；插件停用/卸载时关闭连接；`data/` 目录由插件首次运行时创建
- 输出限流：默认 100 行、硬上限 500，防大结果撑爆上下文

### 跨机器同步工作流

```
机器A：干完活 → AI 执行 sqlite_export(to: "<仓库>/data/agent.sql") → git commit & push
机器B：拉取仓库 → AI 执行 sqlite_import(from: "<仓库>/data/agent.sql") → 数据就位，继续干活
```

- 语义：导入 = 替换 dump 中包含的表，其余表保留（部分同步 / 全量恢复两相宜）
- 每台机器各自一份库；同步节奏与范围（表粒度）由用户掌控

## 7. 工程结构

```
plugins/dsh-sqlite/
├── package.json       # dsh.bundle.patch → cordis.patch.yml；engines: node >= 22.5
├── cordis.patch.yml   # - insert: [{ id: dsh-sqlite, name: '@cxxl/dsh-sqlite' }]
├── lib/index.js       # apply(ctx)：注册五个工具 + 挂载自测（DSH_PLUGIN_SELFTEST=1）
├── lib/tools.js       # 五个工具定义（纯对象，不依赖 DSH 包，可独立冒烟测试）
├── lib/engine.js      # 所有 node:sqlite 调用隔离于此（实验性 API，将来可整体替换 better-sqlite3）
├── scripts/smoke.mjs  # 本地冒烟测试（files 白名单外，不随包发布）
└── README.md          # 安装/使用说明
```

- 依赖策略：cordis 等 harness 自带包声明为 **peerDependencies**，防止进程内双副本 Symbol 分裂崩溃（见 `dsh-plugin-dev-notes.md` B5）

## 8. 装载与调用机制

- 安装：`dsh plugin --profile <name> add @cxxl/dsh-sqlite`（npm 发布后）；patch 行插入 profile 组合层，重启后生效；该 profile 下会话的工具清单获得五个工具（以实测为准）
- 调用：模型按需自主调用（函数调用机制），**非后台自动存档**——没有对话就没有动作
- 可靠性杠杆：工具描述写明使用时机（弱杠杆）；将来如需"确定必存"，可在预设/系统提示词注入显式规则（强杠杆，v1 不做）

## 9. 明确不做（v1）

- client UI 面板（表浏览）
- 提示词自动注入 schema
- 自动导出/自动备份（同步与备份均为手动）
- 权限审批流程

## 10. 路线图

- **v1**：通用 SQL 工具 + 跨机器同步（已发布 0.1.1）
- **v1.1**：表浏览面板——人类只读浏览器（已发布 0.2.0；设计见第 13 节）
- **v1.2**：稳定触发规则注入（已实现待验证，将发 0.3.0；设计见第 14 节）
- **v2**：跨会话协作感知——盘点注入 + 库内通知 + 新库广播 + meta 描述约定（并入本插件，设计见第 15 节）

## 11. 开发与发布

1. 按第 7 节结构实现
2. 本地安装：`dsh plugin --profile web add <本地目录>`，重启后验证
3. 测试点：五工具正常注册、危险语句拦截、语句黑白名单拦截、并发写冲突、部分导出/导入、导出→清库→导入往返一致、干净 DSH_HOME profile 冒烟（安装→启动→卸载，见 `dsh-plugin-dev-notes.md` D13）
4. 发布：在 `plugins/dsh-sqlite` 目录执行 `npm publish --access public`

## 12. 决策记录

- 数据库位置：全局 `~/.dsh/data` + 命名库（否决工作区内方案：二进制库进 git 不可合并）
- 工具集：query + exec + tables + export + import 共五个（5 个为上限，不再扩）
- 写保护：危险操作（DROP / 无 WHERE 的 DELETE、UPDATE / 含 DROP 的 ALTER / VACUUM / REINDEX）需显式 `confirm: true`
- 语句边界：exec 仅标准 DDL/DML，禁 ATTACH / DETACH / LOAD_EXTENSION / 全部 PRAGMA；query 仅 SELECT / WITH / EXPLAIN + 只读 PRAGMA 白名单
- 写性能防线：单次 SQL ≤ 64KB、分批写入提示、busy_timeout 3000ms
- 跨机器同步：**入 v1**；方案 = 导出 SQL 文本（本地默认路径 + `to` 指向仓库）；export 支持 `tables` 表粒度；导入 = 替换 dump 中的表、其余保留；**不做自动导出**（全手动：用户决定 / 用户让模型执行 / 模型按场景提议）
- 工具设计原则：成文于第 5 节——描述五要素、错误信息可行动、schema 即契约、5 工具上限、注册随 Fiber 回收
- 调研修正（见 `dsh-plugin-dev-notes.md`）：依赖声明 peerDependencies（防双副本 Symbol 分裂）；工具描述禁 `{{...}}`；路径解析用 os.homedir()（防中文/空格）；发布前干净 profile 冒烟测试
- 引擎：node:sqlite（实验性，隔离在 engine.js，可随时整体替换）
- 提交邮箱：`cl152556563887@gmail.com`（本仓库级 git 身份，不影响公司 GitLab 配置）

## 13. v1.1 设计：表浏览面板（人类只读浏览器）

> 状态：已发布 0.2.0（冒烟 23 项全绿、面板验证通过）。目标：人类不用通过模型转述，直接在设置页浏览数据库。

### 挂载点（依据 Slot 实查）

- `settings.section`（list，root scope）：注册协议 `{id, order, label}`，replaceRisk=none——官方"完整内容区"推荐位，与 studio/mgr 等插件一致
- 注册 id：`dsh-sqlite-browser`；label：`SQLite 数据库`

### 功能范围

- 库选择：默认库 agent.db + 各命名库（`~/.dsh/data/*.db`）
- 表列表：表名、列数、行数；quick_check 完整性状态
- 表详情：列定义（名/类型/PK/NOT NULL）+ 数据预览（前 50 行，表格渲染）
- 刷新按钮
- **明确不做**：面板上的任何写操作（人类编辑/删行）——写仍由模型工具完成，安全面最小

### 架构

- **Host**（lib/index.js）：3 个只读 HTTP 路由（`webServer.register`，`{kind:'exact', path, handler(req,res)}`，与页面同源；依据 dsh-host-webserver 实查的契约）：
  - `GET /dsh-sqlite-api/list-dbs` → 库文件清单（复用 `engine.listDbFiles`）
  - `GET /dsh-sqlite-api/tables?db=` → 指定库表列表 + 结构（复用 `engine.listTables`）
  - `GET /dsh-sqlite-api/preview?db=&table=` → 指定表前 50 行（engine 新增 `tablePreview`：只读 SELECT + LIMIT）
- **Client**（lib/client.js）：`window.__ModuleLoader__.load` 工厂模式（question-nav 范本，无需构建工具）；注册 settings.section 页面；`React.createElement` 纯 JS；`fetch` 拉数据；useEffect + 刷新按钮
- **package.json**：`dsh.client: { platform: "web", inject: [] }`；exports 增 `./client` → `lib/client.js`；files 白名单增 `lib/client.js`；版本 **0.2.0**
- **engine**：新增 `tablePreview(dbName, table, limit)`（硬上限 50 行，只读，JSON 安全输出）

### 安全边界

- 面板 RPC 全部只读（无写路径）；预览硬限 50 行；db 名走 `DB_NAME_RE`、表名走白名单校验
- 面板不暴露任何写语句执行能力

### 开发循环与测试

- 迭代循环：tarball → `dsh plugin --profile web remove` + `add <tarball>` → 重启 DSH → 页面验证（bundle 层 boot 时读取，约 2 分钟/轮，代码尽量一次写对）
- 测试点：设置页出现可打开；库/表/预览数据正确；quick_check 显示；空库/无表空态不报错；刷新正常；只读 RPC 冒烟（node 脚本）
- 发布：npm 0.2.0（本地交互式流程）

### 决策记录（v1.1）

- 面板位置：独立设置页 `settings.section`（否决 shell.overlay 抽屉：工作量翻倍）
- 范围：纯只读浏览器（人类写操作不做）
- 预览行数硬上限 50；RPC 三方法；版本 0.2.0
- 通信机制修正：宿主-页面用 `webServer` HTTP 路由 + fetch（否决 typert remote：zod+双端镜像过重）；webServer 声明为 inject 硬依赖（首次实现用 ctx.get 静默跳过导致路由 404，已修复）

## 14. v1.2 设计：稳定触发规则注入

> 状态：设计定稿（代码未动工）。目标：把"持久化场景 → 用 sqlite_* 工具"的触发率推到接近确定。

### 调研依据（官方源码 + 社区头部插件，详见本会话调研）

| 借鉴点 | 出处 | 采纳 |
|---|---|---|
| 规则分层注入（常驻短规则 / 条件长规则 / 用户层规则） | 官方 `dsh-plan-mode`（config.section 注入整段规则并声明覆盖工具描述）、`dsh-persona`、`dsh-agent-instructions`（AGENTS.md 持久注入） | ✅ 核心机制 |
| 技能指针式按需加载（常驻一句话 + skill 全文按需） | 官方 cordis preset（persona 中 "Load the X skill before…"） | 备选，v1.2 不做 |
| 观察-提醒-不干预（重复调用升级提醒，绝不否决） | 官方 `dsh-repeat-tool-reminder` | ❌ 我们无死循环痛点（confirm 拦截已兜底），范式记档 |
| 工具面收缩 / 排序（每请求只给相关工具，schema token -80~90%） | 社区 `dsh-tool-folder`、`dsh-tool-router`（官方 seam：`system-prompt/assemble` waterfall） | ❌ 我们仅 5 个工具，收缩无意义 |
| 场景 B（隐式需要）接受噪声、场景 C（必须保证）属用户层规则 | 官方无插件级解法（AGENTS.md/persona 属用户配置） | 接受，不越界 |

### 机制

- 注册一个 `systemPrompt.section`（官方 `dsh-plan-mode` 同款 API）：
  - `name: 'dsh-sqlite:persistence-rule'`（唯一名，避免被预设同名遮蔽）
  - `order: 1000`（排在 persona / 模式规则之后，靠近提示词尾部——位置越靠后模型注意力越强）
  - 文本 1-2 行、**禁含 `{{...}}`**（section 文本经过严格变量插值，异常引用会抛错；本插件描述禁用模板字符的原则同样适用）
- 服务依赖：`systemPrompt` 与 `webServer` 一样声明为 **inject 硬依赖**（防止挂载时序早于服务提供 → 静默失效的坑重演）

### 规则文本（草案）

```
持久化规则：当用户要求记住、记录、跟踪、保存结构化数据，或表达"以后还要查/对比/统计"的意图时，
使用 sqlite_exec（写）与 sqlite_query（读）工具，不要用普通文本文件替代数据库；不确定库里有什么时先调 sqlite_tables。
```

- 成本：每回合约 +40 token；换 A 类场景（用户明确表达）触发率趋近确定
- 不覆盖模型判断：仍属"规则在场"，模型最终决定（与官方 plan-mode 的覆盖式声明不同——我们不声明覆盖，只增强）

### 验证方法

- 新会话连续 3-5 种措辞："记住 X"、"记录 X"、"以后我要对比"、"跟踪 X 的价格" → 观察是否自动调用 sqlite_exec（不点名工具）
- 对照：注入前该场景的基线命中率
- 回归：确认五个工具功能与面板不受影响；确认无 `{{}}` 相关装配错误（section 注册时抛错会导致挂载失败，冒烟需覆盖）

### 版本与发布

- 版本 **0.3.0**（与 v1.1 的 0.2.0 分离，或随 0.2.0 一起发——由发布时机定）
- 发布流程同前（本地交互式 npm publish）

### 决策记录（v1.2）

- 采纳官方 `systemPrompt.section` 常驻短规则注入（plan-mode 先例）；不采纳工具面收缩/提醒干预（无对应痛点）
- 场景 B 接受噪声、场景 C 留给用户层（AGENTS.md/preset），插件不越界
- 技能指针式加载列为备选，v1.2 暂不做

## 15. v2 设计：跨会话协作感知（共享记忆的最小原语）

> 状态：设计定稿（代码未动工）。版本规划：与 v1.2 合并发 0.3.0。

### 定位与设计哲学

- **场景**：一个工作区多会话并行同一任务——会话彼此不知对方做了什么、方向易跑偏（最痛点）
- **哲学**：插件提供**能力**，模型提供**智能**——不做死板"应用"（board 表/kind/topic 等固定语义会限制模型智能），只做最小原语：带"变化感知"的共享记忆
- **分层保证稳定性**：
  - 稳定层（机制确定）：盘点注入、库内通知、新库广播、送达确认循环
  - 约定层（规则在场）：命名约定、复用优先、先发现后使用、主动写决策、维护 meta
  - 灵活层（模型智能）：表结构、协议、内容质量——模型按场景自由设计
  - 兜底层（人）：面板全量可见

### 核心机制

| 机制 | 触发 | 行为 | 强度 |
|---|---|---|---|
| 盘点注入 | 会话首次 pre-step | 注入"协作库清单"（含 meta 描述与表说明）+ 协作约定 | 机制确定 |
| 库内按域通知 | 每个 pre-step | 本会话游标落后的库 → 注入"「X.db」自你上次查看后有 N 处变化" | 机制确定 |
| 新库广播 | 检测到新 .db 文件 | 通知所有参与协作的会话"新库出现（带描述），如重复请合并" | 机制确定 |
| 送达确认循环 | post-execute | exec=该库计数+1 且本会话游标推进；query/tables=**查询即确认**推进游标；未确认则下回合重复提醒 | 机制确定 |
| meta 描述约定 | 模型建库时 | 库内 meta 表（label / description / table:<名>）——数据自带说明书（工具描述原则推广到数据） | 规则 |
| 默认库不提醒 | — | agent.db = 个人数据区，不参与协作通知 | 约定 |

### 实现要点

- engine.js 增：`readDbMeta(dbName)`（读 meta 表 key/value，无则空表）
- index.js 增（约 120 行）：
  - `tools/post-execute` 监听：sqlite_exec 成功 → 该库全局计数 +1、本会话游标推进；sqlite_query / sqlite_tables 成功 → 本会话游标推进（查询即确认）；检测新 .db 文件 → 新库事件
  - `agent/pre-step` 监听：首次 → 盘点注入；非首次 → 游标落后库的增量提醒 + 新库广播
  - 游标：`WeakMap<Agent, Map<db, count>>`（按会话键控，官方 repeat-tool-reminder 同款先例；会话重启 = 重新提醒，幂等无害）
- **实现前必须查证**：`agent/pre-step`、`tools/post-execute` 的精确 Event 契约（listener 签名、注入方式——官方 agent-instructions 的做法是放进 agent 的 next-step inbox）
- 规则文本（v1.2 段扩展，使能式）：
  - 协作数据放命名库（任务名，kebab-case）；不同任务不同库互不干扰
  - 新建协作库后先建 meta 表写 label / description 与表说明
  - 动手实现、做接口或方案决策前，先查协作库对齐；完成影响他人的决策后写入协作库
  - 复用已有协作库与表（清单在开场自动呈现）；默认库 agent.db 不用于协作

### 使用场景（双会话并行"登录改造"，摘要）

- T0 会话 A 开工 → 盘点注入（"无协作库"）→ A 建 `login-refactor` 库 + meta 描述 + 自设计表
- T1 会话 B 开工 → 盘点注入（清单显示 login-refactor 及其描述）→ B 直接复用，未另建库
- T2 A 定接口 → 写 decision → 计数 +1
- T3 B 下一回合 → 注入"login-refactor 有 1 处变化" → B 查询对齐 → 游标推进（查询即确认）→ 按约定实现，不跑偏
- T4 B 误建新库 → 新库广播（带描述）→ A 发现重复 → 汇报/合并——静默分裂被可见化
- T5 面板随时可见全部库表——人兜底；任务完成 export 同步

### 明确不做（v2）

- board/信箱固定表结构、kind/topic 枚举、订阅/join 工具、会话自动寻址、后台自动唤醒（timer）、常驻 context 全量注入、工作区追踪（库亲和天然覆盖）、消息删除工具（复用 sqlite_exec + confirm）

### 验证计划

- node 冒烟：计数/游标/送达确认逻辑（mock exec 事件）、readDbMeta、新库检测
- 真机：双会话同命名库并行 → A 写决策 → B 收提醒 → 查询对齐 → A 收 B 进度提醒；B 误建新库 → A 收广播
- 回归：五工具、面板、规则注入不受影响

### 决策记录（v2）

- 否决"信箱/board 固定语义"（死板限制模型智能）；采用"最小原语 + 分层保证"
- 通知按命名库隔离（库亲和 = 订阅关系，零声明）；默认库不提醒；新库创建 = 全局广播（罕见事件）
- 送达确认 = 查询即确认（游标由 query/tables 推进）；游标按会话键控
- 库表描述 = meta 约定表（工具描述原则推广到数据）；机制呈现、模型维护
- 零新工具；与 v1.2 合并发 0.3.0
