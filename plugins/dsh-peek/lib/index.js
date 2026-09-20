// index.js — 插件入口：注册 /dsh-peek/meta 与 /dsh-peek/file 两个同源路由，
// 让浏览器端预览 DSH 生成的任意文件。
//
// 为什么必须有宿主侧：客户端插件跑在浏览器里，读不到本地文件；只能由宿主读文件、
// 再经 HTTP 路由喂给页面。依赖策略：只用 Node 内置模块 + ctx 服务，不 import 任何
// harness 包——避免进程内出现第二份 cordis / dsh-tools 导致 Symbol 分裂。
// 类型表见 lib/mime.js；路径解析见 lib/resolve.js。
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kindOf, mimeOf } from './mime.js'
import { resolvePath } from './resolve.js'

/** 插件短名（对应 cordis.patch.yml 的 id）。 */
export const name = 'dsh-peek'

/** 硬依赖：webServer 注册同源预览路由。 */
export const inject = ['webServer']

/** 单文件内嵌预览上限（字节）。超过就提示改用下载，而不是塞进页面。 */
const MAX_PREVIEW_BYTES = 512 * 1024 * 1024

/** 插件样式表（随包发布；客户端经 /dsh-peek/styles.css 拉取注入）。 */
const STYLES_CSS = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8')

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function queryOf(req) {
  return Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams.entries())
}

/**
 * 启动装配：注册 /dsh-peek/meta 与 /dsh-peek/file 两个同源路由（webServer 公开契约）。
 * @param ctx - Cordis 上下文（webServer 由 inject 保证就绪）
 */
export function apply(ctx) {
  const webServer = ctx.webServer

  ctx.effect(() => {
    const disposers = [
      webServer.register({
        kind: 'exact',
        path: '/dsh-peek/meta',
        handler: async (req, res) => {
          try {
            const abs = await resolvePath(ctx, queryOf(req).path)
            const info = await stat(abs)
            if (!info.isFile()) throw new Error('not a regular file')
            const ext = extname(abs).toLowerCase()
            sendJson(res, 200, {
              ok: true,
              name: basename(abs),
              size: info.size,
              mime: mimeOf(ext),
              kind: kindOf(ext),
              ext,
              previewable: info.size <= MAX_PREVIEW_BYTES,
            })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/dsh-peek/file',
        handler: async (req, res) => {
          try {
            const abs = await resolvePath(ctx, queryOf(req).path)
            const info = await stat(abs)
            if (!info.isFile()) throw new Error('not a regular file')
            if (info.size > MAX_PREVIEW_BYTES) {
              sendJson(res, 413, { ok: false, error: 'file too large to preview inline; download instead', size: info.size })
              return
            }
            const ext = extname(abs).toLowerCase()
            res.writeHead(200, {
              'content-type': mimeOf(ext),
              'content-length': String(info.size),
              'content-disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(basename(abs)),
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            })
            const stream = createReadStream(abs)
            stream.on('error', () => {
              try { res.destroy() } catch { /* noop */ }
            })
            stream.pipe(res)
          } catch (err) {
            sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/dsh-peek/styles.css',
        handler: (req, res) => {
          res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
          res.end(STYLES_CSS)
        },
      }),
    ]
    console.log('[dsh-peek] preview routes registered: /dsh-peek/meta | /dsh-peek/file | /dsh-peek/styles.css')
    return () => { for (const d of disposers) d() }
  }, 'dsh-peek: preview routes')
}
