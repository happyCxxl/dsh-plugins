// 发布前校验：确保 package.json 的 files 白名单覆盖所有运行时需要的文件。
// 用法：在插件包根目录（package.json 所在目录）运行 `node ../../scripts/check-publish-files.mjs`
// 建议通过 "prepublishOnly" 脚本挂接：npm publish 前 npm 会自动执行。
// 校验项：
//   1. lib 下所有 JS 的本地相对 import（'./...'）目标文件都在 files 白名单内；
//   2. package.json exports 的每个目标都在 files 白名单内（package.json 自身除外，npm 恒打包）；
//   3. dsh.bundle.patch 指向的补丁文件在 files 白名单内。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, posix } from 'node:path'

const root = process.cwd()
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const files = pkg.files ?? []
const errors = []

// npm 恒打包且无需声明白名单的文件
const alwaysIncluded = ['package.json']
for (const name of ['README', 'LICENSE', 'LICENCE']) {
  alwaysIncluded.push(name + '.md', name, name + '.txt')
}
if (typeof pkg.main === 'string') alwaysIncluded.push(pkg.main)

const toPosix = (p) => p.split('\\').join('/')

function coveredByFiles(path) {
  const rel = posix.normalize(toPosix(relative(root, path)))
  if (alwaysIncluded.includes(rel)) return true
  return files.some((entry) => {
    const clean = posix.normalize(entry.replace(/\/+$/, ''))
    return rel === clean || rel.startsWith(clean + '/')
  })
}

function checkFile(path, reason) {
  if (!existsSync(path)) {
    errors.push(`${reason}: 文件不存在 ${toPosix(relative(root, path))}`)
    return
  }
  if (!coveredByFiles(path)) {
    errors.push(`${reason}: 未包含在 files 白名单 → ${toPosix(relative(root, path))}（请在 package.json 的 "files" 中补充）`)
  }
}

// 1) lib 目录的本地 import
const libDir = join(root, 'lib')
if (existsSync(libDir)) {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) {
        const text = readFileSync(full, 'utf8')
        const re = /(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g
        let m
        while ((m = re.exec(text)) !== null) {
          const target = m[1]
          if (target.startsWith('..')) continue // 包外引用不打包（peer/宿主提供）
          const resolved = join(dir, target)
          const candidates = [resolved, resolved + '.js', resolved + '.mjs', join(resolved, 'index.js')]
          const hit = candidates.find((c) => existsSync(c) && statSync(c).isFile())
          if (hit === undefined) {
            errors.push(`本地 import 解析失败: ${toPosix(relative(root, full))} → '${target}'`)
            continue
          }
          checkFile(hit, `import 目标 ${toPosix(relative(root, full))}`)
        }
      }
    }
  }
  walk(libDir)
}

// 2) exports 目标
if (pkg.exports && typeof pkg.exports === 'object') {
  const targets = Object.values(pkg.exports)
    .flatMap((v) => {
      if (typeof v === 'string') return [v]
      if (v && typeof v === 'object') return Object.values(v).filter((x) => typeof x === 'string')
      return []
    })
    .map((v) => v.replace(/^\.\//, ''))
  for (const t of targets) {
    const full = join(root, t)
    checkFile(full, `exports 目标 "./${t}"`)
  }
}

// 3) dsh.bundle.patch
const patch = pkg.dsh?.bundle?.patch
if (typeof patch === 'string') checkFile(join(root, patch.replace(/^\.\//, '')), 'dsh.bundle.patch 文件')

if (errors.length > 0) {
  console.error(`[check-publish-files] ${pkg.name} 发布校验失败（${errors.length} 项）：`)
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log(`[check-publish-files] ${pkg.name} OK：files 白名单覆盖全部本地 import / exports / bundle.patch`)
