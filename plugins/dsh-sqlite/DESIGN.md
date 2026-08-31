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
├── cordis.patch.yml   # - insert: [{ id: dsh-sqlite, name: dsh-sqlite }]
├── lib/index.js       # apply(ctx)：懒打开引擎、注册五个工具
├── lib/engine.js      # 所有 node:sqlite 调用隔离于此（实验性 API，将来可整体替换 better-sqlite3）
└── README.md          # 安装/使用说明
```

- 依赖策略：cordis 等 harness 自带包声明为 **peerDependencies**，防止进程内双副本 Symbol 分裂崩溃（见 `dsh-plugin-dev-notes.md` B5）

## 8. 装载与调用机制

- 安装：`dsh plugin --profile <name> add dsh-sqlite`（npm 发布后）；patch 行插入 profile 组合层，重启后生效；该 profile 下会话的工具清单获得五个工具（以实测为准）
- 调用：模型按需自主调用（函数调用机制），**非后台自动存档**——没有对话就没有动作
- 可靠性杠杆：工具描述写明使用时机（弱杠杆）；将来如需"确定必存"，可在预设/系统提示词注入显式规则（强杠杆，v1 不做）

## 9. 明确不做（v1）

- client UI 面板（表浏览）
- 提示词自动注入 schema
- 自动导出/自动备份（同步与备份均为手动）
- 权限审批流程

## 10. 路线图

- **v1**：通用 SQL 工具 + 跨机器同步（本文档）
- **v1.1 候选**：表浏览面板、可选的提示词规则注入
- **v2（独立插件）**：跨会话信箱——消息表 + 收发工具 + 开场未读注入（半自主通信）

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
