// noise-check.mjs — 噪音基线实验：模拟"忙碌一天"的共享区，测量会话实际收到的注入。
// 用法：node scripts/noise-check.mjs（零污染，临时目录，跑完自删）
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as engine from '../lib/engine.js'
import { createCoordination, onPostExecute, preStepTexts } from '../lib/coordination.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-sqlite-noise-'))
process.env.DSH_SQLITE_DATA_DIR = dir
const signal = new AbortController().signal

const scenes = [
  { db: 'login-refactor', meta: [['label', '登录模块改造'], ['description', '接口对齐与决策记录'], ['table:team_decisions', '决策记录']], tables: ['CREATE TABLE team_decisions(id INTEGER PRIMARY KEY, kind TEXT, content TEXT)'] },
  { db: 'billing-migration', meta: [['label', '计费系统迁移'], ['description', '账单表结构迁移']], tables: ['CREATE TABLE migration_plan(id INTEGER PRIMARY KEY, step TEXT)'] },
  { db: 'docs-q3', meta: [], tables: ['CREATE TABLE outline(id INTEGER PRIMARY KEY, section TEXT)'] },
  { db: 'scrap-notes', meta: [], tables: ['CREATE TABLE notes(id INTEGER PRIMARY KEY, txt TEXT)'] },
  { db: 'exp-a', meta: [['label', '实验A']], tables: ['CREATE TABLE runs(id INTEGER PRIMARY KEY, score REAL)'] },
]
for (const s of scenes) {
  const metaSql = s.meta.length > 0
    ? `CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT); ${s.meta.map(([k, v]) => `INSERT INTO meta VALUES ('${k}','${v}')`).join(';')};`
    : ''
  engine.runExec(`${metaSql} ${s.tables.join(';')}`, s.db, true, signal)
}

const coord = createCoordination()
coord.knownDbs = new Set(scenes.map((s) => s.db))
const other = {}
for (const db of ['login-refactor', 'billing-migration', 'docs-q3']) {
  onPostExecute(coord, { name: 'sqlite_exec', arguments: { db, sql: 'INSERT INTO t VALUES (1)' }, agent: other }, { isError: false })
}

const fresh = {}
const texts = preStepTexts(coord, fresh, engine)
console.log('===== 新会话首回合收到的注入（' + texts.length + ' 块，共 ' + texts.join('').length + ' 字符）=====')
for (const t of texts) console.log('---\n' + t)

const participant = {}
onPostExecute(coord, { name: 'sqlite_query', arguments: { db: 'login-refactor' }, agent: participant }, { isError: false })
onPostExecute(coord, { name: 'sqlite_query', arguments: { db: 'billing-migration' }, agent: participant }, { isError: false })
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'login-refactor', sql: 'INSERT INTO team_decisions VALUES (9)' }, agent: other }, { isError: false })
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'exp-a', sql: 'INSERT INTO runs VALUES (1)' }, agent: other }, { isError: false })
const t2 = preStepTexts(coord, participant, engine)
console.log('\n===== 参与会话（login-refactor + billing-migration）后续回合收到的注入（' + t2.length + ' 块，共 ' + t2.join('').length + ' 字符）=====')
for (const t of t2) console.log('---\n' + t)

engine.closeAll()
rmSync(dir, { recursive: true, force: true })
