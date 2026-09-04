// index.js — 插件入口：注册五个工具 + 可选挂载自测。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolDefs } from './tools.js'
import * as engine from './engine.js'

export const name = '@cxxl/dsh-sqlite'
export const inject = ['tools']

export function apply(ctx) {
  for (const key of Object.keys(toolDefs)) {
    ctx.tools.register(defineTool(toolDefs[key]))
  }
  ctx.effect(() => () => engine.closeAll())

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
    const call = (n, args) => ctx.tools.execute({ callId: CallId(`sqlite-self-${n}`), name: n, arguments: args, signal })

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
