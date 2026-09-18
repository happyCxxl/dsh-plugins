// dsh-peek Host 侧：通过 webServer 暴露两个同源路由，让浏览器端预览 DSH 生成的任意文件。
//
// 为什么必须有宿主侧：客户端插件跑在浏览器里，读不到本地文件；只能由宿主读文件、
// 再经 HTTP 路由喂给页面（与 dsh-terminal / dsh-sqlite / dsh-ui-restyle 同一套 webServer 机制）。
//
// 路径解析：绝对路径直接用；相对路径（工具卡片里的路径被 relativizeToCwd 剥掉了
// workspace 根）按「每个 workspace 根 + 进程 cwd」做候选，取第一个真实存在的文件。
//
// 依赖策略：只用 Node 内置模块 + ctx 服务，不 import 任何 harness 包 ——
// 避免进程内出现第二份 cordis / dsh-tools 导致 Symbol 分裂（见仓库 dev-notes B5）。

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

export const name = 'dsh-peek'

// webServer 是硬依赖（对外提供预览路由）。
export const inject = ['webServer']

/** 单文件内嵌预览上限（字节）。超过就走下载，而不是塞进页面。 */
const MAX_PREVIEW_BYTES = 512 * 1024 * 1024

/** 扩展名 → MIME（供浏览器直接渲染的类型必须给对 Content-Type）。 */
const MIME = {
  // 图片
  '.png': 'image/png', '.apng': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.cur': 'image/x-icon',
  '.avif': 'image/avif',
  '.jxl': 'image/jxl',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.svg': 'image/svg+xml',
  // 文档
  '.html': 'text/html', '.htm': 'text/html',
  '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.pdf': 'application/pdf',
  // 字体
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.ttc': 'font/collection',
  // 文本 / 代码
  '.txt': 'text/plain', '.log': 'text/plain',
  '.json': 'application/json', '.jsonl': 'application/json',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
  '.ts': 'text/plain', '.tsx': 'text/plain', '.jsx': 'text/plain',
  '.css': 'text/css', '.scss': 'text/plain', '.less': 'text/plain',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.xml': 'application/xml',
  '.yaml': 'text/plain', '.yml': 'text/plain',
  '.toml': 'text/plain', '.ini': 'text/plain',
  '.env': 'text/plain', '.properties': 'text/plain', '.conf': 'text/plain', '.cfg': 'text/plain',
  '.sh': 'text/plain', '.bash': 'text/plain', '.zsh': 'text/plain',
  '.bat': 'text/plain', '.cmd': 'text/plain',
  '.ps1': 'text/plain',
  '.py': 'text/plain', '.rb': 'text/plain', '.go': 'text/plain', '.rs': 'text/plain',
  '.java': 'text/plain', '.kt': 'text/plain', '.swift': 'text/plain',
  '.c': 'text/plain', '.h': 'text/plain', '.cpp': 'text/plain', '.hpp': 'text/plain', '.cc': 'text/plain',
  '.cs': 'text/plain',
  '.sql': 'text/plain',
  '.vue': 'text/plain', '.svelte': 'text/plain',
  '.php': 'text/plain',
  '.lua': 'text/plain',
  '.tex': 'text/plain', '.rst': 'text/plain', '.mdx': 'text/plain',
  '.graphql': 'text/plain', '.gql': 'text/plain', '.proto': 'text/plain',
  '.sol': 'text/plain', '.dart': 'text/plain', '.scala': 'text/plain',
  '.clj': 'text/plain', '.ex': 'text/plain', '.exs': 'text/plain', '.hs': 'text/plain',
  '.pl': 'text/plain', '.r': 'text/plain',
  '.rtf': 'application/rtf',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
}

const IMAGE_EXT = new Set(['.png', '.apng', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.bmp', '.ico', '.cur', '.avif', '.jxl', '.heic', '.heif'])
const FONT_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot', '.ttc'])
const CSV_EXT = new Set(['.csv', '.tsv'])
// 客户端自行 fetch 文本后渲染（Markdown / 代码 / 纯文本）。
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.log', '.json', '.jsonl', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.css', '.scss', '.less', '.xml', '.yaml', '.yml', '.toml', '.ini', '.env', '.properties', '.conf', '.cfg',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.sql', '.vue', '.svelte', '.php', '.lua', '.tex', '.rst', '.mdx',
  '.graphql', '.gql', '.proto', '.sol', '.dart', '.scala', '.clj', '.ex', '.exs', '.hs', '.pl', '.r', '.rtf',
])

function mimeOf(ext) {
  return MIME[ext] ?? 'application/octet-stream'
}

function kindOf(ext) {
  if (ext === '.svg') return 'svg'
  if (ext === '.html' || ext === '.htm') return 'html'
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.pdf') return 'pdf'
  if (FONT_EXT.has(ext)) return 'font'
  if (CSV_EXT.has(ext)) return 'csv'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (TEXT_EXT.has(ext)) return ext === '.txt' || ext === '.log' ? 'text' : 'code'
  return 'other'
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function queryOf(req) {
  return Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams.entries())
}

/** 把（绝对或相对）路径解析成 node:fs 可打开的绝对路径；相对路径按 workspace 根 + 进程 cwd 逐候选尝试。 */
async function resolvePath(ctx, raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('missing path')
  if (isAbsolute(raw)) return resolve(raw)

  const roots = []
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined) {
    try {
      for (const w of await registry.list()) {
        if (w && typeof w.path === 'string' && w.path !== '') roots.push(w.path)
      }
    } catch { /* 拿不到 workspace 列表就只用进程 cwd */ }
  }
  roots.push(process.cwd())

  const candidates = roots.map((root) => join(root, raw))
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return candidate
    } catch { /* 不存在，试下一个 */ }
  }
  return candidates[0] ?? resolve(raw)
}

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
    ]
    console.log('[dsh-peek] preview routes registered: /dsh-peek/meta | /dsh-peek/file')
    return () => { for (const d of disposers) d() }
  }, 'dsh-peek: preview routes')
}
