// engine.js — 所有 node:sqlite / 文件 IO 调用隔离于此。
// 实验性 API 集中在这一层：将来替换 better-sqlite3 只改本文件。
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join, resolve, sep, dirname } from 'node:path'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs'

export const MAX_SQL_LEN = 64 * 1024
export const MAX_ROWS = 500
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024
export const DEFAULT_DB = 'default'
const DB_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

// 只读 PRAGMA 白名单（query 通道唯一放行的 PRAGMA）
const READONLY_PRAGMAS = new Set([
  'table_info',
  'table_list',
  'index_list',
  'index_info',
  'foreign_key_list',
  'quick_check',
  'integrity_check',
  'freelist_count',
  'page_count',
  'database_list',
])

// exec 放行的语句类型（标准 DDL/DML）
const EXEC_ALLOW = new Set([
  'CREATE', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'REPLACE',
  'WITH', 'BEGIN', 'COMMIT', 'ROLLBACK', 'END', 'VACUUM', 'REINDEX',
])

// exec 一律拒绝的语句类型
const EXEC_DENY = new Set(['ATTACH', 'DETACH', 'LOAD_EXTENSION', 'PRAGMA'])

const QUERY_ALLOW = new Set(['SELECT', 'WITH', 'EXPLAIN', 'PRAGMA'])

export function getDataDir() {
  return process.env.DSH_SQLITE_DATA_DIR || join(homedir(), '.dsh', 'data')
}

