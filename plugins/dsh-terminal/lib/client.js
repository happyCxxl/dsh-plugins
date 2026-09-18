window.__ModuleLoader__.load({
  id: '@cxxl/dsh-terminal',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // ========================================================================
    // ANSI 终端仿真器（自写，覆盖常用场景：颜色/光标/擦除/SGR/换行滚动）
    // ========================================================================
    function buildPalette() {
      const base = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
        '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff']
      const p = base.slice()
      const levels = [0, 95, 135, 175, 215, 255]
      for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) {
        p.push('#' + [levels[r], levels[g], levels[b]].map((v) => v.toString(16).padStart(2, '0')).join(''))
      }
      for (let i = 0; i < 24; i++) { const v = 8 + i * 10; p.push('#' + v.toString(16).padStart(2, '0').repeat(3)) }
      return p
    }
    const PALETTE = buildPalette()
    const ATTR_BOLD = 1, ATTR_DIM = 2, ATTR_ITALIC = 4, ATTR_UNDERLINE = 8, ATTR_INVERSE = 16

    function blankCell() { return { ch: ' ', fg: null, bg: null, attrs: 0 } }

    class AnsiTerminal {
      constructor(cols, rows) {
        this.cols = cols
        this.rows = rows
        this.screen = []
        for (let y = 0; y < rows; y++) this.screen.push(this.blankRow())
        this.scrollback = []
        this.cx = 0
        this.cy = 0
        this.fg = null
        this.bg = null
        this.bold = false
        this.dim = false
        this.italic = false
        this.underline = false
        this.inverse = false
        this.saved = null
        this.cursorVisible = true
        this.esc = 'ground'
        this.csiBuf = ''
        this.oscBuf = ''
        this.private = ''
      }
      blankRow() { const r = []; for (let x = 0; x < this.cols; x++) r.push(blankCell()); return r }
      reset() {
        this.screen = []
        for (let y = 0; y < this.rows; y++) this.screen.push(this.blankRow())
        this.cx = 0
        this.cy = 0
        this.fg = null
        this.bg = null
        this.bold = false
        this.dim = false
        this.italic = false
        this.underline = false
        this.inverse = false
        this.cursorVisible = true
      }
      setCell(x, y, ch) {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return
        const cell = this.screen[y][x]
        cell.ch = ch
        cell.fg = this.fg
        cell.bg = this.bg
        cell.attrs = (this.bold ? ATTR_BOLD : 0) | (this.dim ? ATTR_DIM : 0)
          | (this.italic ? ATTR_ITALIC : 0) | (this.underline ? ATTR_UNDERLINE : 0)
          | (this.inverse ? ATTR_INVERSE : 0)
      }
      lineFeed() { this.cy++; if (this.cy >= this.rows) { this.scroll(); this.cy = this.rows - 1 } }
      scroll() {
        this.scrollback.push(this.screen[0])
        if (this.scrollback.length > 2000) this.scrollback.shift()
        this.screen.shift()
        this.screen.push(this.blankRow())
      }
      putChar(ch) {
        const cc = ch.charCodeAt(0)
        if (cc === 13) { this.cx = 0; return }
        if (cc === 10 || cc === 11 || cc === 12) { this.lineFeed(); return }
        if (cc === 8) { if (this.cx > 0) this.cx--; return }
        if (cc === 9) { this.cx = Math.min(this.cols - 1, (Math.floor(this.cx / 8) + 1) * 8); return }
        if (cc === 7) return
        if (cc < 32) return
        if (this.cx >= this.cols) { this.lineFeed(); this.cx = 0 }
        this.setCell(this.cx, this.cy, ch)
        this.cx++
      }
      saveCursor() {
        this.saved = { x: this.cx, y: this.cy, fg: this.fg, bg: this.bg, bold: this.bold, dim: this.dim, italic: this.italic, underline: this.underline, inverse: this.inverse }
      }
      restoreCursor() {
        if (!this.saved) return
        const s = this.saved
        this.cx = s.x
        this.cy = s.y
        this.fg = s.fg
        this.bg = s.bg
        this.bold = s.bold
        this.dim = s.dim
        this.italic = s.italic
        this.underline = s.underline
        this.inverse = s.inverse
      }
      eraseLineRange(start, end) {
        const row = this.screen[this.cy]
        if (!row) return
        for (let x = start; x < end && x < this.cols; x++) row[x] = blankCell()
      }
      eraseLine(mode) {
        if (mode === 0) this.eraseLineRange(this.cx, this.cols)
        else if (mode === 1) this.eraseLineRange(0, this.cx + 1)
        else this.eraseLineRange(0, this.cols)
      }
      eraseDisplay(mode) {
        if (mode === 2 || mode === 3) {
          this.screen = []
          for (let y = 0; y < this.rows; y++) this.screen.push(this.blankRow())
          if (mode === 3) this.scrollback = []
          this.cx = 0
          this.cy = 0
          return
        }
        if (mode === 0) {
          this.eraseLineRange(this.cx, this.cols)
          for (let y = this.cy + 1; y < this.rows; y++) { const row = this.screen[y]; if (row) for (let x = 0; x < this.cols; x++) row[x] = blankCell() }
        } else if (mode === 1) {
          this.eraseLineRange(0, this.cx + 1)
          for (let y = 0; y < this.cy; y++) { const row = this.screen[y]; if (row) for (let x = 0; x < this.cols; x++) row[x] = blankCell() }
        }
      }
      sgr(params) {
        if (params.length === 0) params = [0]
        for (let i = 0; i < params.length; i++) {
          const n = params[i]
          if (n === 0) { this.fg = null; this.bg = null; this.bold = false; this.dim = false; this.italic = false; this.underline = false; this.inverse = false }
          else if (n === 1) this.bold = true
          else if (n === 2) this.dim = true
          else if (n === 3) this.italic = true
          else if (n === 4) this.underline = true
          else if (n === 7) this.inverse = true
          else if (n === 22) { this.bold = false; this.dim = false }
          else if (n === 23) this.italic = false
          else if (n === 24) this.underline = false
          else if (n === 27) this.inverse = false
          else if (n >= 30 && n <= 37) this.fg = { i: n - 30 }
          else if (n === 38) {
            if (params[i + 1] === 5 && (i + 2) < params.length) { this.fg = { i: params[i + 2] & 255 }; i += 2 }
            else if (params[i + 1] === 2 && (i + 4) < params.length) { this.fg = [params[i + 2] & 255, params[i + 3] & 255, params[i + 4] & 255]; i += 4 }
          }
          else if (n === 39) this.fg = null
          else if (n >= 40 && n <= 47) this.bg = { i: n - 40 }
          else if (n === 48) {
            if (params[i + 1] === 5 && (i + 2) < params.length) { this.bg = { i: params[i + 2] & 255 }; i += 2 }
            else if (params[i + 1] === 2 && (i + 4) < params.length) { this.bg = [params[i + 2] & 255, params[i + 3] & 255, params[i + 4] & 255]; i += 4 }
          }
          else if (n === 49) this.bg = null
          else if (n >= 90 && n <= 97) this.fg = { i: n - 90 + 8 }
          else if (n >= 100 && n <= 107) this.bg = { i: n - 100 + 8 }
        }
      }
      csiParams() {
        let s = this.csiBuf
        this.private = ''
        if (s.length > 0 && (s[0] === '?' || s[0] === '>' || s[0] === '!')) { this.private = s[0]; s = s.slice(1) }
        if (s.length === 0) return []
        return s.split(';').map((t) => { const n = parseInt(t, 10); return Number.isNaN(n) ? 0 : n })
      }
      handleCsi(final) {
        const params = this.csiParams()
        const p0 = params.length ? params[0] : 0
        switch (final) {
          case 'A': this.cy = Math.max(0, this.cy - Math.max(1, p0 || 1)); break
          case 'B': this.cy = Math.min(this.rows - 1, this.cy + Math.max(1, p0 || 1)); break
          case 'C': this.cx = Math.min(this.cols - 1, this.cx + Math.max(1, p0 || 1)); break
          case 'D': this.cx = Math.max(0, this.cx - Math.max(1, p0 || 1)); break
          case 'E': this.cy = Math.min(this.rows - 1, this.cy + Math.max(1, p0 || 1)); this.cx = 0; break
          case 'F': this.cy = Math.max(0, this.cy - Math.max(1, p0 || 1)); this.cx = 0; break
          case 'G': this.cx = Math.max(0, Math.min(this.cols - 1, (p0 || 1) - 1)); break
          case 'H': case 'f': {
            const r = (params[0] || 1) - 1
            const c = (params[1] || 1) - 1
            this.cy = Math.max(0, Math.min(this.rows - 1, r))
            this.cx = Math.max(0, Math.min(this.cols - 1, c))
            break
          }
          case 'J': this.eraseDisplay(p0); break
          case 'K': this.eraseLine(p0); break
          case 'm': this.sgr(params); break
          case 's': this.saveCursor(); break
          case 'u': this.restoreCursor(); break
          case 'h': case 'l': { if (this.private === '?' && p0 === 25) this.cursorVisible = (final === 'h'); break }
          default: break
        }
      }
      feed(text) {
        for (let i = 0; i < text.length; i++) {
          const ch = text.charAt(i)
          const cc = ch.charCodeAt(0)
          if (this.esc === 'ground') {
            if (cc === 27) this.esc = 'esc'
            else this.putChar(ch)
          } else if (this.esc === 'esc') {
            if (cc === 91) { this.esc = 'csi'; this.csiBuf = '' }
            else if (cc === 93) { this.esc = 'osc'; this.oscBuf = '' }
            else if (cc === 40 || cc === 41 || cc === 35 || cc === 37 || cc === 42 || cc === 43) this.esc = 'charset'
            else if (cc === 55) { this.saveCursor(); this.esc = 'ground' }
            else if (cc === 56) { this.restoreCursor(); this.esc = 'ground' }
            else if (cc === 77) { this.cy = Math.max(0, this.cy - 1); this.esc = 'ground' }
            else if (cc === 68) { this.lineFeed(); this.esc = 'ground' }
            else if (cc === 69) { this.lineFeed(); this.cx = 0; this.esc = 'ground' }
            else if (cc === 99) { this.reset(); this.esc = 'ground' }
            else this.esc = 'ground'
          } else if (this.esc === 'charset') {
            this.esc = 'ground'
          } else if (this.esc === 'csi') {
            if (cc >= 64 && cc <= 126) { this.handleCsi(ch); this.esc = 'ground' }
            else if (this.csiBuf.length > 200) { this.esc = 'ground' }
            else this.csiBuf += ch
          } else if (this.esc === 'osc') {
            if (cc === 7) { this.oscBuf = ''; this.esc = 'ground' }
            else if (cc === 27) this.esc = 'oscEsc'
            else if (this.oscBuf.length > 4000) { this.esc = 'ground' }
            else this.oscBuf += ch
          } else if (this.esc === 'oscEsc') {
            if (cc === 92) { this.oscBuf = ''; this.esc = 'ground' }
            else { this.oscBuf += '\x1b' + ch; this.esc = 'osc' }
          }
        }
      }
    }

    // ========================================================================
    // 渲染
    // ========================================================================
    function colorKey(cell) {
      const f = Array.isArray(cell.fg) ? 'r' + cell.fg.join(',') : (cell.fg ? 'i' + cell.fg.i : 'n')
      const b = Array.isArray(cell.bg) ? 'r' + cell.bg.join(',') : (cell.bg ? 'i' + cell.bg.i : 'n')
      return f + '|' + b + '|' + cell.attrs
    }
    function cellStyle(cell) {
      let fg = cell.fg
      let bg = cell.bg
      if (cell.attrs & ATTR_INVERSE) { const t = fg; fg = bg; bg = t }
      const style = {}
      if (fg !== null) {
        if (Array.isArray(fg)) style.color = 'rgb(' + fg[0] + ',' + fg[1] + ',' + fg[2] + ')'
        else { let n = fg.i; if (n < 8 && (cell.attrs & ATTR_BOLD)) n += 8; if ((cell.attrs & ATTR_DIM) && n >= 8 && n < 16) n -= 8; style.color = PALETTE[n] }
      }
      if (bg !== null) {
        if (Array.isArray(bg)) style.backgroundColor = 'rgb(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ')'
        else style.backgroundColor = PALETTE[bg.i]
      }
      if (cell.attrs & ATTR_BOLD) style.fontWeight = 'bold'
      if (cell.attrs & ATTR_ITALIC) style.fontStyle = 'italic'
      if (cell.attrs & ATTR_UNDERLINE) style.textDecoration = 'underline'
      return style
    }
    function renderRows(emu, cursorAbsY, cursorX, showCursor) {
      const all = emu.scrollback.concat(emu.screen)
      return all.map((row, rowIdx) => {
        const kids = []
        let run = null
        const flush = () => { if (run) { kids.push(React.createElement('span', { key: kids.length, style: run.style }, run.text)); run = null } }
        for (let x = 0; x < row.length; x++) {
          const cell = row[x]
          const isCursor = showCursor && rowIdx === cursorAbsY && x === cursorX
          const key = colorKey(cell)
          const text = cell.ch === ' ' ? '\u00a0' : cell.ch
          if (isCursor) {
            flush()
            const cs = cellStyle(cell)
            cs.backgroundColor = '#4d9fff'
            cs.color = '#ffffff'
            kids.push(React.createElement('span', { key: kids.length, style: cs }, text))
            continue
          }
          if (run && run.key === key) run.text += text
          else { flush(); run = { key, style: cellStyle(cell), text } }
        }
        flush()
        return React.createElement('div', { key: rowIdx, className: 'dwt-row' }, kids)
      })
    }

    // ========================================================================
    // 与 Host 的通信（同源 fetch）
    // ========================================================================
    async function post(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.json().catch(() => null)
    }
    async function getJson(path) {
      const res = await fetch(path)
      return res.json().catch(() => null)
    }

    function resolveCwd(sessionId, ws) {
      if (!ws || !Array.isArray(ws.items)) return undefined
      for (let i = 0; i < ws.items.length; i++) {
        const item = ws.items[i]
        if (item && Array.isArray(item.sessionIds) && item.sessionIds.indexOf(sessionId) >= 0
          && typeof item.path === 'string' && item.path.length > 0) return item.path
      }
      return undefined
    }

    // ========================================================================
    // 会话注册表（模块级）：切 tab 不销毁 PTY / 屏幕，支持多开
    // ========================================================================
    const sessions = new Map() // key -> record
    let nextKey = 1
    let activeKey = null
    let userExited = false // 用户已全部退出：切回 tab 不再自动重开
    let slotsService = null // apply 时注入的 slots 服务（代理绑定到本插件 fiber）
    let viewTabDisposer = null // 终端 view tab 的注销函数；null = 当前未注册

    function newRecord(key) {
      return { key, hostId: null, seq: 0, emu: null, info: { pid: null, cwd: '', shell: '', error: '', exitCode: null }, status: 'idle' }
    }
    function ensureSessions() {
      if (sessions.size === 0) {
        if (userExited) { activeKey = null; return } // 用户已全部退出，保持空态
        const key = 's' + (nextKey++)
        sessions.set(key, newRecord(key))
        activeKey = key
      } else if (activeKey === null || !sessions.has(activeKey)) {
        activeKey = sessions.keys().next().value
      }
    }

    // —— 终端 tab 的显隐（手动注册/注销 conversation.view 条目） ——
    function isViewTabLive() {
      if (!slotsService) return false
      const entries = slotsService.entries('conversation.view')
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].options && entries[i].options.id === 'terminal') return true
      }
      return false
    }
    function registerViewTab() {
      if (!slotsService || isViewTabLive()) return
      viewTabDisposer = null
      try {
        viewTabDisposer = slotsService.register(
          { name: 'conversation.view', id: 'terminal', order: 20, label: 'Terminal' },
          (props) => React.createElement(TerminalView, props),
        )
      } catch (err) {
        viewTabDisposer = null // 槽位尚未声明，由 apply 里的 subscribe 在声明后重试
      }
    }
    function unregisterViewTab() {
      if (viewTabDisposer) { const d = viewTabDisposer; viewTabDisposer = null; d() }
    }

    function TerminalView(props) {
      const sessionId = props.sessionId
      const wsCwd = props.useWorkspaces((ws) => resolveCwd(sessionId, ws))
      const [tick, setTick] = React.useState(0)
      const screenRef = React.useRef(null)
      const inputRef = React.useRef(null)
      const measureRef = React.useRef(null)
      const focusedRef = React.useRef(false)
      const busyRef = React.useRef(false)

      const bump = () => setTick((t) => t + 1)

      async function spawn(key) {
        const s = sessions.get(key)
        if (!s || s.hostId || s.status === 'spawning') return
        s.status = 'spawning'
        bump()
        let cols = 120
        let rows = 30
        try {
          const m = measureRef.current
          const box = screenRef.current
          if (m && box) {
            const mw = m.getBoundingClientRect().width || 8
            const mh = m.getBoundingClientRect().height || 17
            const bw = box.getBoundingClientRect().width
            const bh = box.getBoundingClientRect().height
            cols = Math.max(20, Math.floor((bw - 16) / mw))
            rows = Math.max(6, Math.floor((bh - 12) / mh))
          }
        } catch { /* 用默认值 */ }
        try {
          const res = await post('/dsh-terminal-api/spawn', { cols, rows, ...(wsCwd ? { cwd: wsCwd } : {}) })
          const s2 = sessions.get(key)
          if (!s2) return
          if (!res || !res.ok) {
            s2.status = 'error'
            s2.info.error = (res && res.error) || 'spawn failed'
            bump()
            return
          }
          s2.hostId = res.id
          s2.emu = new AnsiTerminal(cols, rows)
          s2.info = { pid: res.pid, cwd: res.cwd || '', shell: res.shell || '', error: '', exitCode: null }
          s2.status = 'running'
          bump()
          if (key === activeKey && inputRef.current) inputRef.current.focus()
        } catch (err) {
          const s2 = sessions.get(key)
          if (!s2) return
          s2.status = 'error'
          s2.info.error = (err && err.message) || String(err)
          bump()
        }
      }

      function addSession() {
        userExited = false
        const key = 's' + (nextKey++)
        sessions.set(key, newRecord(key))
        activeKey = key
        bump()
        spawn(key)
      }
      function switchSession(key) {
        if (key === activeKey) return
        activeKey = key
        bump()
        const s = sessions.get(key)
        if (s && !s.hostId && s.status !== 'spawning' && s.status !== 'error') spawn(key)
      }
      function closeSession(key) {
        const s = sessions.get(key)
        if (s && s.hostId) post('/dsh-terminal-api/close', { id: s.hostId }).catch(() => {})
        sessions.delete(key)
        if (activeKey === key) {
          const remaining = [...sessions.keys()]
          if (remaining.length > 0) {
            activeKey = remaining[remaining.length - 1]
          } else {
            activeKey = null
            userExited = true // 关掉最后一个 → 完全退出，隐藏 tab
            unregisterViewTab()
          }
        }
        bump()
      }
      function exitAll() {
        for (const s of sessions.values()) {
          if (s.hostId) post('/dsh-terminal-api/close', { id: s.hostId }).catch(() => {})
        }
        sessions.clear()
        activeKey = null
        userExited = true
        unregisterViewTab()
        bump()
      }

      React.useEffect(() => {
        ensureSessions()
        const active = sessions.get(activeKey)
        if (active && !active.hostId && active.status !== 'spawning' && active.status !== 'error') spawn(activeKey)
        bump()

        const pollId = setInterval(async () => {
          if (busyRef.current) return
          const key = activeKey
          const s = sessions.get(key)
          if (!s || !s.hostId || !s.emu) return
          busyRef.current = true
          try {
            const res = await getJson('/dsh-terminal-api/read?id=' + encodeURIComponent(s.hostId) + '&seq=' + s.seq)
            if (res && res.ok) {
              s.seq = res.seq
              if (res.text) { s.emu.feed(res.text); bump() }
              if (res.status === 'exited' && s.status !== 'exited') {
                s.status = 'exited'
                s.info.exitCode = res.exitCode
                bump()
              }
            }
          } catch { /* 忽略瞬时错误 */ } finally {
            busyRef.current = false
          }
        }, 40)

        return () => { clearInterval(pollId) } // 切走 tab 只停轮询，不关 PTY
      }, [])

      React.useEffect(() => {
        if (screenRef.current) screenRef.current.scrollTop = screenRef.current.scrollHeight
      }, [tick])

      const keys = [...sessions.keys()]
      const active = activeKey ? sessions.get(activeKey) : null
      const emu = active ? active.emu : null
      const info = active ? active.info : { pid: null, cwd: '', shell: '', error: '', exitCode: null }
      const status = active ? active.status : 'idle'
      const shellName = info.shell ? String(info.shell).split('\\').pop() : ''
      const showCursor = status === 'running' && emu && emu.cursorVisible && focusedRef.current
      const cursorAbsY = emu ? emu.scrollback.length + emu.cy : 0
      const cursorX = emu ? emu.cx : 0

      function focus() { if (inputRef.current) inputRef.current.focus() }
      function send(data) {
        const key = activeKey
        const s = sessions.get(key)
        if (!s || !s.hostId) return
        post('/dsh-terminal-api/write', { id: s.hostId, data }).catch(() => {})
      }
      function onKeyDown(e) {
        const k = e.key
        if (e.ctrlKey && !e.altKey && !e.metaKey) {
          const lower = (k || '').toLowerCase()
          if (lower === 'c') { e.preventDefault(); return send('\x03') }
          if (lower === 'd') { e.preventDefault(); return send('\x04') }
          if (lower === 'l') { e.preventDefault(); return send('\x0c') }
          if (lower === 'u') { e.preventDefault(); return send('\x15') }
          if (lower === 'a') { e.preventDefault(); return send('\x01') }
          if (lower === 'e') { e.preventDefault(); return send('\x05') }
          if (lower === 'w') { e.preventDefault(); return send('\x17') }
          if (lower === 'z') { e.preventDefault(); return send('\x1a') }
        }
        switch (k) {
          case 'Enter': e.preventDefault(); return send('\r')
          case 'Backspace': e.preventDefault(); return send('\x7f')
          case 'Tab': e.preventDefault(); return send('\t')
          case 'ArrowUp': e.preventDefault(); return send('\x1b[A')
          case 'ArrowDown': e.preventDefault(); return send('\x1b[B')
          case 'ArrowRight': e.preventDefault(); return send('\x1b[C')
          case 'ArrowLeft': e.preventDefault(); return send('\x1b[D')
          case 'Home': e.preventDefault(); return send('\x1b[H')
          case 'End': e.preventDefault(); return send('\x1b[F')
          case 'Delete': e.preventDefault(); return send('\x1b[3~')
          case 'Insert': e.preventDefault(); return send('\x1b[2~')
          case 'PageUp': e.preventDefault(); return send('\x1b[5~')
          case 'PageDown': e.preventDefault(); return send('\x1b[6~')
          case 'Escape': e.preventDefault(); return send('\x1b')
        }
      }
      function onInput(e) {
        const v = e.target.value
        if (v && v.length > 0) { send(v); e.target.value = '' }
      }

      return React.createElement('div', { className: 'dwt', 'data-conversation-composer-overlay': '', 'data-dwt-terminal': '', onMouseDown: focus },
        React.createElement('div', { className: 'dwt-tabs' },
          keys.map((key) => {
            const s = sessions.get(key)
            const n = key.slice(1)
            return React.createElement('div', {
              key,
              className: 'dwt-sess' + (key === activeKey ? ' dwt-sess-active' : ''),
              onClick: () => switchSession(key),
            },
              React.createElement('span', { className: 'dwt-sess-label' }, 'pwsh ' + n),
              React.createElement('button', {
                className: 'dwt-sess-close',
                type: 'button',
                title: '关闭会话',
                onClick: (e) => { e.stopPropagation(); closeSession(key) },
              }, '×'),
            )
          }),
          React.createElement('button', { className: 'dwt-sess-add', type: 'button', title: '新建终端', onClick: addSession }, '+'),
          keys.length > 0 ? React.createElement('button', { className: 'dwt-exit-all', type: 'button', title: '关闭所有终端', onClick: exitAll }, '全部退出') : null,
        ),
        React.createElement('div', { className: 'dwt-head' },
          React.createElement('span', { className: 'dwt-title' }, 'Terminal' + (shellName ? ' · ' + shellName : '')),
          React.createElement('span', { className: 'dwt-sub' }, info.cwd || ''),
        ),
        React.createElement('div', { className: 'dwt-screen', ref: screenRef },
          !active ? React.createElement('div', { className: 'dwt-empty' },
            React.createElement('div', { className: 'dwt-empty-text' }, '终端已关闭'),
            React.createElement('button', { className: 'dwt-start', type: 'button', onClick: addSession }, '启动终端'),
          )
          : status === 'idle' || status === 'spawning' ? React.createElement('div', { className: 'dwt-status' }, 'Starting ' + (shellName || 'PowerShell') + '…')
            : status === 'error' ? React.createElement('div', { className: 'dwt-status dwt-error' }, info.error)
            : status === 'exited' ? React.createElement('div', { className: 'dwt-status' }, 'Process exited' + (info.exitCode !== null && info.exitCode !== undefined ? ' (code ' + info.exitCode + ')' : ''))
            : emu ? renderRows(emu, cursorAbsY, cursorX, showCursor) : null,
          React.createElement('span', { ref: measureRef, className: 'dwt-measure' }, '0'),
        ),
        React.createElement('textarea', {
          ref: inputRef,
          className: 'dwt-input',
          spellCheck: false,
          autoComplete: 'off',
          autoCapitalize: 'off',
          autoCorrect: 'off',
          onKeyDown: onKeyDown,
          onInput: onInput,
          onFocus: () => { focusedRef.current = true },
          onBlur: () => { focusedRef.current = false },
        }),
      )
    }

    function clickTabByLabel(label) {
      try {
        const tabs = document.querySelectorAll('[role="tab"]')
        for (let i = 0; i < tabs.length; i++) {
          if ((tabs[i].textContent || '').trim() === label) {
            tabs[i].click()
            return true
          }
        }
      } catch { /* 忽略 */ }
      return false
    }

    function wakeTerminal() {
      userExited = false
      registerViewTab()
      // tab 栏在微任务里刷新后才出现，用重试等它挂到 DOM 再点击切换
      const attempt = (n) => {
        if (clickTabByLabel('Terminal')) return
        if (n > 0) setTimeout(() => attempt(n - 1), 30)
      }
      setTimeout(() => attempt(12), 0)
    }

    function TerminalToggle() {
      return React.createElement('button', {
        type: 'button',
        className: 'dwt-toggle',
        title: '打开终端',
        onClick: () => wakeTerminal(),
      },
        React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
          React.createElement('path', { d: 'M7 9l3 3-3 3' }),
          React.createElement('path', { d: 'M12 15h5' }),
        ),
      )
    }

    const CSS = `
      .dwt { height: 100%; min-height: 0; background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1a1a); display: flex; flex-direction: column; overflow: hidden; font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: 13px; }
      .dwt-tabs { display: flex; align-items: center; gap: 2px; padding: 4px 6px 0; background: var(--dsw-alias-bg-layer-1, #f7f7f7); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); flex: none; overflow-x: auto; }
      .dwt-sess { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-bottom: none; border-radius: 6px 6px 0 0; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font-size: 12px; white-space: nowrap; }
      .dwt-sess-active { background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1a1a); }
      .dwt-sess-close { background: transparent; border: none; color: inherit; cursor: pointer; padding: 0 2px; font-size: 12px; line-height: 1; }
      .dwt-sess-close:hover { color: var(--dsw-alias-state-error-primary, #c92a2a); }
      .dwt-sess-add { background: transparent; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); color: var(--dsw-alias-label-secondary, #666); cursor: pointer; padding: 3px 8px; font-size: 13px; line-height: 1; border-radius: 6px; margin-bottom: 4px; }
      .dwt-sess-add:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.16)); color: var(--dsw-alias-label-primary, #1a1a1a); }
      .dwt-exit-all { background: transparent; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); color: var(--dsw-alias-label-secondary, #666); cursor: pointer; padding: 3px 8px; font-size: 12px; line-height: 1; border-radius: 6px; margin-bottom: 4px; white-space: nowrap; }
      .dwt-exit-all:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.16)); color: var(--dsw-alias-state-error-primary, #c92a2a); }
      .dwt-head { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: var(--dsw-alias-bg-base, #ffffff); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); flex: none; }
      .dwt-title { font-weight: 600; color: var(--dsw-alias-label-primary, #1a1a1a); font-size: 13px; }
      .dwt-sub { color: var(--dsw-alias-label-secondary, #666); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dwt-screen { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 12px; }
      .dwt-row { white-space: pre; line-height: 1.25; min-height: 1.25em; }
      .dwt-status { color: var(--dsw-alias-label-secondary, #666); padding: 8px 0; white-space: pre-wrap; }
      .dwt-error { color: var(--dsw-alias-state-error-primary, #c92a2a); }
      .dwt-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; min-height: 120px; }
      .dwt-empty-text { color: var(--dsw-alias-label-secondary, #666); font-size: 13px; }
      .dwt-start { background: var(--dsw-alias-interactive-primary, #2563eb); color: #ffffff; border: none; cursor: pointer; padding: 6px 16px; font-size: 13px; border-radius: 6px; }
      .dwt-start:hover { opacity: 0.9; }
      .dwt-input { position: fixed; left: 0; top: 0; width: 2px; height: 2px; opacity: 0; border: 0; padding: 0; margin: 0; outline: none; resize: none; }
      .dwt-measure { position: absolute; display: inline-block; line-height: 1.25; visibility: hidden; white-space: pre; pointer-events: none; }
      .dwt-toggle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 26px; background: transparent; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); color: var(--dsw-alias-label-secondary, #666); cursor: pointer; padding: 0; border-radius: 6px; }
      .dwt-toggle:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.16)); color: var(--dsw-alias-label-primary, #1a1a1a); }
      [data-conversation-scroll]:has([data-dwt-terminal]) > [data-composer-seat] { display: none !important; }
    `

    function injectCss(ctx) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-terminal'
      tag.textContent = CSS
      document.head.appendChild(tag)
      ctx.effect(() => () => tag.remove(), 'dsh-terminal: stylesheet')
    }

    function apply(ctx) {
      injectCss(ctx)
      slotsService = ctx.slots
      ctx.effect(() => () => {
        for (const s of sessions.values()) {
          if (s.hostId) post('/dsh-terminal-api/close', { id: s.hostId }).catch(() => {})
        }
        sessions.clear()
        activeKey = null
        userExited = false
        slotsService = null
        viewTabDisposer = null
      }, 'dsh-terminal: close sessions on unload')

      // 终端 tab：手动注册/注销，支撑「完全退出时消失、唤醒时重现」。
      // subscribe 在槽位声明或条目增减时触发，用于等待声明时序后重试注册。
      registerViewTab()
      const unsubscribe = ctx.slots.subscribe('conversation.view', () => {
        if (!userExited) registerViewTab()
      })
      ctx.effect(() => () => unsubscribe(), 'dsh-terminal: conversation.view watch')

      // 工具行按钮：始终存在，唤醒/切到终端。
      ctx.slots.inject('conversation.input.right', () => {
        try {
          return ctx.slots.register(
            { name: 'conversation.input.right', id: 'dsh-terminal-toggle', order: 100, label: 'Terminal' },
            () => React.createElement(TerminalToggle),
          )
        } catch (error) {
          console.error('[dsh-terminal] toggle registration failed:', error)
        }
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.name = 'dsh-terminal'
    return module.exports
  },
})
