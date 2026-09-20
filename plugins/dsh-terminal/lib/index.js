// dsh-terminal Host 半：起一个交互式 PowerShell（真实 PTY），并通过 webServer
// 暴露 spawn / write / read / close 四个同源 API 给浏览器端。
//
// 依赖策略：只用 Node 内置能力 + ctx 服务，不 import 任何 harness 包 ——
// 避免进程内出现第二份 cordis / dsh-tools 造成 Symbol 分裂。

import { existsSync } from 'node:fs'

export const name = 'dsh-terminal'

// subprocess 是硬依赖（分配 PTY），webServer 是硬依赖（对外提供终端 API）。
export const inject = ['subprocess', 'webServer']

/** 单会话 scrollback 缓冲上限（UTF-8 字节）。 */
const MAX_BYTES = 512 * 1024
/** 单个 POST body 上限（防误传大 payload）。 */
const MAX_BODY = 2 * 1024 * 1024

/**
 * PowerShell 解析顺序：PS7(pwsh) → Windows PowerShell 5.1(powershell) →
 * PS7 绝对路径 → 5.1 绝对路径（Windows 必装）。与 harness 自带 pwsh 工具的
 * resolvePwshPath 兜底顺序一致，但不 import 其包，保持零 harness 依赖。
 */
const SHELL_CANDIDATES = [
  ['pwsh', ['-NoLogo', '-NoProfile']],
  ['powershell', ['-NoLogo', '-NoProfile']],
  ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', ['-NoLogo', '-NoProfile']],
  ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile']],
]

export function apply(ctx) {
  const subprocess = ctx.subprocess
  const webServer = ctx.webServer

  const sessions = new Map()
  let nextId = 1
  let resolvedShell = null
  const decoder = new TextDecoder()

  async function resolveShell() {
    if (resolvedShell !== null) return resolvedShell
    for (const [name, args] of SHELL_CANDIDATES) {
      try {
        const path = await subprocess.resolveExecutable(name)
        resolvedShell = { path, args }
        return resolvedShell
      } catch { /* 继续下一个候选 */ }
    }
    return null
  }

  function append(session, text) {
    if (typeof text !== 'string' || text.length === 0) return
    session.chunks.push({ seq: session.nextSeq, text })
    session.nextSeq += 1
    session.bytes += text.length
    while (session.bytes > MAX_BYTES && session.chunks.length > 1) {
      const dropped = session.chunks.shift()
      session.bytes -= dropped.text.length
    }
  }

  function createSession(handle) {
    const id = 't' + (nextId++)
    const session = { id, handle, chunks: [], nextSeq: 0, bytes: 0, status: 'running', exit: null }
    sessions.set(id, session)
    handle.output.on('data', (chunk) => {
      try { append(session, decoder.decode(chunk, { stream: true })) } catch { /* noop */ }
    })
    handle.output.on('end', () => {
      try { append(session, decoder.decode()) } catch { /* noop */ }
    })
    handle.done.then((outcome) => {
      session.status = 'exited'
      session.exit = (outcome && typeof outcome === 'object')
        ? { exitCode: outcome.exitCode, signal: outcome.signal }
        : { exitCode: null, signal: null }
    }, () => {
      session.status = 'exited'
      session.exit = { exitCode: null, signal: null }
    })
    return session
  }

  // 插件停用 → 关掉所有 PTY 会话，回收进程树。
  ctx.effect(() => () => {
    for (const s of sessions.values()) {
      try { s.handle.terminate().catch(() => {}) } catch { /* noop */ }
    }
    sessions.clear()
  }, 'dsh-terminal: session teardown')

  function sendJson(res, code, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  async function readJsonBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) throw new Error('request body too large')
      chunks.push(chunk)
    }
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  ctx.effect(() => {
    const routes = []

    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-terminal-api/spawn',
      handler: async (req, res) => {
        try {
          const args = await readJsonBody(req)
          const cols = Number.isInteger(args.cols) && args.cols > 0 && args.cols <= 500 ? args.cols : 120
          const rows = Number.isInteger(args.rows) && args.rows > 0 && args.rows <= 300 ? args.rows : 30
          const cwd = typeof args.cwd === 'string' && args.cwd.length > 0 && existsSync(args.cwd) ? args.cwd : process.cwd()
          const shell = await resolveShell()
          if (shell === null) {
            sendJson(res, 400, { ok: false, error: 'no PowerShell found (tried pwsh, powershell, Windows PowerShell 5.1)' })
            return
          }
          const handle = await subprocess.spawnTerminal({
            argv: [shell.path, ...shell.args],
            env: { TERM: 'xterm-256color' },
            cwd,
            cols,
            rows,
            graceMs: 3000,
          })
          const session = createSession(handle)
          sendJson(res, 200, { ok: true, id: session.id, pid: handle.pid, cwd, shell: shell.path, cols, rows })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
        }
      },
    }))

    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-terminal-api/write',
      handler: async (req, res) => {
        try {
          const args = await readJsonBody(req)
          const session = sessions.get(args.id)
          if (!session || session.status !== 'running') {
            sendJson(res, 400, { ok: false, error: 'session not available' })
            return
          }
          if (typeof args.data !== 'string') {
            sendJson(res, 400, { ok: false, error: 'data must be a string' })
            return
          }
          await session.handle.write(args.data)
          sendJson(res, 200, { ok: true })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
        }
      },
    }))

    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-terminal-api/read',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const id = url.searchParams.get('id') ?? ''
          const seq = Number.parseInt(url.searchParams.get('seq') ?? '0', 10) || 0
          const session = sessions.get(id)
          if (!session) {
            sendJson(res, 400, { ok: false, error: 'no such session' })
            return
          }
          const parts = []
          for (const c of session.chunks) if (c.seq >= seq) parts.push(c.text)
          sendJson(res, 200, {
            ok: true,
            text: parts.join(''),
            seq: session.nextSeq,
            status: session.status,
            exitCode: session.exit ? session.exit.exitCode : null,
            signal: session.exit ? session.exit.signal : null,
          })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
        }
      },
    }))

    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-terminal-api/close',
      handler: async (req, res) => {
        try {
          const args = await readJsonBody(req)
          const session = sessions.get(args.id)
          if (session) {
            try { await session.handle.terminate() } catch { /* noop */ }
            sessions.delete(args.id)
          }
          sendJson(res, 200, { ok: true })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
        }
      },
    }))

    console.log('[dsh-terminal] API routes registered: /dsh-terminal-api/spawn|write|read|close')
    return () => { for (const d of routes) d() }
  }, 'dsh-terminal: api routes')
}
