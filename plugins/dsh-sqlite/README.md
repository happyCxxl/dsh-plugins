# dsh-sqlite

给 DeepSeek Harness 的 agent 提供持久关系型 SQL 能力的插件：跨会话、跨工作区、跨机器可同步的结构化数据存储。

## 安装

```powershell
dsh plugin --profile web add @cxxl/dsh-sqlite
# 装完重启一次（bundle 层只在启动时读取）
```

## 五个工具

| 工具 | 作用 |
|---|---|
| `sqlite_query` | 只读查询（SELECT / WITH / EXPLAIN / 只读 PRAGMA），结果 Markdown 表格，默认 100 行、上限 500 |
| `sqlite_exec` | 写操作（标准 DDL/DML，可多语句）；危险操作需 `confirm: true` |
| `sqlite_tables` | 列库文件、表结构、行数，附 quick_check 完整性检查 |
| `sqlite_export` | 导出为 SQL 文本（全部表或指定表），用于备份 / git 同步 |
| `sqlite_import` | 从 SQL 文本恢复（覆盖式：替换文件中包含的表，其余保留） |

## 数据位置

- 默认库：`~/.dsh/data/agent.db`；命名库：`~/.dsh/data/<库名>.db`（库名仅允许 `[a-zA-Z0-9_-]{1,64}`）
- WAL 模式 + busy_timeout 3000ms，多会话并发安全；首次调用才打开，插件停用自动关闭

## 安全边界

- `sqlite_exec` 拒绝：ATTACH / DETACH / LOAD_EXTENSION / 全部 PRAGMA
- 危险操作必须显式 `confirm: true`：DROP、无 WHERE 的 DELETE/UPDATE、含 DROP 的 ALTER、VACUUM/REINDEX
- 单次 SQL ≤ 64KB；大批量写入请分批（每批约 1000 行）

## 跨机器同步

```
机器A：sqlite_export(to: "<仓库>/data/agent.sql") → git commit & push
机器B：git pull → sqlite_import(from: "<仓库>/data/agent.sql")
```

## 已知限制（v1）

- SQL 字符串值内不要包含分号（语句按分号切分）
- 大表查询请用 WHERE/LIMIT 收窄；查询结果最多返回 500 行
- SQLite 动态类型：列声明类型是"亲和性建议"，值与类型不符时以存储为准
- `to` / `from` 建议使用绝对路径
- 部分导出时注意表间外键引用关系

## 引擎

Node 内置 `node:sqlite`（实验性，Node ≥ 22.5），零原生依赖；所有引擎调用隔离在 `lib/engine.js`，可整体替换为 better-sqlite3 而不动其余代码。
