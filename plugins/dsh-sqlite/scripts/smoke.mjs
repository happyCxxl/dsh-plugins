// smoke.mjs — 本地冒烟测试：在临时数据目录驱动五个工具的 execute。
// 用法：node scripts/smoke.mjs（在 plugins/dsh-sqlite 目录下）
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolDefs } from '../lib/tools.js'
import * as engine from '../lib/engine.js'
import { createCoordination, onPostExecute, preStepTexts } from '../lib/coordination.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-sqlite-smoke-'))
process.env.DSH_SQLITE_DATA_DIR = dir
const signal = new AbortController().signal
const exec = { signal }

let failed = 0
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

async function run(key, args) {
  return toolDefs[key].execute(args, exec)
}

// 1. 建表 + 插入
let out = await run('exec', { sql: 'CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT, price REAL); INSERT OR REPLACE INTO projects (id, name, price) VALUES (1, \'A项目\', 120000), (2, \'B项目\', 80000);' })
check('exec 建表插入', out.startsWith('执行成功：2'), out)

// 2. 只读查询
out = await run('query', { sql: 'SELECT name, price FROM projects WHERE price > 100000' })
check('query 过滤查询', out.includes('A项目') && out.includes('120000'), out.split('\n')[0])

// 3. 行数上限
out = await run('query', { sql: 'SELECT * FROM projects', maxRows: 1 })
check('query maxRows 截断', out.includes('已截断'), out.split('\n')[0])

// 4. 只读边界：query 拒绝写语句
out = await run('query', { sql: 'DROP TABLE projects' })
check('query 拒绝写语句', out.includes('错误：'), out)

// 5. 危险拦截：DROP 无 confirm
out = await run('exec', { sql: 'DROP TABLE projects' })
check('exec 危险拦截 DROP', out.includes('confirm: true'), out)

// 6. 危险拦截：无 WHERE 的 DELETE
out = await run('exec', { sql: 'DELETE FROM projects' })
check('exec 危险拦截 DELETE 无 WHERE', out.includes('confirm: true'), out)

// 7. 语句边界：ATTACH / PRAGMA 拒绝
out = await run('exec', { sql: 'ATTACH DATABASE \'x.db\' AS x' })
check('exec 拒绝 ATTACH', out.includes('禁用'), out)
out = await run('exec', { sql: 'PRAGMA journal_mode = WAL' })
check('exec 拒绝 PRAGMA', out.includes('禁用'), out)

// 8. confirm 放行
out = await run('exec', { sql: 'DROP TABLE projects', confirm: true })
check('exec confirm 放行 DROP', out.startsWith('执行成功'), out)

// 9. 导出（含指定表 + 本地默认路径两种）
const repoDump = join(dir, 'repo-agent.sql')
out = await run('exec', { sql: 'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO projects VALUES (1, \'同步项目\');' })
out = await run('export', { to: repoDump })
check('export 指定路径', existsSync(repoDump) && out.includes('1 张表'), out)
check('export 内容含 INSERT OR REPLACE', readFileSync(repoDump, 'utf8').includes('INSERT OR REPLACE'))

// 10. 覆盖式导入（先改数据再导入 → 回到导出时状态）
await run('exec', { sql: "INSERT OR REPLACE INTO projects VALUES (2, '本地新增');" })
out = await run('import', { from: repoDump })
check('import 执行', out.includes('导入完成'), out)
out = await run('query', { sql: 'SELECT * FROM projects' })
check('import 覆盖语义（本地新增被替换，只剩同步项目）', out.includes('同步项目') && !out.includes('本地新增') && out.split('\n').length === 3, out.split('\n')[0])

// 11. tables 发现性 + 完整性
out = await run('tables', {})
check('tables 列表', out.includes('projects') && out.includes('quick_check'), out.split('\n')[0])

