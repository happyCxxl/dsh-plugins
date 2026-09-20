// mime.js — 文件类型表：MIME 映射与格式声明（EXT_KIND）。
// 供 dsh-peek 路由使用：mimeOf 决定响应 Content-Type；kindOf 决定客户端预览策略。
// 新增格式：在 EXT_KIND 登记（需要正确 Content-Type 时一并补 MIME），客户端加对应渲染分支。

/** 扩展名 → MIME（供浏览器直接渲染的类型必须给对 Content-Type）。 */
export const MIME = {
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
  '.wasm': 'application/wasm',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
}

// 格式声明：扩展名 → 预览策略。客户端按 kind 渲染；未声明的格式返回 unsupported
// （客户端仅提示「暂不支持」，不渲染、不下载）。新增格式：在此登记 + 客户端加渲染分支。
export const EXT_KIND = {
  // 图片 → <img>（.svg 单独为 svg，同样 <img> 惰性渲染）
  '.png': 'image', '.apng': 'image', '.jpg': 'image', '.jpeg': 'image', '.jfif': 'image',
  '.gif': 'image', '.webp': 'image', '.bmp': 'image', '.ico': 'image', '.cur': 'image',
  '.avif': 'image', '.jxl': 'image', '.heic': 'image', '.heif': 'image',
  '.svg': 'svg',
  // 网页 → sandbox iframe
  '.html': 'html', '.htm': 'html',
  // Markdown → 原文 / 预览分屏
  '.md': 'markdown', '.markdown': 'markdown',
  // PDF → iframe
  '.pdf': 'pdf',
  // 字体 → 字符样本
  '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.otf': 'font', '.eot': 'font', '.ttc': 'font',
  // 表格 → CSV 表格
  '.csv': 'csv', '.tsv': 'csv',
  // 纯文本 → ReadBlock（无高亮）
  '.txt': 'text', '.log': 'text',
  // 代码 → ReadBlock（shiki 高亮；语言未登记时自动回退纯文本）
  '.js': 'code', '.mjs': 'code', '.cjs': 'code', '.ts': 'code', '.tsx': 'code', '.jsx': 'code',
  '.css': 'code', '.scss': 'code', '.less': 'code',
  '.json': 'code', '.jsonl': 'code', '.xml': 'code', '.yaml': 'code', '.yml': 'code',
  '.toml': 'code', '.ini': 'code', '.env': 'code', '.properties': 'code', '.conf': 'code', '.cfg': 'code',
  '.sh': 'code', '.bash': 'code', '.zsh': 'code', '.bat': 'code', '.cmd': 'code', '.ps1': 'code',
  '.py': 'code', '.rb': 'code', '.go': 'code', '.rs': 'code', '.java': 'code', '.kt': 'code',
  '.swift': 'code', '.c': 'code', '.h': 'code', '.cpp': 'code', '.hpp': 'code', '.cc': 'code',
  '.cs': 'code', '.sql': 'code', '.vue': 'code', '.svelte': 'code', '.php': 'code', '.lua': 'code',
  '.tex': 'code', '.rst': 'code', '.mdx': 'code',
  '.graphql': 'code', '.gql': 'code', '.proto': 'code', '.sol': 'code', '.dart': 'code',
  '.scala': 'code', '.clj': 'code', '.ex': 'code', '.exs': 'code', '.hs': 'code', '.pl': 'code',
  '.r': 'code',
}

export function mimeOf(ext) {
  return MIME[ext] ?? 'application/octet-stream'
}

export function kindOf(ext) {
  return EXT_KIND[ext] ?? 'unsupported'
}
