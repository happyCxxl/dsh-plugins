// coordination.js — v2 跨会话协作感知：计数、游标、新库检测、提醒文本。
// 纯逻辑（不依赖 DSH 服务），可独立冒烟测试。观察者语义：绝不修改执行链路。
const WRITE_TOOLS = new Set(['sqlite_exec'])
const ACK_TOOLS = new Set(['sqlite_query', 'sqlite_tables'])
const REMOVE_TOOLS = new Set(['sqlite_remove_db'])

export function createCoordination() {
  return {
    dbCounters: new Map(),          // 命名库 -> 全局写计数
    newDbs: new Map(),              // 新出现的命名库 -> 首次出现时间
    knownDbs: null,                 // 启动时已存在的命名库集合（由 index 初始化）
    cursors: new WeakMap(),         // Agent -> Map<db, 已确认计数>
    notifiedNewDbs: new WeakMap(),  // Agent -> Set<db>（已广播过新库事件的库）
    initialized: new WeakSet(),     // Agent -> 已做过盘点注入
    dbTables: new Map(),            // db -> Set<表名>（提醒的表级提示，最多 8 个）
  }
}

function dbOf(args) {
  const db = args && args.db
  if (db === undefined || db === null || db === '') return 'default'
  return String(db)
}

function cursorMap(coord, agent) {
  let m = coord.cursors.get(agent)
  if (m === undefined) { m = new Map(); coord.cursors.set(agent, m) }
  return m
}

function advance(coord, agent, db) {
  cursorMap(coord, agent).set(db, coord.dbCounters.get(db) ?? 0)
}

function markNewDbNotified(coord, agent, db) {
  let notified = coord.notifiedNewDbs.get(agent)
  if (notified === undefined) { notified = new Set(); coord.notifiedNewDbs.set(agent, notified) }
  notified.add(db)
}

// 从 SQL 中提取表名提示（启发式，非精确解析；仅用于提醒的"涉及表"）。
function tableHintOf(sql) {
  if (typeof sql !== 'string') return undefined
  const create = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/i.exec(sql)
  if (create) return create[1]
  const m = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/i.exec(sql)
  if (m) return m[1]
  const from = /\bFROM\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/i.exec(sql)
  return from ? from[1] : undefined
}

// 删除库后的状态清理（游标不枚举——重建库时用计数回退语义兜底，见 preStepTexts）。
export function onDbRemoved(coord, db) {
  coord.dbCounters.delete(db)
  coord.newDbs.delete(db)
  coord.dbTables.delete(db)
  if (coord.knownDbs !== null) coord.knownDbs.delete(db)
}

// post-execute 观察者：调用方负责 next()；本函数绝不抛错。
export function onPostExecute(coord, exec, result) {
  const name = exec && exec.name
  const agent = exec && exec.agent
  if (name === undefined || agent === undefined) return
  const db = dbOf(exec.arguments)
  if (db === 'default') return
  const ok = result === undefined || result.isError !== true
  if (REMOVE_TOOLS.has(name)) {
    if (ok) onDbRemoved(coord, db)
    return
  }
  if (WRITE_TOOLS.has(name)) {
    if (!ok) return
    coord.dbCounters.set(db, (coord.dbCounters.get(db) ?? 0) + 1)
    advance(coord, agent, db) // 自己写的 = 自己知道
    const hint = tableHintOf(exec.arguments && exec.arguments.sql)
    if (hint !== undefined) {
      let s = coord.dbTables.get(db)
      if (s === undefined) { s = new Set(); coord.dbTables.set(db, s) }
      if (s.size < 8) s.add(hint)
    }
    if (coord.knownDbs !== null && !coord.knownDbs.has(db)) {
      coord.knownDbs.add(db)
      if (!coord.newDbs.has(db)) coord.newDbs.set(db, Date.now())
      markNewDbNotified(coord, agent, db) // 创建者不再被广播自己的新库
    }
  } else if (ACK_TOOLS.has(name)) {
    advance(coord, agent, db) // 查询即确认（送达确认循环）
  }
}

function safeReadMeta(engine, db) {
  try { return engine.readDbMeta(db) } catch { return {} }
}

