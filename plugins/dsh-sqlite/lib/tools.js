// tools.js — 五个模型工具的定义（纯对象，不依赖 DSH 包，可独立冒烟测试）。
// 描述即接口：写清 做什么 / 何时用 / 何时别用 / 副作用 / 防错提示。
// 注意：描述文本禁用双花括号（会破坏 code-mode prompt 组装）。
import * as engine from './engine.js'

function renderText(_args, value) {
  return [{ type: 'text', text: value }]
}

function catchText(fn) {
  return async (args, exec) => {
    try {
      return await fn(args, exec)
    } catch (err) {
      return `错误：${(err && err.message) || String(err)}`
    }
  }
}

export const toolDefs = {
  query: {
    name: 'sqlite_query',
    description:
      '只读查询 DSH 持久 SQLite 数据库（agent 跨会话保存的结构化数据）。' +
      '何时用：需要读取、统计、核对之前保存的数据时。' +
      '仅支持 SELECT / WITH / EXPLAIN 及少量只读 PRAGMA（如 table_info）；任何修改请改用 sqlite_exec。' +
      '结果以 Markdown 表格返回，默认最多 100 行、硬上限 500，超出会截断并提示。' +
      'db 参数：默认 "default"（对应 ~/.dsh/data/agent.db），其它值对应 ~/.dsh/data/<值>.db。' +
      '注意：SQL 字符串值内不要包含分号；大表请用 WHERE/LIMIT 收窄查询。',
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '只读 SQL：SELECT / WITH / EXPLAIN / 只读 PRAGMA，可用分号分隔多条。',
      },
      db: {
        type: 'string',
        description: '库名，默认 "default"。命名库对应 ~/.dsh/data/<库名>.db。',
      },
      maxRows: {
        type: 'number',
        description: '返回行数上限：默认 100，最大 500。',
      },
    },
    output: { schema: { type: 'string' }, render: renderText },
    execute: catchText(async (args, exec) => {
      return engine.runQuery(args.sql, args.db, args.maxRows, exec && exec.signal)
    }),
  },

  exec: {
    name: 'sqlite_exec',
    description:
      '执行写操作 SQL（可多条，以分号分隔）并持久化到 DSH SQLite 数据库。' +
      '何时用：用户要求记录、跟踪、保存结构化数据，或需要建表/更新/删除时。' +
      '支持 CREATE/INSERT/UPDATE/DELETE/DROP/ALTER/REPLACE 及 BEGIN/COMMIT/ROLLBACK；ATTACH/DETACH/LOAD_EXTENSION/PRAGMA 一律拒绝。' +
      '危险操作必须显式传 confirm: true 才执行：DROP 语句、无 WHERE 的 DELETE/UPDATE、含 DROP 的 ALTER、VACUUM/REINDEX。' +
      '建议写防御性 SQL：CREATE TABLE IF NOT EXISTS、INSERT OR REPLACE。' +
      '大批量写入请分批（每批约 1000 行），单次 SQL 不超过 64KB。db 参数同 sqlite_query。',
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '写操作 SQL（标准 DDL/DML），可用分号分隔多条。',
      },
      db: {
        type: 'string',
        description: '库名，默认 "default"。',
      },
      confirm: {
        type: 'boolean',
        description: '危险操作（DROP / 无 WHERE 的 DELETE、UPDATE / 含 DROP 的 ALTER / VACUUM / REINDEX）必须为 true。',
      },
    },
    output: { schema: { type: 'string' }, render: renderText },
    execute: catchText(async (args, exec) => {
      const n = engine.runExec(args.sql, args.db, args.confirm, exec && exec.signal)
      return `执行成功：${n} 条语句已写入数据库。`
    }),
  },

  tables: {
    name: 'sqlite_tables',
    description:
      '列出 SQLite 数据库文件与表结构，了解库里已有什么。' +
      '返回 ~/.dsh/data/ 下的库文件清单、指定库（默认 default）中每张表的列定义与行数，并附完整性检查（quick_check）结果。' +
      '何时用：不确定库里有哪些表时，先调用本工具，再决定查询、写入或导出。',
    parameters: {
      db: {
        type: 'string',
        description: '库名，默认 "default"。',
      },
    },
    output: { schema: { type: 'string' }, render: renderText },
    execute: catchText(async (args, exec) => {
      const signal = exec && exec.signal
      const info = engine.listTables(args.db, signal)
      const files = engine.listDbFiles()
      const lines = []
      lines.push(`库文件（~/.dsh/data/）：${files.length === 0 ? '尚无' : files.map((f) => `${f.name}（${f.bytes} 字节）`).join('、')}`)
      lines.push('')
      lines.push(`数据库 "${info.dbName}" 的表：`)
      if (info.tables.length === 0) {
        lines.push('（暂无表，可用 sqlite_exec 建表）')
      }
      for (const t of info.tables) {
        const cols = t.columns.map((c) => `${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''}`).join(', ')
        lines.push(`- ${t.name}：${t.rowCount} 行；列：${cols || '（无列信息）'}`)
      }
      lines.push('')
      lines.push(`完整性检查（quick_check）：${info.quickCheck}`)
      return lines.join('\n')
    }),
  },

  export: {
    name: 'sqlite_export',
    description:
      '把数据库导出为 SQL 文本文件，用于跨机器同步或备份（手动操作）。' +
      '导出全部表，或用 tables 参数指定表名数组。' +
      '默认写到 ~/.dsh/data/<名>.sql；to 参数可指定其它路径（如仓库内路径以便 git 提交，建议绝对路径）。' +
      '返回目标路径、表数与行数。何时用：用户要求备份/同步，或你判断需要保存快照时。' +
      '注意：部分导出时确认表间外键引用关系。',
    parameters: {
      db: {
        type: 'string',
        description: '库名，默认 "default"。',
      },
      tables: {
        type: 'array',
        items: { type: 'string' },
        description: '要导出的表名数组；省略 = 全部表。',
      },
      to: {
        type: 'string',
        description: '目标文件路径（建议绝对路径）；省略 = 本地默认路径 ~/.dsh/data/<名>.sql。',
      },
    },
    output: { schema: { type: 'string' }, render: renderText },
    execute: catchText(async (args, exec) => {
      const r = engine.exportToFile(args.db, args.tables, args.to, exec && exec.signal)
      return `已导出 ${r.tables} 张表、${r.rows} 行 → ${r.path}`
    }),
  },

  import: {
    name: 'sqlite_import',
    description:
      '从 SQL 文本文件恢复数据到数据库（覆盖式：替换文件中包含的表，库中其余表保留）。' +
      '默认读 ~/.dsh/data/<名>.sql；from 参数指定源文件（建议绝对路径）。' +
      '何时用：换机器后、或拉取仓库中的导出文件后恢复数据。导入前建议先 sqlite_export 备份当前数据。',
    parameters: {
      db: {
        type: 'string',
        description: '目标库名，默认 "default"。',
      },
      from: {
        type: 'string',
        description: '源 SQL 文件路径（建议绝对路径）；省略 = ~/.dsh/data/<名>.sql。',
      },
    },
    output: { schema: { type: 'string' }, render: renderText },
    execute: catchText(async (args, exec) => {
      const r = engine.importFromFile(args.db, args.from, exec && exec.signal)
      return `导入完成：执行 ${r.statements} 条语句（${r.bytes} 字节）← ${r.path}`
    }),
  },

  removeDb: {
    name: 'sqlite_remove_db',
    description:
      '删除整个命名库（关闭连接并删除库文件，含全部表与数据，不可恢复）。' +
      '何时用：用户要求删除/清理某个命名库，或某协作库内容整体作废要重来时。' +
      '必须显式传 confirm: true 才执行；默认库 agent.db 不可删除（清空其内容请对表用 DROP）。' +
      '删除后其他会话不会再收到该库的协作提醒。',
    parameters: {
      db: {
        type: 'string',
        required: true,
        description: '要删除的命名库（不允许 default）。',
      },
      confirm: {
        type: 'boolean',
        description: '危险操作：必须为 true。',
      },
    },
    output: { schema: { type: 'string' }, render: renderText },
    execute: catchText(async (args, exec) => {
      const r = engine.removeDb(args.db, args.confirm, exec && exec.signal)
      return `已删除库 ${r.db}（${r.file} 已移除）`
    }),
  },
}
