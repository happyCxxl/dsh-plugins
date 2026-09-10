// index.js — 插件入口：注册五个工具 + 可选挂载自测。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolDefs } from './tools.js'
import * as engine from './engine.js'
import { COLLAB_RULE, createCoordination, frame, onPostExecute, preStepTexts } from './coordination.js'

export const name = '@cxxl/dsh-sqlite'
export const inject = ['tools', 'webServer', 'systemPrompt']

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function queryOf(req) {
  return Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams.entries())
}

// 面板只读 API：三个 HTTP 路由（与页面同源，client 直接 fetch）。
// webServer 声明为硬依赖（inject），cordis 会等服务就绪后再挂载本插件。
function registerPanelRoutes(ctx) {
  const webServer = ctx.webServer
  ctx.effect(() => {
    const disposers = [
      webServer.register({
        kind: 'exact',
        path: '/dsh-sqlite-api/list-dbs',
        handler: async (req, res) => {
          try {
            sendJson(res, 200, { ok: true, dbs: engine.listDbFiles() })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/dsh-sqlite-api/tables',
        handler: async (req, res) => {
          try {
            const q = queryOf(req)
            sendJson(res, 200, { ok: true, ...engine.listTables(q.db ?? 'default') })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/dsh-sqlite-api/preview',
        handler: async (req, res) => {
          try {
            const q = queryOf(req)
            sendJson(res, 200, { ok: true, ...engine.tablePreview(q.db ?? 'default', q.table, 50) })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
          }
        },
      }),
    ]
    console.log('[dsh-sqlite] panel routes registered: /dsh-sqlite-api/list-dbs|tables|preview')
    return () => { for (const d of disposers) d() }
  }, 'dsh-sqlite panel routes')
}

// v1.2：常驻短规则注入——把"持久化场景 → sqlite 工具"的触发率推向接近确定。
// 机制依据：官方 dsh-plan-mode 的 systemPrompt.section 先例（DESIGN.md 第 14 节）。
function registerPersistenceRule(ctx) {
  const dispose = ctx.systemPrompt.section({
    name: 'dsh-sqlite:persistence-rule',
    order: 1000,
    text: '持久化规则：当用户要求记住、记录、跟踪、保存结构化数据，或表达"以后还要查/对比/统计"的意图时，使用 sqlite_exec（写）与 sqlite_query（读）工具，不要用普通文本文件替代数据库；不确定库里有什么时先调 sqlite_tables。' + COLLAB_RULE,
  })
  console.log('[dsh-sqlite] persistence rule section registered (order 1000)')
  ctx.effect(() => dispose, 'dsh-sqlite persistence rule')
}

// v2：跨会话协作感知（DESIGN.md 第 15 节）。观察者语义：绝不修改执行链路。
function registerCoordination(ctx) {
  const coord = createCoordination()
  const names = new Set()
  try {
    for (const f of engine.listDbFiles()) {
      if (f.name !== 'agent.db') names.add(f.name.replace(/\.db$/, ''))
    }
  } catch { /* 启动快照失败则按空处理 */ }
  coord.knownDbs = names

  ctx.on('tools/post-execute', (exec, result, next) => {
    try { onPostExecute(coord, exec, result) } catch { /* 观察者绝不抛 */ }
    return next()
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision === undefined || decision.kind === 'reject') return decision
    try {
      const texts = preStepTexts(coord, payload.agent, engine)
      if (texts.length === 0) return decision
      const msgs = texts.map((text) => createUserMessage({
        content: [{ type: 'text', text: frame(text) }],
        source: { kind: 'plugin', plugin: 'dsh-sqlite' },
      }))
      return { ...decision, messages: [...msgs, ...decision.messages] }
    } catch {
      return decision
    }
  })
}

export function apply(ctx) {
  for (const key of Object.keys(toolDefs)) {
    ctx.tools.register(defineTool(toolDefs[key]))
  }
  ctx.effect(() => () => engine.closeAll())
  registerPanelRoutes(ctx)
  registerPersistenceRule(ctx)
  registerCoordination(ctx)

  // 挂载自测：DSH_PLUGIN_SELFTEST=1 时在临时数据目录跑一遍真实执行管线。
  if (process.env.DSH_PLUGIN_SELFTEST === '1') void selfTest(ctx)
}

async function selfTest(ctx) {
  const prev = process.env.DSH_SQLITE_DATA_DIR
  let tmp = null
  try {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-sqlite-selftest-'))
    process.env.DSH_SQLITE_DATA_DIR = tmp
    const signal = new AbortController().signal
    const call = (n, args) => ctx.tools.execute({ callId: ToolCallId(`sqlite-self-${n}`), name: n, arguments: args, signal })

    let r = await call('sqlite_exec', { sql: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT); INSERT OR REPLACE INTO t (id, v) VALUES (1, \'hello\');' })
    if (r.isError) throw new Error(`exec 失败: ${JSON.stringify(r.error)}`)

    r = await call('sqlite_query', { sql: 'SELECT * FROM t' })
    if (r.isError || !String(r.value).includes('hello')) throw new Error(`query 失败: ${r.isError ? JSON.stringify(r.error) : r.value}`)

    r = await call('sqlite_exec', { sql: 'DROP TABLE t' })
    if (r.isError || !String(r.value).includes('confirm')) throw new Error(`危险拦截失效: ${r.isError ? JSON.stringify(r.error) : r.value}`)

    r = await call('sqlite_exec', { sql: 'DROP TABLE t', confirm: true })
    if (r.isError) throw new Error(`confirm 执行失败: ${JSON.stringify(r.error)}`)

    r = await call('sqlite_tables', {})
    if (r.isError) throw new Error(`tables 失败: ${JSON.stringify(r.error)}`)

    console.log('[dsh-sqlite] self-test PASS')
  } catch (err) {
    console.log(`[dsh-sqlite] self-test FAIL: ${(err && err.message) || err}`)
  } finally {
    if (prev === undefined) delete process.env.DSH_SQLITE_DATA_DIR
    else process.env.DSH_SQLITE_DATA_DIR = prev
    engine.closeAll()
    if (tmp) {
      try { rmSync(tmp, { recursive: true, force: true }) } catch { /* noop */ }
    }
  }
}