function ensureDataDir() {
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function dumpFileName(dbName) {
  return `${dbName === DEFAULT_DB ? 'agent' : dbName}.sql`
}

export function dbFile(dbName) {
  const name = dbName === undefined || dbName === null || dbName === '' ? DEFAULT_DB : String(dbName)
  if (name !== DEFAULT_DB && !DB_NAME_RE.test(name)) {
    throw new Error(`db 名不合法："${name}"（仅允许字母/数字/_/-，1-64 位）`)
  }
  const dataDir = ensureDataDir()
  const file = name === DEFAULT_DB ? 'agent.db' : `${name}.db`
  const p = resolve(dataDir, file)
  if (!p.startsWith(resolve(dataDir) + sep)) throw new Error('db 路径越界')
  return { name, file: p }
}

const openDbs = new Map()

function openDb(dbName) {
  const { name, file } = dbFile(dbName)
  let db = openDbs.get(name)
  if (db === undefined) {
    db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 3000')
    openDbs.set(name, db)
  }
  return { name, db }
}

export function closeAll() {
  for (const db of openDbs.values()) {
    try { db.close() } catch { /* noop */ }
  }
  openDbs.clear()
}

// 分号切分语句。v1 已知限制：字符串字面量中的分号会破坏切分——
// 文档已提示"值内不要包含分号"。
export function splitStatements(sql) {
  return String(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function stripLeadingComments(s) {
  let out = s
  for (;;) {
    const t = out.trimStart()
    if (t.startsWith('--')) {
      const nl = t.indexOf('\n')
      out = nl === -1 ? '' : t.slice(nl + 1)
      continue
    }
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/')
      out = end === -1 ? '' : t.slice(end + 2)
      continue
    }
    break
  }
  return out.trimStart()
}

export function firstKeyword(stmt) {
  const m = /^([A-Za-z]+)/.exec(stripLeadingComments(stmt))
  return m ? m[1].toUpperCase() : ''
}

function dangerOf(stmt) {
  const kw = firstKeyword(stmt)
  if (kw === 'DROP' || kw === 'VACUUM' || kw === 'REINDEX') return `${kw} 属危险操作`
  if ((kw === 'DELETE' || kw === 'UPDATE') && !/\bWHERE\b/i.test(stmt)) {
    return `${kw} 未带 WHERE，将影响整张表`
  }
  if (kw === 'ALTER' && /\bDROP\b/i.test(stmt)) return 'ALTER 含 DROP 属危险操作'
  return null
}

function assertNotAborted(signal) {
  if (signal && signal.aborted) throw new Error('执行已取消')
}

function rowsToMarkdown(columns, rows, truncated) {
  const head = `| ${columns.join(' | ')} |`
  const sep = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => {
    const cells = columns.map((c) => {
      let v = r[c]
      if (v === null || v === undefined) return 'NULL'
      if (v instanceof Uint8Array) return '<blob>'
      let s = String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
      if (s.length > 200) s = s.slice(0, 200) + '…'
      return s
    })
    return `| ${cells.join(' | ')} |`
  })
  const lines = [head, sep, ...body]
  if (truncated) lines.push('', `（已截断：还有更多行未显示，请用 WHERE/LIMIT 收窄查询）`)
  return lines.join('\n')
}

export function runQuery(sql, dbName, maxRows, signal) {
  assertNotAborted(signal)
  const text = String(sql ?? '')
  if (text.length === 0) throw new Error('sql 参数为空')
  if (text.length > MAX_SQL_LEN) throw new Error(`SQL 超过 ${MAX_SQL_LEN / 1024}KB 上限，请拆分`)
  const limit = Math.max(1, Math.min(MAX_ROWS, Number.isFinite(maxRows) ? Math.floor(maxRows) : 100))
  const stmts = splitStatements(text)
  if (stmts.length === 0) throw new Error('未解析到任何语句')
  for (const stmt of stmts) {
    const kw = firstKeyword(stmt)
    if (!QUERY_ALLOW.has(kw)) {
      throw new Error(`sqlite_query 仅允许 SELECT / WITH / EXPLAIN / 只读 PRAGMA，收到以 ${kw || '?'} 开头的语句——修改数据请改用 sqlite_exec`)
    }
    if (kw === 'PRAGMA') {
      const m = /^PRAGMA\s+([a-zA-Z_]+)/i.exec(stripLeadingComments(stmt))
      if (!m || !READONLY_PRAGMAS.has(m[1].toLowerCase())) {
        throw new Error(`PRAGMA ${m ? m[1] : '?'} 不在只读白名单内（仅允许 ${[...READONLY_PRAGMAS].join(' / ')}）`)
      }
    }
  }
  const { db } = openDb(dbName)
  const sections = []
  for (const stmt of stmts) {
    assertNotAborted(signal)
    const prepared = db.prepare(stmt)
    const all = prepared.all()
    let columns = []
    try {
      const raw = prepared.columns()
      if (Array.isArray(raw) && raw.length > 0) {
        columns = raw.map((c) => (typeof c === 'string' ? c : c.name))
      }
    } catch { /* older node fallback */ }
    if (columns.length === 0 && all.length > 0) columns = Object.keys(all[0])
    const truncated = all.length > limit
    const rows = truncated ? all.slice(0, limit) : all
    sections.push(rowsToMarkdown(columns, rows, truncated))
  }
  return sections.join('\n\n')
}

export function runExec(sql, dbName, confirm, signal) {
  assertNotAborted(signal)
  const text = String(sql ?? '')
  if (text.length === 0) throw new Error('sql 参数为空')
  if (text.length > MAX_SQL_LEN) throw new Error(`SQL 超过 ${MAX_SQL_LEN / 1024}KB 上限，大批量写入请分批`)
  const stmts = splitStatements(text)
  if (stmts.length === 0) throw new Error('未解析到任何语句')
  const dangers = []
  for (const stmt of stmts) {
    const kw = firstKeyword(stmt)
    if (EXEC_DENY.has(kw)) {
      throw new Error(`拒绝执行：${kw} 语句被禁用（安全边界：不允许挂载外部文件 / 修改引擎配置）`)
    }
    if (!EXEC_ALLOW.has(kw)) {
      throw new Error(`不支持的语句类型：${kw || '?'}（sqlite_exec 仅支持标准 DDL/DML）`)
    }
    const d = dangerOf(stmt)
    if (d !== null) dangers.push(`「${stmt.slice(0, 60)}${stmt.length > 60 ? '…' : ''}」${d}`)
  }
  if (dangers.length > 0 && confirm !== true) {
    throw new Error(`危险操作需确认，请显式传 confirm: true 后重试：\n${dangers.join('\n')}`)
  }
  const { db } = openDb(dbName)
  assertNotAborted(signal)
  db.exec(text)
  return stmts.length
}

export function listTables(dbName, signal) {
  assertNotAborted(signal)
  const { name, db } = openDb(dbName)
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all()
  const out = []
  for (const t of tables) {
    assertNotAborted(signal)
    const info = db.prepare(`PRAGMA table_info(${quoteIdent(t.name)})`).all()
    const columns = info.map((c) => ({
      name: c.name,
      type: c.type || '',
      notnull: c.notnull === 1,
      pk: c.pk === 1,
    }))
    const cnt = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(t.name)}`).all()
    out.push({ name: t.name, columns, rowCount: cnt[0] ? Number(cnt[0].c) : 0 })
  }
  let quickCheck = 'ok'
  try {
    const q = db.prepare('PRAGMA quick_check').all()
    quickCheck = q[0] && q[0].quick_check !== undefined ? String(q[0].quick_check) : 'ok'
  } catch (err) {
    quickCheck = `quick_check 失败：${err.message}`
  }
  return { dbName: name, tables: out, quickCheck }
}

export function listDbFiles() {
  const dataDir = ensureDataDir()
  const entries = []
  for (const f of readdirSync(dataDir)) {
    if (!f.endsWith('.db')) continue
    try {
      const st = statSync(join(dataDir, f))
      entries.push({ name: f, bytes: st.size })
    } catch { /* noop */ }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}

export function allTableNames(dbName, signal) {
  assertNotAborted(signal)
  const { db } = openDb(dbName)
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((t) => t.name)
}

function quoteIdent(s) {
  return `"${String(s).replace(/"/g, '""')}"`
}

