window.__ModuleLoader__.load({
  id: '@cxxl/dsh-peek',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { CodeBlock } = require('@deepseek-ai/dsh-client-ui-primitives')

    // =========================================================================
    // dsh-peek 客户端 v0.3 —— 「预览」视图（tab），唤醒式纯预览面。
    //
    // 与「对话」「轨迹」并列，但它不是常驻浏览列表，而是一个「被唤醒」的预览面：
    // 用户在对话里点击某个文件产物（本轮产出的 chips / 正文行内代码提及）时，
    // 拦截这次点击、记住路径，并切到「预览」tab 直接预览那一个文件（而不是
    // openFile 打开本地/浏览器）。
    //
    // 渲染分派（按扩展名）：图片/svg → <img>；html → sandbox iframe；markdown →
    // 轻量渲染；代码/文本 → <pre>；pdf → iframe；音视频 → 原生标签；其它 → 下载。
    // =========================================================================

    const META_URL = '/dsh-peek/meta'
    const FILE_URL = '/dsh-peek/file'

    const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif'])
    const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac'])
    const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v'])
    const TEXT_KINDS = new Set(['markdown', 'code', 'text', 'html', 'csv'])

    // =========================================================================
    // 工具
    // =========================================================================
    function basename(path) {
      const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      return at === -1 ? path : path.slice(at + 1)
    }
    function humanSize(n) {
      if (!Number.isFinite(n)) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    // =========================================================================
    // 唤醒状态：点击文件 → 记住路径 → 切到「预览」tab。
    // =========================================================================
    const previewStore = {
      path: null,
      listeners: [],
      get() { return this.path },
      set(path) { this.path = path; for (const f of this.listeners.slice()) f() },
      subscribe(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn) } },
    }

    function usePreviewPath() {
      const [path, setPath] = React.useState(previewStore.get())
      React.useEffect(() => previewStore.subscribe(() => setPath(previewStore.get())), [])
      return path
    }

    // =========================================================================
    // 文件点击拦截（捕获阶段，全局常驻）
    // =========================================================================
    function looksLikePath(s) {
      if (typeof s !== 'string' || s.trim() === '') return false
      if (/[\\/]/.test(s)) return true
      return /\.[A-Za-z0-9]{1,6}$/.test(s.trim())
    }

    function findFileTitle(target) {
      let el = target
      while (el && el !== document.body) {
        if (typeof el.getAttribute === 'function') {
          const title = el.getAttribute('title')
          if (looksLikePath(title)) return { el, path: title }
        }
        el = el.parentElement
      }
      return null
    }

    function switchToPreviewTab() {
      const tabs = document.querySelectorAll('[role="tab"]')
      for (const tab of tabs) {
        if ((tab.textContent || '').trim() === '预览') {
          tab.click()
          return true
        }
      }
      return false
    }

    function findToolFileLink(target) {
      let el = target
      while (el && el !== document.body) {
        if (el.tagName === 'BUTTON' && typeof el.closest === 'function') {
          const row = el.closest('[data-tool]')
          if (row !== null) {
            const tool = row.getAttribute('data-tool')
            if (tool === 'read' || tool === 'write' || tool === 'edit') {
              const text = (el.textContent || '').trim()
              if (looksLikePath(text)) return { el, path: text }
            }
          }
        }
        el = el.parentElement
      }
      return null
    }

    function handleDocumentClick(e) {
      // 1) 产物 chips / 行内提及：带 title 的文件引用
      const hit = findFileTitle(e.target)
      if (hit !== null && hit.el.closest('[data-chat-flow-kind], [data-produced-files-row]')) {
        e.preventDefault()
        e.stopPropagation()
        previewStore.set(hit.path)
        switchToPreviewTab()
        return
      }
      // 2) 工具卡片（write/edit/read）里的文件路径按钮：无 title，文本是相对路径
      const link = findToolFileLink(e.target)
      if (link !== null) {
        e.preventDefault()
        e.stopPropagation()
        previewStore.set(link.path)
        switchToPreviewTab()
      }
    }

    // =========================================================================
    // 轻量 Markdown 渲染（精简版）
    // =========================================================================
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }
    function safeUrl(u) {
      return (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u) ? u : '#')
    }
    function renderMarkdown(src) {
      const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
      const out = []
      let i = 0
      let inCode = false
      let codeBuf = []
      let codeLang = ''
      let listType = null
      let listBuf = []

      const flushList = () => {
        if (listType === null) return
        out.push('<' + listType + '>' + listBuf.join('') + '</' + listType + '>')
        listType = null
        listBuf = []
      }
      const inline = (text) => {
        let s = escapeHtml(text)
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
        s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => '<img alt="' + alt + '" src="' + safeUrl(url) + '">')
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener">' + label + '</a>')
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
        s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
        s = s.replace(/(^|[^_])_([^_]+)_(?![_])/g, '$1<em>$2</em>')
        return s
      }

      while (i < lines.length) {
        const line = lines[i]
        if (inCode) {
          if (/^\s*```/.test(line)) {
            out.push('<pre><code' + (codeLang ? ' class="lang-' + escapeHtml(codeLang) + '"' : '') + '>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>')
            inCode = false
            codeBuf = []
            codeLang = ''
          } else {
            codeBuf.push(line)
          }
          i += 1
          continue
        }
        if (/^\s*```/.test(line)) {
          flushList()
          const m = line.match(/^\s*```(.*)$/)
          codeLang = (m ? m[1] : '').trim()
          inCode = true
          codeBuf = []
          i += 1
          continue
        }
        const h = line.match(/^(#{1,6})\s+(.*)$/)
        if (h) {
          flushList()
          out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>')
          i += 1
          continue
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          flushList()
          out.push('<hr>')
          i += 1
          continue
        }
        if (/^\s*>\s?/.test(line)) {
          flushList()
          out.push('<blockquote>' + inline(line.replace(/^\s*>\s?/, '')) + '</blockquote>')
          i += 1
          continue
        }
        const ul = line.match(/^\s*[-*+]\s+(.*)$/)
        const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
        if (ul || ol) {
          const type = ul ? 'ul' : 'ol'
          const content = inline(ul ? ul[1] : ol[1])
          if (listType !== type) { flushList(); listType = type }
          listBuf.push('<li>' + content + '</li>')
          i += 1
          continue
        }
        if (/^\s*$/.test(line)) {
          flushList()
          i += 1
          continue
        }
        flushList()
        out.push('<p>' + inline(line) + '</p>')
        i += 1
      }
      if (inCode) out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>')
      flushList()
      return out.join('')
    }

    // =========================================================================
    // CSV / TSV → 表格
    // =========================================================================
    function parseCsv(text, delimiter) {
      const rows = []
      let row = []
      let field = ''
      let inQuotes = false
      const d = delimiter || ','
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
          } else field += ch
        } else {
          if (ch === '"') inQuotes = true
          else if (ch === d) { row.push(field); field = '' }
          else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
          else if (ch !== '\r') field += ch
        }
      }
      if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
      return rows
    }

    function CsvTable(props) {
      const text = props.text
      const ext = props.ext
      const delimiter = ext === '.tsv' ? '\t' : ','
      const rows = parseCsv(text, delimiter)
      const MAX_ROWS = 500
      const shown = rows.slice(0, MAX_ROWS)
      const truncated = rows.length > MAX_ROWS
      return React.createElement('div', { className: 'dsp-csv' },
        React.createElement('table', { className: 'dsp-table' },
          React.createElement('tbody', null,
            shown.map((row, ri) => React.createElement('tr', { key: ri },
              row.map((cell, ci) => React.createElement(ri === 0 ? 'th' : 'td', { key: ci }, cell)),
            )),
          ),
        ),
        truncated ? React.createElement('div', { className: 'dsp-csv-more' }, '（共 ' + rows.length + ' 行，仅显示前 ' + MAX_ROWS + ' 行）') : null,
      )
    }

    // =========================================================================
    // 字体预览（渲染字符样本）
    // =========================================================================
    function FontPreview(props) {
      const path = props.path
      const name = props.name
      const family = 'dsp-preview-font'
      const fontUrl = FILE_URL + '?path=' + encodeURIComponent(path)
      const css = "@font-face { font-family: '" + family + "'; src: url('" + fontUrl + "'); }"
      return React.createElement('div', { className: 'dsp-font' },
        React.createElement('style', null, css),
        React.createElement('div', { className: 'dsp-font-name' }, name),
        React.createElement('div', { className: 'dsp-font-specimen', style: { fontFamily: "'" + family + "', sans-serif" } },
          React.createElement('div', { className: 'dsp-font-big' }, 'Aa Bb Cc 0123'),
          React.createElement('div', { className: 'dsp-font-line' }, 'The quick brown fox jumps over the lazy dog'),
          React.createElement('div', { className: 'dsp-font-line' }, '敏捷的棕色狐狸跳过懒惰的狗 0123456789'),
          React.createElement('div', { className: 'dsp-font-line' }, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
          React.createElement('div', { className: 'dsp-font-line' }, 'abcdefghijklmnopqrstuvwxyz'),
        ),
      )
    }

    // =========================================================================
    // 预览体：拉取 meta + 内容，按 kind 渲染。
    // =========================================================================
    function PreviewBody(props) {
      const path = props.path
      const [phase, setPhase] = React.useState('loading') // loading | ready | error
      const [meta, setMeta] = React.useState(null)
      const [text, setText] = React.useState('')
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        setPhase('loading')
        setError('')
        setMeta(null)
        setText('')
        ;(async () => {
          try {
            const mr = await fetch(META_URL + '?path=' + encodeURIComponent(path)).then((r) => r.json())
            if (!alive) return
            if (!mr || !mr.ok) { setError((mr && mr.error) || '无法读取文件'); setPhase('error'); return }
            setMeta(mr)
            if (!mr.previewable) {
              setError('文件过大（' + humanSize(mr.size) + '），请改用下载')
              setPhase('error')
              return
            }
            if (TEXT_KINDS.has(mr.kind)) {
              const t = await fetch(FILE_URL + '?path=' + encodeURIComponent(path)).then((r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status)
                return r.text()
              })
              if (!alive) return
              setText(t)
            }
            setPhase('ready')
          } catch (err) {
            if (!alive) return
            setError((err && err.message) || String(err))
            setPhase('error')
          }
        })()
        return () => { alive = false }
      }, [path])

      const fileUrl = FILE_URL + '?path=' + encodeURIComponent(path)
      const name = meta ? meta.name : basename(path)

      function renderBody() {
        if (phase === 'loading') return React.createElement('div', { className: 'dsp-status' }, '加载中…')
        if (phase === 'error') return React.createElement('div', { className: 'dsp-status dsp-error' }, error)
        const kind = meta ? meta.kind : 'other'
        switch (kind) {
          case 'image':
          case 'svg':
            return React.createElement('div', { className: 'dsp-mediawrap' },
              React.createElement('img', { className: 'dsp-media', src: fileUrl, alt: name }),
            )
          case 'html':
            return React.createElement('iframe', { className: 'dsp-frame', sandbox: 'allow-scripts', srcDoc: text, title: name })
          case 'markdown':
            return React.createElement('div', { className: 'dsp-md', dangerouslySetInnerHTML: { __html: renderMarkdown(text) } })
          case 'code':
            return React.createElement(CodeBlock, {
              code: text,
              lang: meta && meta.ext ? meta.ext.slice(1) : '',
              copyLabel: '复制',
              copiedLabel: '已复制',
            })
          case 'text':
            return React.createElement('pre', { className: 'dsp-code' }, text)
          case 'pdf':
            return React.createElement('iframe', { className: 'dsp-frame', src: fileUrl, title: name })
          case 'font':
            return React.createElement(FontPreview, { path, name })
          case 'csv':
            return React.createElement(CsvTable, { text, ext: meta ? meta.ext : '' })
          default:
            return React.createElement('div', { className: 'dsp-other' },
              React.createElement('p', null, '该类型无法内嵌预览（' + (meta ? (meta.ext || meta.kind) : 'unknown') + '）'),
              React.createElement('a', { className: 'dsp-download', href: fileUrl, download: name }, '下载文件'),
            )
        }
      }

      return React.createElement('div', { className: 'dsp-detail' },
        React.createElement('div', { className: 'dsp-detail-head' },
          React.createElement('span', { className: 'dsp-detail-title', title: path }, name),
          meta && meta.size !== undefined && React.createElement('span', { className: 'dsp-detail-size' }, humanSize(meta.size)),
        ),
        React.createElement('div', { className: 'dsp-detail-body' }, renderBody()),
      )
    }

    // =========================================================================
    // 「预览」视图（tab）：纯预览面，只显示当前点击的那一个文件。
    // =========================================================================
    function PreviewView() {
      const path = usePreviewPath()

      // 预览激活时：隐藏底部输入框；离开（卸载）时：清除预览状态、让「预览」tab 消失。
      React.useEffect(() => {
        document.body.classList.add('dsp-peek-active')
        return () => {
          document.body.classList.remove('dsp-peek-active')
          previewStore.set(null)
        }
      }, [])

      if (path === null) {
        return React.createElement('div', { className: 'dsp-view' },
          React.createElement('div', { className: 'dsp-empty' }, '点击对话里的文件，在这里预览'),
        )
      }
      return React.createElement('div', { className: 'dsp-view' },
        React.createElement(PreviewBody, { path }),
      )
    }

    // =========================================================================
    // 样式
    // =========================================================================
    const CSS = `
.dsp-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dsp-empty { padding: 28px 16px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-dimmed, #8a8f98); }
.dsp-detail { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dsp-detail-head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2c30); flex: none;
}
.dsp-detail-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, #e6e8eb);
  font-family: var(--dsw-font-family-code, Consolas, 'Cascadia Mono', monospace);
}
.dsp-detail-size { flex: none; font-size: 11px; color: var(--dsw-alias-label-dimmed, #8a8f98); }
.dsp-detail-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px; }
.dsp-mediawrap { display: flex; align-items: center; justify-content: center; min-height: 200px; height: 100%; }
.dsp-media { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; object-fit: contain; }
.dsp-frame { width: 100%; height: 100%; border: 0; background: #fff; border-radius: 6px; }
.dsp-code {
  margin: 0; font-family: var(--dsw-font-family-code, Consolas, 'Cascadia Mono', monospace);
  font-size: 12.5px; line-height: 1.55; white-space: pre; overflow: auto;
  color: var(--dsw-alias-label-secondary, #e6e8eb);
}
.dsp-md { font-size: 14px; line-height: 1.7; max-width: 860px; color: var(--dsw-alias-label-primary, #f2f3f5); }
.dsp-md h1, .dsp-md h2, .dsp-md h3, .dsp-md h4 { margin: 1.2em 0 .5em; line-height: 1.3; }
.dsp-md h1 { font-size: 1.6em; } .dsp-md h2 { font-size: 1.35em; } .dsp-md h3 { font-size: 1.15em; }
.dsp-md p { margin: .6em 0; }
.dsp-md code { font-family: var(--dsw-font-family-code, Consolas, monospace); font-size: .88em; background: var(--dsw-alias-bg-base, #101113); padding: 1px 5px; border-radius: 4px; }
.dsp-md pre { background: var(--dsw-alias-bg-base, #101113); border: 1px solid var(--dsw-alias-border-l2, #2a2c30); border-radius: 8px; padding: 12px 14px; overflow: auto; }
.dsp-md pre code { background: none; padding: 0; }
.dsp-md blockquote { border-left: 3px solid var(--dsw-static-deepseek-400, #679efe); margin: .7em 0; padding: 2px 14px; color: var(--dsw-alias-label-tertiary, #b7bcc4); }
.dsp-md ul, .dsp-md ol { padding-left: 1.4em; margin: .6em 0; }
.dsp-md a { color: var(--dsw-static-deepseek-400, #679efe); }
.dsp-md img { max-width: 100%; }
.dsp-md hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l2, #2a2c30); margin: 1.2em 0; }
.dsp-status { color: var(--dsw-alias-label-dimmed, #8a8f98); padding: 28px 0; text-align: center; font-size: 13px; }
.dsp-error { color: var(--dsw-alias-state-error-primary, #f14c4c); }
.dsp-other { text-align: center; padding: 36px 0; }
.dsp-other p { color: var(--dsw-alias-label-tertiary, #b7bcc4); font-size: 13px; margin-bottom: 16px; }
.dsp-download {
  display: inline-block; padding: 8px 18px; border-radius: 8px;
  background: var(--dsw-static-deepseek-400, #679efe); color: #fff;
  text-decoration: none; font-size: 13px; font-weight: 500;
}
.dsp-download:hover { filter: brightness(1.06); }
/* CSV 表格 */
.dsp-csv { overflow: auto; }
.dsp-table { border-collapse: collapse; font-size: 12.5px; font-family: var(--dsw-font-family-code, Consolas, 'Cascadia Mono', monospace); }
.dsp-table th, .dsp-table td {
  border: 1px solid var(--dsw-alias-border-l2, #2a2c30);
  padding: 4px 10px; text-align: left; white-space: nowrap;
}
.dsp-table th { background: var(--dsw-alias-bg-base, #101113); color: var(--dsw-alias-label-secondary, #e6e8eb); font-weight: 600; position: sticky; top: 0; }
.dsp-table td { color: var(--dsw-alias-label-secondary, #e6e8eb); }
.dsp-csv-more { padding: 10px 0 0; font-size: 12px; color: var(--dsw-alias-label-dimmed, #8a8f98); }
/* 字体预览 */
.dsp-font { padding: 8px 0; }
.dsp-font-name { font-size: 12px; color: var(--dsw-alias-label-dimmed, #8a8f98); margin-bottom: 14px; font-family: var(--dsw-font-family-code, Consolas, monospace); }
.dsp-font-specimen { line-height: 1.6; color: var(--dsw-alias-label-primary, #f2f3f5); }
.dsp-font-big { font-size: 42px; margin-bottom: 18px; }
.dsp-font-line { font-size: 20px; margin-bottom: 10px; }

/* 预览激活时隐藏底部输入框 */
body.dsp-peek-active [data-composer-seat] { display: none !important; }
/* 「预览」tab 非激活时消失（激活时显示） */
[role="tab"][data-dsp-peek-tab][aria-selected="false"] { display: none !important; }
`

    function injectCss(ctx) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-peek'
      tag.textContent = CSS
      document.head.appendChild(tag)
      ctx.effect(() => () => tag.remove(), 'dsh-peek: stylesheet')
    }

    // =========================================================================
    // apply
    // =========================================================================
    function apply(ctx) {
      injectCss(ctx)

      // 先注册「预览」tab（核心，放最前，保证不会被后续步骤的失败连累）。
      // order 20 → 排在「对话」(0)「轨迹」(10) 之后，即第三个。
      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: 'preview', order: 20, label: '预览' },
        () => React.createElement(PreviewView),
      ))

      // 给「预览」tab 打标记，配合 CSS 实现「非激活时消失」。
      const tagPreviewTab = () => {
        const tabs = document.querySelectorAll('[role="tab"]')
        for (const tab of tabs) {
          if ((tab.textContent || '').trim() === '预览') {
            tab.setAttribute('data-dsp-peek-tab', '')
          }
        }
      }
      ctx.effect(() => {
        tagPreviewTab()
        const observer = new MutationObserver(() => tagPreviewTab())
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-selected'],
        })
        return () => observer.disconnect()
      }, 'dsh-peek: tab tagging')

      // 再注册全局点击拦截（捕获阶段），并做容错：即便失败也不影响 tab。
      try {
        ctx.effect(() => {
          document.addEventListener('click', handleDocumentClick, true)
          return () => document.removeEventListener('click', handleDocumentClick, true)
        }, 'dsh-peek: file-click interception')
      } catch (err) {
        console.error('[dsh-peek] click interception setup failed:', err)
      }

      console.log('[dsh-peek] client apply done')
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.name = 'dsh-peek'
    return module.exports
  },
})