// 12. 命名库 + 库名校验
out = await run('exec', { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, txt TEXT);', db: 'study' })
check('exec 命名库', out.startsWith('执行成功'), out)
out = await run('exec', { sql: 'CREATE TABLE x (id INTEGER)', db: '../evil' })
check('db 名校验拒绝路径穿越', out.includes('不合法'), out)

// 13. 只读 PRAGMA 白名单
out = await run('query', { sql: 'PRAGMA table_info(projects)' })
check('query 只读 PRAGMA', out.includes('name'), out.split('\n')[0])
out = await run('query', { sql: 'PRAGMA journal_mode = WAL' })
check('query 拒绝写 PRAGMA', out.includes('错误：'), out)

// 14. tablePreview（面板只读数据源）
await run('exec', { sql: "CREATE TABLE preview_t (id INTEGER PRIMARY KEY, txt TEXT); INSERT INTO preview_t VALUES (1, 'a'), (2, 'b');" })
const pv = engine.tablePreview('default', 'preview_t', 50)
check('tablePreview 列与行', pv.columns.includes('id') && pv.rows.length === 2 && pv.rows[0].id === 1 && pv.rows[0].txt === 'a', JSON.stringify(pv).slice(0, 100))
check('tablePreview JSON 安全（无 BigInt）', JSON.stringify(pv).indexOf('"id":1') >= 0)
const pvCap = engine.tablePreview('default', 'preview_t', 1)
check('tablePreview 上限生效', pvCap.rows.length === 1 && pvCap.truncated === true)
const pvBad = (() => { try { engine.tablePreview('default', 'no_such_table', 50); return 'NO-THROW' } catch (e) { return e.message } })()
check('tablePreview 拒绝不存在表', pvBad.includes('表不存在'), pvBad)
const pvEvil = (() => { try { engine.tablePreview('../evil', 'preview_t', 50); return 'NO-THROW' } catch (e) { return e.message } })()
check('tablePreview 拒绝非法库名', pvEvil.includes('不合法'), pvEvil)

// 15. v2 协作感知（coordination 纯逻辑 + 真实引擎）
const coord = createCoordination()
coord.knownDbs = new Set()
const agentA = {}, agentB = {}
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'proj' }, agent: agentA }, { isError: false })
check('v2 写计数', coord.dbCounters.get('proj') === 1)
let t = preStepTexts(coord, agentA, engine)
check('v2 自己写的不提醒自己（仅盘点）', t.length === 1 && t[0].includes('协作库清单'))
t = preStepTexts(coord, agentB, engine)
check('v2 未触碰库不提醒变化（仅盘点+新库广播）', !t.some((x) => x.includes('处变化')) && t.some((x) => x.includes('新协作库')))
onPostExecute(coord, { name: 'sqlite_query', arguments: { db: 'proj' }, agent: agentB }, { isError: false })
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'proj' }, agent: agentA }, { isError: false })
t = preStepTexts(coord, agentB, engine)
check('v2 触碰后订阅：新写入产生增量提醒', t.some((x) => x.includes('proj.db') && x.includes('1 处变化')))
onPostExecute(coord, { name: 'sqlite_query', arguments: { db: 'proj' }, agent: agentB }, { isError: false })
t = preStepTexts(coord, agentB, engine)
check('v2 查询即确认后不再提醒', t.length === 0)
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'default' }, agent: agentA }, { isError: false })
check('v2 默认库不计数', coord.dbCounters.has('default') === false)
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'proj' }, agent: agentA }, { isError: true })
check('v2 失败写入不计数', coord.dbCounters.get('proj') === 2)
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'brand-new' }, agent: agentB }, { isError: false })
t = preStepTexts(coord, agentA, engine)
check('v2 新库广播', t.some((x) => x.includes('brand-new.db') && x.includes('新协作库')))
check('v2 readDbMeta 空表返回空对象', JSON.stringify(engine.readDbMeta('default')) === '{}')
const agentC = {}
onPostExecute(coord, { name: 'sqlite_exec', arguments: { db: 'other-task' }, agent: agentA }, { isError: false })
t = preStepTexts(coord, agentC, engine)
check('v2 库亲和：未触碰库不提醒变化', !t.some((x) => x.includes('other-task.db') && x.includes('处变化')))
check('v2 库亲和：未触碰库仍收新库广播', t.some((x) => x.includes('other-task.db') && x.includes('新协作库')))

engine.closeAll()
rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
