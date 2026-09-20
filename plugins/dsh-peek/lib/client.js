window.__ModuleLoader__.load({
  id: '@cxxl/dsh-peek',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { MarkdownText, ReadBlock, writeClipboard } = require('@deepseek-ai/dsh-client-ui-primitives')

    // =========================================================================
    // dsh-peek 客户端（0.5.3）
    //
    // 官方 Slot 体系 + 一处文档化约定偏差：
    //   - 预览面板：shell.overlay（官方覆盖层席位）——预览即浮层，与官方产品语言一致，
    //     不设独立「预览」视图
    //   - 每回合产物 chips：conversation.chat.turnTail 链（select 认领，官方链席位）
    //   - 产物路径推导：自注册 ConversationNodeDefinition（kind: dsh-peek-produced），
    //     逐回合累积 write/edit/str_replace_editor 成功产物，与 ui-deliverables 同款机制
    //   - 代码/文本：官方 ReadBlock（行号 + shiki 语法高亮，IDEA 式文件视图）
    //   - Markdown：左右分屏（左原文 / 右官方 MarkdownText 预览）
    //   - 约定偏差：官方 openFile 无接管钩子——以捕获阶段点击监听把官方产物 chips、
    //     行内文件提及与工具卡片（read/write/edit）路径改为内嵌预览（data-* 层经调研
    //     跨 20 个发布版零破坏）
    // Host 同源路由 /dsh-peek/meta|file（webServer 公开契约，见 docs/PLUGIN_SPEC.md §6）。
    // =========================================================================

    const META_URL = '/dsh-peek/meta'
    const FILE_URL = '/dsh-peek/file'
    const TEXT_KINDS = new Set(['markdown', 'code', 'text', 'html', 'csv'])
    const MD_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
    const READ_LABELS = {
      window: (shown, total) => '显示 ' + shown + ' / ' + total + ' 行',
      copy: '复制',
      copied: '已复制',
      collapseAria: '收起中间行',
      expandAria: (hidden) => '展开中间 ' + hidden + ' 行',
      collapse: '收起中间',
      expand: (hidden) => '展开中间 ' + hidden + ' 行',
    }
    const READ_MAX_LINES = 20000

    // =========================================================================
    // 预览状态（factory 作用域）：覆盖层面板读取。
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
    // 点击接管（约定偏差：官方 openFile 无接管钩子）
    // 目标：官方产物 chips / 行内文件提及（title 属性）、工具卡片（read/write/edit）
    // 文件路径。命中后改为内嵌预览弹窗，不再触发系统打开文件。
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
      const hit = findFileTitle(e.target)
      if (hit !== null && hit.el.closest('[data-chat-flow-kind], [data-produced-files-row]')) {
        e.preventDefault()
        e.stopPropagation()
        previewStore.set(hit.path)
        return
      }
      const link = findToolFileLink(e.target)
      if (link !== null) {
        e.preventDefault()
        e.stopPropagation()
        previewStore.set(link.path)
      }
    }

    // =========================================================================
    // 产物路径推导（纯 turn 数据，等价实现官方 deliverables 规则）
    // =========================================================================
    function mutationPath(name, argsRaw) {
      let args
      try {
        args = JSON.parse(argsRaw)
      } catch {
        return null
      }
      if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
      switch (name) {
        case 'write':
          return typeof args.content === 'string' ? pathValue(args.file_path) : null
        case 'edit':
          return validEditArgs(args) ? pathValue(args.file_path) : null
        case 'str_replace_editor':
          return editorMutationPath(args)
        default:
          return null
      }
    }
    function validEditArgs(args) {
      return typeof args.old_string === 'string'
        && args.old_string.length > 0
        && typeof args.new_string === 'string'
        && args.old_string !== args.new_string
        && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
    }
    function editorMutationPath(args) {
      const path = pathValue(args.path)
      if (path === null) return null
      switch (args.command) {
        case 'create':
          return typeof args.file_text === 'string' ? path : null
        case 'str_replace':
          return typeof args.old_str === 'string'
            && args.old_str.length > 0
            && (args.new_str === undefined || typeof args.new_str === 'string')
            ? path
            : null
        case 'insert':
          return typeof args.insert_line === 'number'
            && Number.isInteger(args.insert_line)
            && args.insert_line >= 0
            && typeof args.new_str === 'string'
            ? path
            : null
        default:
          return null
      }
    }
    function pathValue(value) {
      return typeof value === 'string' && value.trim().length > 0 ? value : null
    }

    // 与官方 isAppendSurfaceEvent 对 tool/result 的等价判断（surface.ts：type 命中 + surfaceOp==='append'）。
    function isAppendToolResult(event) {
      return event.type === 'tool/result' && event.surfaceOp === 'append'
    }

    const producedDefinition = {
      kind: 'dsh-peek-produced',
      match: (event) => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
        if (isAppendToolResult(event)) return { id: String(event.data.turn), role: 'update' }
        return null
      },
      start: (context, match) => {
        if (match.event.type !== 'turn/start') throw new Error('dsh-peek-produced start requires turn/start')
        return { turn: match.event.data.turn, calls: new Map(), produced: [] }
      },
      update: (context, match) => {
        if (match.event.type === 'tool/call') {
          const calls = new Map(context.state.calls)
          calls.set(String(match.event.data.callId), mutationPath(match.event.data.name, match.event.data.arguments))
          return { ...context.state, calls }
        }
        if (match.event.type !== 'tool/result') return context.state
        const result = match.event.data.message.content[0]
        if (result.isError === true) return context.state
        const callId = String(match.event.data.message.source.callId)
        const path = context.state.calls.get(callId)
        return path === null || path === undefined
          ? context.state
          : { ...context.state, produced: [...context.state.produced, { seq: match.event.seq, path }] }
      },
      buildLocationData: (context, scope, previous) => {
        if (scope !== 'turn' || context.state === undefined) return null
        if (previous?.kind === 'turn'
          && previous.turn === context.state.turn
          && previous.key === 'dsh-peek-produced'
          && previous.value.produced === context.state.produced) return previous
        return {
          kind: 'turn',
          turn: context.state.turn,
          key: 'dsh-peek-produced',
          value: { produced: context.state.produced },
        }
      },
    }

    function producedForClosing(data, seq) {
      if (data === undefined) return []
      const paths = []
      const seen = new Set()
      for (const produced of data.produced) {
        if (produced.seq > (seq === undefined ? Number.POSITIVE_INFINITY : seq) || seen.has(produced.path)) continue
        seen.add(produced.path)
        paths.push(produced.path)
      }
      return paths
    }

    // turnTail 链认领：仅当本回合有产物时挂出 chips 行。
    function selectProducedFiles(owner) {
      const paths = producedForClosing(owner.turn.data.get('dsh-peek-produced'), owner.seq)
      return paths.length === 0 ? null : paths
    }

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
    //   代码/文本 → 官方 ReadBlock（行号 + shiki 高亮，IDEA 式）；
    //   Markdown → 左右分屏：左原文 / 右官方 MarkdownText 预览。
    // =========================================================================
    function PreviewBody(props) {
      const path = props.path
      const [phase, setPhase] = React.useState('loading') // loading | ready | error
      const [meta, setMeta] = React.useState(null)
      const [text, setText] = React.useState('')
      const [error, setError] = React.useState('')
      const [copied, setCopied] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        setPhase('loading')
        setError('')
        setMeta(null)
        setText('')
        setCopied(false)
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
      const kind = meta ? meta.kind : 'other'
      const ext = meta && meta.ext ? meta.ext : ''
      const lang = ext.replace(/^\./, '')
      const isMarkdown = kind === 'markdown'
      const canCopy = phase === 'ready' && text !== '' && isMarkdown
      const lines = React.useMemo(() => {
        if (text === '') return []
        const raw = text.replace(/\r\n/g, '\n')
        const parts = raw.split('\n')
        if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
        return parts.map((line, i) => ({ number: i + 1, text: line }))
      }, [text])

      function doCopy() {
        if (!canCopy) return
        writeClipboard(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }).catch(() => {})
      }

      function renderBody() {
        if (phase === 'loading') return React.createElement('div', { className: 'dsp-status' }, '加载中…')
        if (phase === 'error') return React.createElement('div', { className: 'dsp-status dsp-error' }, error)
        switch (kind) {
          case 'image':
          case 'svg':
            return React.createElement('div', { className: 'dsp-mediawrap' },
              React.createElement('img', { className: 'dsp-media', src: fileUrl, alt: name }),
            )
          case 'html':
            return React.createElement('iframe', { className: 'dsp-frame', sandbox: 'allow-scripts', srcDoc: text, title: name })
          case 'markdown':
            return React.createElement('div', { className: 'dsp-split' },
              React.createElement('div', { className: 'dsp-split-src' },
                React.createElement('pre', { className: 'dsp-src' }, text),
              ),
              React.createElement('div', { className: 'dsp-split-preview' },
                React.createElement('div', { className: 'dsp-mdwrap' },
                  React.createElement(MarkdownText, { text, labels: MD_LABELS }),
                ),
              ),
            )
          case 'code':
          case 'text':
            return React.createElement('div', { className: 'dsp-readwrap' },
              React.createElement(ReadBlock, {
                label: path,
                lines,
                totalLines: lines.length,
                lang,
                maxLines: READ_MAX_LINES,
                labels: READ_LABELS,
              }),
            )
          case 'pdf':
            return React.createElement('iframe', { className: 'dsp-frame', src: fileUrl, title: name })
          case 'font':
            return React.createElement(FontPreview, { path, name })
          case 'csv':
            return React.createElement(CsvTable, { text, ext: ext })
          default:
            return React.createElement('div', { className: 'dsp-other' },
              React.createElement('p', null, '该类型无法内嵌预览（' + (meta ? (meta.ext || meta.kind) : 'unknown') + '）'),
              React.createElement('a', { className: 'dsp-download', href: fileUrl, download: name }, '下载文件'),
            )
        }
      }

      return React.createElement('div', { className: 'dsp-detail' },
        React.createElement('div', { className: 'dsp-bar' },
          React.createElement('span', { className: 'dsp-bar-title', title: path }, name),
          meta && meta.size !== undefined && React.createElement('span', { className: 'dsp-bar-size' }, humanSize(meta.size)),
          canCopy && React.createElement('button', {
            className: 'dsp-copy', type: 'button', onClick: doCopy,
          }, copied ? '已复制' : '复制'),
        ),
        React.createElement('div', { className: 'dsp-detail-body' }, renderBody()),
      )
    }

    // =========================================================================
    // 覆盖层：预览面板（shell.overlay 席位）。点遮罩关闭。
    // =========================================================================
    function PreviewOverlay() {
      const path = usePreviewPath()
      if (path === null) return null
      return React.createElement('div', {
        className: 'dsp-overlay',
        onClick: () => previewStore.set(null),
      },
        React.createElement('div', { className: 'dsp-overlay-panel', onClick: (e) => e.stopPropagation() },
          React.createElement('div', { className: 'dsp-overlay-head' },
            React.createElement('span', { className: 'dsp-overlay-title' }, '文件预览'),
            React.createElement('button', {
              className: 'dsp-overlay-close', type: 'button', 'aria-label': '关闭预览',
              onClick: () => previewStore.set(null),
            }, '×'),
          ),
          React.createElement('div', { className: 'dsp-overlay-body' },
            React.createElement(PreviewBody, { path }),
          ),
        ),
      )
    }

    // =========================================================================
    // turnTail 链：本回合产物 chips。点击 → 打开覆盖层预览。
    // =========================================================================
    function PeekChips(props) {
      const paths = props.matched || []
      if (paths.length === 0) return null
      return React.createElement('div', { className: 'dsp-chips' },
        React.createElement('span', { className: 'dsp-chips-label' }, '预览'),
        React.createElement('div', { className: 'dsp-chips-lane' },
          paths.map((path) => React.createElement('button', {
            key: path,
            type: 'button',
            className: 'dsp-chip',
            title: path,
            onClick: () => previewStore.set(path),
          }, basename(path))),
        ),
      )
    }

    // =========================================================================
    // 样式（插件自有样式表，随 fiber 回收；只定义自有组件的类，不碰宿主 DOM）
    // =========================================================================
    const CSS = `
.dsp-detail { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dsp-bar {
  display: flex; align-items: center; gap: 10px; flex: none;
  padding: 8px 16px; border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2c30);
}
.dsp-bar-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, #e6e8eb);
  font-family: var(--dsw-font-family-code, Consolas, 'Cascadia Mono', monospace);
}
.dsp-bar-size { flex: none; font-size: 11px; color: var(--dsw-alias-label-dimmed, #8a8f98); }
.dsp-copy {
  flex: none; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12));
  background: transparent; color: var(--dsw-alias-label-secondary, #666);
  cursor: pointer; padding: 3px 12px; border-radius: 6px; font-size: 12px;
}
.dsp-copy:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.16)); color: var(--dsw-alias-label-primary, #1a1a1a); }
.dsp-detail-body { flex: 1; min-height: 0; overflow: auto; }
/* Markdown 左右分屏 */
.dsp-split { display: flex; flex: 1; min-height: 0; }
.dsp-split-src {
  flex: 0 0 44%; min-width: 0; overflow: auto;
  border-right: 1px solid var(--dsw-alias-border-l2, #2a2c30);
}
.dsp-split-preview { flex: 1; min-width: 0; overflow: auto; }
.dsp-mdwrap { padding: 18px 26px 28px; font-size: 14px; line-height: 1.7; color: var(--dsw-alias-label-primary, #f2f3f5); }
.dsp-src {
  margin: 0; padding: 14px 20px 20px;
  font-family: var(--dsw-font-family-code, Consolas, 'Cascadia Mono', monospace);
  font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-all;
  color: var(--dsw-alias-label-secondary, #e6e8eb);
}
.dsp-readwrap { padding: 8px 0; }
.dsp-mediawrap { display: flex; align-items: center; justify-content: center; min-height: 200px; height: 100%; padding: 18px; }
.dsp-media { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; object-fit: contain; }
.dsp-frame { width: 100%; height: 100%; border: 0; background: #fff; }
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
/* 覆盖层面板 */
.dsp-overlay {
  position: absolute; inset: 0; background: rgba(0, 0, 0, .4);
  display: flex; align-items: center; justify-content: center; padding: 40px;
}
.dsp-overlay-panel {
  width: min(1040px, 100%); height: min(720px, 100%);
  background: var(--dsw-alias-bg-layer-1, #17181b);
  border: 1px solid var(--dsw-alias-border-l2, #2a2c30);
  border-radius: 14px; box-shadow: 0 24px 80px rgba(0, 0, 0, .55);
  display: flex; flex-direction: column; overflow: hidden;
}
.dsp-overlay-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--dsw-alias-border-l2, #2a2c30); flex: none; }
.dsp-overlay-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #f2f3f5); flex: 1; }
.dsp-overlay-close {
  background: transparent; border: none; color: var(--dsw-alias-label-tertiary, #b7bcc4);
  font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px;
}
.dsp-overlay-close:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.16)); color: var(--dsw-alias-label-primary, #f2f3f5); }
.dsp-overlay-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* turnTail chips */
.dsp-chips { display: flex; align-items: center; gap: 8px; padding: 2px 0; flex-wrap: wrap; }
.dsp-chips-label { font-size: 12px; color: var(--dsw-alias-label-dimmed, #8a8f98); flex: none; }
.dsp-chips-lane { display: flex; flex-wrap: wrap; gap: 6px; }
.dsp-chip {
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); background: transparent;
  color: var(--dsw-alias-label-secondary, #666); cursor: pointer; padding: 3px 10px;
  font-size: 12px; font-family: var(--dsw-font-family-code, Consolas, monospace); border-radius: 6px;
}
.dsp-chip:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.16)); color: var(--dsw-alias-label-primary, #1a1a1a); }
/* CSV 表格 */
.dsp-csv { overflow: auto; padding: 16px 22px; }
.dsp-table { border-collapse: collapse; font-size: 12.5px; font-family: var(--dsw-font-family-code, Consolas, 'Cascadia Mono', monospace); }
.dsp-table th, .dsp-table td {
  border: 1px solid var(--dsw-alias-border-l2, #2a2c30);
  padding: 4px 10px; text-align: left; white-space: nowrap;
}
.dsp-table th { background: var(--dsw-alias-bg-base, #101113); color: var(--dsw-alias-label-secondary, #e6e8eb); font-weight: 600; position: sticky; top: 0; }
.dsp-table td { color: var(--dsw-alias-label-secondary, #e6e8eb); }
.dsp-csv-more { padding: 10px 0 0; font-size: 12px; color: var(--dsw-alias-label-dimmed, #8a8f98); }
/* 字体预览 */
.dsp-font { padding: 20px 26px; }
.dsp-font-name { font-size: 12px; color: var(--dsw-alias-label-dimmed, #8a8f98); margin-bottom: 14px; font-family: var(--dsw-font-family-code, Consolas, monospace); }
.dsp-font-specimen { line-height: 1.6; color: var(--dsw-alias-label-primary, #f2f3f5); }
.dsp-font-big { font-size: 42px; margin-bottom: 18px; }
.dsp-font-line { font-size: 20px; margin-bottom: 10px; }
`

    function injectCss(ctx) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-peek'
      tag.textContent = CSS
      document.head.appendChild(tag)
      ctx.effect(() => () => tag.remove(), 'dsh-peek: stylesheet')
    }

    // =========================================================================
    // apply：全部注册走官方 Slot 席位 + 官方回合数据定义 + 一处点击接管偏差。
    // =========================================================================
    function apply(ctx) {
      injectCss(ctx)

      // 1) 回合产物数据：自注册 ConversationNodeDefinition（官方机制）。
      ctx.uiConversation.events.register(producedDefinition)

      // 2) turnTail 链：本回合产物 chips（官方链席位，select 认领）。
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
        { name: 'conversation.chat.turnTail', select: selectProducedFiles },
        (props) => React.createElement(PeekChips, props),
      ))

      // 3) 覆盖层：预览面板（官方覆盖层席位）。
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-peek-preview', order: 10 },
        () => React.createElement(PreviewOverlay),
      ))

      // 4) 点击接管（约定偏差，见文件头注释）：官方 openFile 无接管钩子，
      //    以捕获阶段监听把文件点击改为内嵌预览。
      ctx.effect(() => {
        document.addEventListener('click', handleDocumentClick, true)
        return () => document.removeEventListener('click', handleDocumentClick, true)
      }, 'dsh-peek: file-click interception')
    }

    exports.apply = apply
    exports.inject = ['slots', 'uiConversation']
    exports.name = 'dsh-peek'
    return module.exports
  },
})