function quoteValue(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return String(v)
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

export function dumpSql(dbName, tables, signal) {
  assertNotAborted(signal)
  const { db } = openDb(dbName)
  const existing = allTableNames(dbName, signal)
  const selected = tables === undefined || tables === null || tables.length === 0
    ? existing
    : [...new Set(tables.map((t) => String(t)))]
  for (const t of selected) {
    if (!existing.includes(t)) throw new Error(`表不存在：${t}（现有表：${existing.join(', ') || '无'}）`)
  }
  const lines = [`-- dsh-sqlite export · db=${dbName} · tables=${selected.join(',')}`, 'BEGIN;']
  let rowCount = 0
  for (const t of selected) {
    assertNotAborted(signal)
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
    lines.push(`DROP TABLE IF EXISTS ${quoteIdent(t)};`)
    lines.push(`${schema && schema.sql ? schema.sql : `CREATE TABLE ${quoteIdent(t)} (x)`};`)
    const rows = db.prepare(`SELECT * FROM ${quoteIdent(t)}`).all()
    const cols = rows.length > 0 ? Object.keys(rows[0]) : []
    for (const r of rows) {
      if (cols.length === 0) break
      const values = cols.map((c) => quoteValue(r[c]))
      lines.push(`INSERT OR REPLACE INTO ${quoteIdent(t)} (${cols.map(quoteIdent).join(', ')}) VALUES (${values.join(', ')});`)
      rowCount++
    }
  }
  lines.push('COMMIT;')
  return { text: lines.join('\n'), tableCount: selected.length, rowCount }
}

export function exportToFile(dbName, tables, to, signal) {
  const { name } = dbFile(dbName)
  const dump = dumpSql(dbName, tables, signal)
  const target = to !== undefined && to !== null && String(to).trim() !== ''
    ? String(to).trim()
    : join(ensureDataDir(), dumpFileName(name))
  const dir = dirname(resolve(target))
  mkdirSync(dir, { recursive: true })
  writeFileSync(target, dump.text, 'utf8')
  return { path: resolve(target), tables: dump.tableCount, rows: dump.rowCount }
}

export function importFromFile(dbName, from, signal) {
  assertNotAborted(signal)
  const { name } = dbFile(dbName)
  const src = from !== undefined && from !== null && String(from).trim() !== ''
    ? String(from).trim()
    : join(getDataDir(), dumpFileName(name))
  if (!existsSync(src)) throw new Error(`文件不存在：${src}`)
  const st = statSync(src)
  if (st.size > MAX_IMPORT_BYTES) {
    throw new Error(`导入文件超过 ${MAX_IMPORT_BYTES / 1024 / 1024}MB 上限（${st.size} 字节）`)
  }
  const text = readFileSync(src, 'utf8')
  const stmts = splitStatements(text)
  if (stmts.length === 0) throw new Error(`文件内容为空或无法解析：${src}`)
  const { db } = openDb(dbName)
  assertNotAborted(signal)
  db.exec(text)
  return { path: resolve(src), statements: stmts.length, bytes: st.size }
}

// 面板只读数据源：指定表的前 N 行（硬上限 50），返回 JSON 安全的结构化数据。
export function tablePreview(dbName, table, limit, signal) {
  assertNotAborted(signal)
  const name = String(table ?? '')
  if (name === '') throw new Error('table 参数为空')
  const existing = allTableNames(dbName, signal)
  if (!existing.includes(name)) {
    throw new Error(`表不存在：${name}（现有表：${existing.join(', ') || '无'}）`)
  }
  const cap = Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.floor(limit) : 50))
  const { db } = openDb(dbName)
  const prepared = db.prepare(`SELECT * FROM ${quoteIdent(name)} LIMIT ${cap}`)
  const rows = prepared.all()
  let columns = []
  try {
    const raw = prepared.columns()
    if (Array.isArray(raw) && raw.length > 0) columns = raw.map((c) => (typeof c === 'string' ? c : c.name))
  } catch { /* older node fallback */ }
  if (columns.length === 0 && rows.length > 0) columns = Object.keys(rows[0])
  const clean = rows.map((r) => {
    const o = {}
    for (const c of columns) {
      const v = r[c]
      o[c] = v === undefined || v === null ? null
        : v instanceof Uint8Array ? '<blob>'
        : typeof v === 'bigint' ? String(v)
        : v
    }
    return o
  })
  return { table: name, columns, rows: clean, truncated: rows.length >= cap }
}
