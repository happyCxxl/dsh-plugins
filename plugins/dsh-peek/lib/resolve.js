// resolve.js — 把客户端传来的（绝对或相对）路径解析成 node:fs 可打开的绝对路径。
//
// 相对路径的来源：工具卡片里的路径被 harness 剥掉了 workspace 根，因此按
// 「每个 workspace 根 + 进程 cwd」逐候选尝试，取第一个真实存在的文件。
import { stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export async function resolvePath(ctx, raw) {
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
