// dsh-ui-restyle Host 侧：只做一件事 —— 把插件自带的字体喂给页面。
//
// 为什么必须有宿主侧：客户端插件跑在浏览器里，读不到包内文件；字体只能由宿主
// 注册 HTTP 路由对外提供（与 dsh-sqlite 面板同一套 webServer 机制）。
//
// 依赖策略：只用 Node 内置模块，不 import 任何 harness 包 —— 避免进程内出现
// 第二份 cordis / dsh-tools 导致 Symbol 分裂（见仓库 dev-notes B5）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const name = 'dsh-ui-restyle'

// webServer 是硬依赖：没有它就发不出字体。声明为 inject（而非 ctx.get 静默跳过），
// 是为了让挂载失败可见，而不是插件悄悄失效（dev-notes 里记过这个坑）。
export const inject = ['webServer']

/** 字体目录：本文件在 lib/ 下，字体在包根的 fonts/。 */
const FONT_DIR = fileURLToPath(new URL('../fonts/', import.meta.url))

/** 对外提供的字体文件名。客户端 @font-face 的 URL 必须与之一致。 */
const FONTS = ['inter-var-latin.woff2', 'jetbrains-mono-var-latin.woff2']

/**
 * 字体路由前缀。客户端通过 `${FONT_ROUTE_PREFIX}<file>` 取字体。
 * 用独立前缀而非 /plugins，避免与 client-modules 的 bundle 路由混淆。
 */
const FONT_ROUTE_PREFIX = '/dsh-ui-restyle/fonts/'

export function apply(ctx) {
  const webServer = ctx.webServer

  // 启动时一次性读进内存：字体内容不可变，没必要每次请求都碰磁盘。
  const blobs = new Map()
  for (const file of FONTS) {
    try {
      blobs.set(file, readFileSync(join(FONT_DIR, file)))
    } catch {
      // 缺文件只跳过该字体（页面会回落到系统字体），不阻断插件挂载。
    }
  }

  ctx.effect(() => {
    const disposers = [...blobs].map(([file, body]) => webServer.register({
      kind: 'exact',
      path: FONT_ROUTE_PREFIX + file,
      handler: (req, res) => {
        // 字体不可变：长期缓存，省掉每次开页面的往返。
        res.writeHead(200, {
          'content-type': 'font/woff2',
          'content-length': String(body.byteLength),
          'cache-control': 'public, max-age=31536000, immutable',
        })
        res.end(body)
      },
    }))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-ui-restyle: font routes')
}