function safeListTables(engine, db) {
  try { return engine.listTables(db).tables } catch { return [] }
}

function inventoryLines(engine) {
  const lines = []
  let files = []
  try { files = engine.listDbFiles() } catch { return lines }
  for (const f of files) {
    if (f.name === 'agent.db') continue
    const db = f.name.replace(/\.db$/, '')
    const meta = safeReadMeta(engine, db)
    const label = typeof meta.label === 'string' && meta.label !== '' ? meta.label : ''
    const desc = typeof meta.description === 'string' && meta.description !== '' ? meta.description : ''
    const tableNames = safeListTables(engine, db).map((t) => t.name)
    const tables = tableNames.map((n) => {
      const d = meta['table:' + n]
      return typeof d === 'string' && d !== '' ? `${n}「${d}」` : n
    })
    lines.push(`- ${f.name}${label ? ` — ${label}` : ''}${desc ? `：${desc}` : ''}${tables.length > 0 ? `（表：${tables.join('、')}）` : ''}`)
  }
  return lines
}

export const COLLAB_RULE = '协作规则：多会话并行协作时，协作数据写入命名库（任务名，kebab-case），同一任务的会话共用同一个命名库；新建协作库后先建 meta 表并写入 label / description 与各表说明；动手实现、做接口或方案决策前先查看协作库对齐，完成影响他人的决策后写入协作库；不同任务用不同命名库互不干扰；默认库 agent.db 不用于协作。'

export function inventoryText(engine) {
  const lines = inventoryLines(engine)
  const list = lines.length > 0 ? lines.join('\n') : '（当前无协作库）'
  // 协作规则已在每回合常驻的系统提示词中，此处不重复（避免噪音）。
  return '协作库清单：\n' + list + '\n（协作规则见系统提示词中的常驻规则）'
}

// pre-step 提醒文本（含首回合盘点、增量变化、新库广播）。返回字符串数组，空 = 零注入。
export function preStepTexts(coord, agent, engine) {
  const texts = []
  if (!coord.initialized.has(agent)) {
    coord.initialized.add(agent)
    texts.push(inventoryText(engine))
  }
  const m = cursorMap(coord, agent)
  const pending = []
  for (const [db, count] of coord.dbCounters) {
    if (!m.has(db)) continue // 库亲和：从未触碰过的库不提醒变化（新库广播已覆盖"存在感"）
    const raw = m.get(db)
    const seen = raw > count ? 0 : raw // 库被删除重建后计数回退 → 视为未看过（全量提醒一次）
    if (seen < count) {
      const tables = coord.dbTables.get(db)
      const hint = tables && tables.size > 0 ? `（涉及表：${[...tables].join('、')}）` : ''
      pending.push(`「${db}.db」自你上次查看后有 ${count - seen} 处变化${hint}`)
    }
  }
  if (pending.length > 0) {
    texts.push('协作库有新变化：' + pending.join('；') + '。需要对齐时用 sqlite_tables / sqlite_query 查看。')
  }
  let notified = coord.notifiedNewDbs.get(agent)
  if (notified === undefined) { notified = new Set(); coord.notifiedNewDbs.set(agent, notified) }
  const fresh = []
  for (const db of coord.newDbs.keys()) {
    if (!notified.has(db)) { fresh.push(db); notified.add(db) }
  }
  if (fresh.length > 0) {
    const descs = fresh.map((db) => {
      const meta = safeReadMeta(engine, db)
      const label = typeof meta.label === 'string' && meta.label !== '' ? meta.label : ''
      const desc = typeof meta.description === 'string' && meta.description !== '' ? meta.description : ''
      return `「${db}.db」${label ? `（${label}）` : ''}${desc ? `：${desc}` : ''}`
    })
    texts.push('出现新协作库：' + descs.join('；') + '。如与你的任务重复，请检查合并。')
  }
  return texts
}

// 官方 agent-instructions 同款框架；防 meta 内容注入关闭标签。
export function frame(text) {
  return '<system-reminder>\n' + String(text).split('</system-reminder>').join('</system-reminder >') + '\n</system-reminder>'
}
