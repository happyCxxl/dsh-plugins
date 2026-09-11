window.__ModuleLoader__.load({
  id: '@cxxl/dsh-ui-restyle',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ---------------------------------------------------------------------------
    // dsh-ui-restyle 客户端
    //
    // 目标：把"正文之间的工作行（思考/工具/命令/上下文）"折叠成单条时序摘要，
    // 正文永远是阅读主线。纯 DOM 视图层实现：
    //   - 不接管任何原生 renderer，不修改消息数据，不移动原生节点；
    //   - 隐藏使用 hidden="until-found"，浏览器 Ctrl+F 可定位并自动展开；
    //   - 运行中的工作段实时展开，结束后收成摘要；手动展开意图不被重置；
    //   - 所有副作用由 ctx.effect 回收。
    //
    // ---------------------------------------------------------------------------
    // 选择器策略（v0.2 重写）
    //
    // 只依赖宿主**稳定的 data-* 钩子**，绝不再依赖构建哈希类名。
    // 旧版硬编码 .Md3f7G_column / .o3BgMG_root / .QWLzlG_root / .Sxvs8a_body 等
    // CSS Module 哈希类名，前端一旦重新构建（0.1.1-rc.2 → 0.1.2-alpha.5）就全部失配，
    // 插件静默空转。现用钩子均取自 dsh-client-ui-chat / dsh-client-ui-tool 源码：
    //
    //   [data-chat-flow-kind]        每个聊天节点（user/assistant-step/tool-call/command/context/…）
    //   [data-chat-flow-key]         节点稳定键
    //   [data-variant="think"]       思考行（ReasoningRow）
    //   [data-tool] / [data-state]   工具行（ToolRow；state: running|ok|error|stopped）
    //   [data-context-source]        上下文行（ContextInjectionRow）
    //   [data-turn-process-member]   原生 Turn-process 折叠成员标记：这些行归原生折叠管，插件跳过不重复处理
    //
    // 聊天列本身没有稳定类名，所以改为「对所有 [data-chat-flow-kind] 元素按父节点分组」得到列。
    // ---------------------------------------------------------------------------

    const FLOW_ITEM = '[data-chat-flow-kind]'
    const THINK_ROW = '[data-variant="think"]'
    const TOOL_ROW = '[data-tool]'
    const CONTEXT_ROW = '[data-context-source]'
    const NATIVE_PROCESS_ATTR = 'data-turn-process-member'

    const SEG_CLASS = 'dur-seg'
    const CHILD_CLASS = 'dur-child'

    // 视为"工作行"的节点种类；其余（user / steering / turn-tail / turn-process / turn-error …）
    // 为边界，保持原样不折叠。
    const WORK_KINDS = new Set([
      'tool-call',
      'command',
      'context',
      'compaction',
      'manual-compaction',
    ])

    const CSS = `
/* ==== dsh-ui-restyle：工作段摘要行 ==== */
.dur-seg {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 3px 4px 3px 0;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.dur-seg:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dur-seg:focus-visible { outline: 2px solid var(--dsw-alias-border-l3); outline-offset: -2px; }

.dur-seg-rail { position: relative; width: 15px; flex: none; align-self: stretch; }
.dur-seg-rail::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 14px;
  bottom: 6px;
  width: 1px;
  background: var(--dsw-alias-border-l2);
  transition: background-color 120ms ease;
}
.dur-seg:hover .dur-seg-rail::before { background: var(--dsw-alias-border-l3); }

.dur-seg-dot {
  position: absolute;
  left: 3px;
  top: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption);
  border: 1px solid var(--dsw-alias-bg-base);
  transition: background-color 120ms ease, box-shadow 120ms ease;
}
.dur-seg[data-status="running"] .dur-seg-dot {
  background: var(--dsw-static-deepseek-400, #679efe);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-static-deepseek-400, #679efe) 18%, transparent);
}
.dur-seg[data-status="error"] .dur-seg-dot { background: var(--dsw-alias-state-error-primary); }

.dur-seg-glyph {
  flex: none;
  width: 13px;
  text-align: center;
  font-size: 11px;
  line-height: 20px;
  color: var(--dsw-alias-label-caption);
}
.dur-seg[data-status="running"] .dur-seg-glyph {
  color: var(--dsw-static-deepseek-400, #679efe);
  animation: dur-spin 1.2s linear infinite;
}
.dur-seg[data-status="error"] .dur-seg-glyph { color: var(--dsw-alias-state-error-primary); }
.dur-seg[data-status="done"] .dur-seg-glyph { color: var(--dsw-alias-state-success-primary); }

@keyframes dur-spin { to { transform: rotate(360deg); } }

.dur-seg-text {
  min-width: 0;
  flex: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  transition: color 120ms ease;
}
.dur-seg:hover .dur-seg-text { color: var(--dsw-alias-label-primary); }
.dur-seg[data-status="running"] .dur-seg-text { color: var(--dsw-alias-label-primary); }

/* 展开的工作行：缩进到摘要行的时间线下方 */
.dur-child { padding-left: 23px; }

/* ==== 执行区排版收紧（稳定选择器，仅作用于聊天列内的工作行）==== */
[data-chat-flow-kind='tool-call'],
[data-chat-flow-kind='command'],
[data-chat-flow-kind='context'] {
  font-size: 13px;
  line-height: 20px;
}
[data-chat-flow-kind] [data-variant='think'],
[data-chat-flow-kind] [data-tool] {
  font-size: 13px;
  line-height: 20px;
}

@media (prefers-reduced-motion: reduce) {
  .dur-seg, .dur-seg-dot, .dur-seg-glyph, .dur-seg-text { transition: none; }
  .dur-seg[data-status="running"] .dur-seg-glyph { animation: none; }
}
`

    function injectCss(ctx) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-ui-restyle'
      tag.textContent = CSS
      document.head.appendChild(tag)
      ctx.effect(() => () => tag.remove(), 'dsh-ui-restyle: stylesheet')
    }

    // ---------------------------------------------------------------------------
    // 稳定选择器工具
    // ---------------------------------------------------------------------------

    // 聊天列：所有流节点的父元素。列本身没有稳定类名，靠"流节点的父节点"反推。
    function chatColumns() {
      const columns = new Set()
      for (const item of document.querySelectorAll(FLOW_ITEM)) {
        const parent = item.parentElement
        if (parent === null) continue
        if (parent.matches(FLOW_ITEM)) continue // 嵌套流节点不算列
        columns.add(parent)
      }
      return columns
    }

    // 原生 Turn-process 折叠的成员行：折叠与展开都归原生负责，插件跳过，避免双层折叠、
    // 也避免插件释放 hidden 时把原生的隐藏一起撤销。
    // 该标记只在「紧凑」对话视图（transcriptView=compact）下出现；「常规」视图下没有，插件自行折叠。
    function nativeProcessMember(item) {
      return item.hasAttribute(NATIVE_PROCESS_ATTR)
    }

    // 排除思考行后的可见文本；用来判断 assistant-step 是否含"正文"。
    function textOutsideThink(item) {
      let out = ''
      const walk = (node) => {
        if (node.nodeType === 3) {
          out += node.nodeValue === null ? '' : node.nodeValue
          return
        }
        if (node.nodeType !== 1) return
        if (typeof node.matches === 'function' && node.matches(THINK_ROW)) return
        for (const child of node.childNodes) walk(child)
      }
      walk(item)
      return out
    }

    function stepHasText(item) {
      return textOutsideThink(item).trim() !== ''
    }

    function classify(item) {
      const kind = item.dataset.chatFlowKind
      if (WORK_KINDS.has(kind)) return 'work'
      if (kind === 'assistant-step') return stepHasText(item) ? 'text' : 'work'
      return 'boundary'
    }

    // ---------------------------------------------------------------------------
    // 摘要与状态
    // ---------------------------------------------------------------------------
    function toolRoots(item) {
      return [...item.querySelectorAll(TOOL_ROW)].filter((root) => {
        const host = root.parentElement
        return host === null || host.closest(TOOL_ROW) === null
      })
    }

    function summarize(items) {
      const parts = []
      for (const item of items) {
        const kind = item.dataset.chatFlowKind
        if (item.querySelector(THINK_ROW) !== null) parts.push('思考')
        for (const root of toolRoots(item)) {
          const tool = root.dataset.tool
          if (typeof tool === 'string' && tool !== '') parts.push(tool)
        }
        if (kind === 'command') parts.push('命令')
        if (kind === 'context' && item.querySelector(CONTEXT_ROW) !== null) parts.push('上下文')
      }
      const compact = []
      for (const name of parts) {
        const last = compact[compact.length - 1]
        if (last !== undefined && last.name === name) last.count += 1
        else compact.push({ name, count: 1 })
      }
      const labels = compact.map((entry) => (entry.count > 1 ? entry.name + ' ×' + entry.count : entry.name))
      if (labels.length > 6) return labels.slice(0, 6).join(' · ') + ' · +' + (labels.length - 6)
      return labels.join(' · ') || '工作'
    }

    function segmentStatus(items) {
      let running = false
      let error = false
      for (const item of items) {
        for (const el of item.querySelectorAll('[data-state]')) {
          const state = el.dataset.state
          if (state === 'running') running = true
          else if (state === 'error') error = true
        }
      }
      return error ? 'error' : running ? 'running' : 'done'
    }

    // ---------------------------------------------------------------------------
    // 视图控制器：分段、摘要行、显隐与清理
    // ---------------------------------------------------------------------------
    function createView() {
      const records = new Map() // segmentKey -> { key, row, items:Set, expanded, user, status }
      let observer = null
      let timer = null

      const scheduleSync = () => {
        if (timer !== null) return
        timer = setTimeout(() => {
          timer = null
          sync()
        }, 60)
      }

      const release = (item) => {
        // 归原生折叠管的行不撤 hidden：撤了会把原生折叠的隐藏一起撤销。
        if (item.hasAttribute('hidden') && !nativeProcessMember(item)) item.removeAttribute('hidden')
        item.classList.remove(CHILD_CLASS)
      }

      function buildRow(rec) {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = SEG_CLASS
        const rail = document.createElement('span')
        rail.className = 'dur-seg-rail'
        const dot = document.createElement('span')
        dot.className = 'dur-seg-dot'
        rail.appendChild(dot)
        const glyph = document.createElement('span')
        glyph.className = 'dur-seg-glyph'
        glyph.setAttribute('aria-hidden', 'true')
        const text = document.createElement('span')
        text.className = 'dur-seg-text'
        row.appendChild(rail)
        row.appendChild(glyph)
        row.appendChild(text)
        row.addEventListener('click', () => {
          rec.expanded = !rec.expanded
          rec.user = true
          renderRow(rec)
        })
        rec.row = row
        rec.textEl = text
        rec.glyphEl = glyph
        return row
      }

      function renderRow(rec) {
        const row = rec.row
        if (row === null || !row.isConnected) return
        const running = rec.status === 'running'
        const expanded = running || rec.expanded
        row.dataset.status = rec.status
        row.setAttribute('aria-expanded', String(expanded))
        row.setAttribute('aria-disabled', String(running))
        row.style.cursor = running ? 'default' : 'pointer'
        rec.glyphEl.textContent = running ? '⟳' : rec.status === 'error' ? '✕' : '✓'
        rec.textEl.textContent = summarize([...rec.items])
        for (const item of rec.items) {
          if (expanded) {
            if (item.hasAttribute('hidden') && !nativeProcessMember(item)) item.removeAttribute('hidden')
            item.classList.add(CHILD_CLASS)
          } else {
            item.classList.remove(CHILD_CLASS)
            if (item.getAttribute('hidden') !== 'until-found') item.setAttribute('hidden', 'until-found')
          }
        }
      }

      function sync() {
        for (const rec of records.values()) rec.stale = true
        for (const column of chatColumns()) {
          const children = [...column.children]
          let i = 0
          while (i < children.length) {
            const item = children[i]
            if (!(item instanceof HTMLElement) || item.dataset.chatFlowKind === undefined) {
              i += 1
              continue
            }
            if (nativeProcessMember(item) || classify(item) !== 'work') {
              i += 1
              continue
            }
            let j = i
            const items = []
            while (j < children.length) {
              const candidate = children[j]
              if (!(candidate instanceof HTMLElement)) {
                j += 1
                continue
              }
              if (candidate.dataset.chatFlowKind === undefined) break
              if (nativeProcessMember(candidate)) break
              if (classify(candidate) !== 'work') break
              items.push(candidate)
              j += 1
            }
            const key = items[0].dataset.chatFlowKey
            let rec = records.get(key)
            if (rec === undefined) {
              rec = { key, row: null, textEl: null, glyphEl: null, items: new Set(), expanded: false, user: false, status: 'done', stale: false }
              records.set(key, rec)
            }
            rec.stale = false
            const nextItems = new Set(items)
            for (const old of rec.items) if (!nextItems.has(old)) release(old)
            rec.items = nextItems
            const status = segmentStatus(items)
            const wasRunning = rec.status === 'running'
            rec.status = status
            if (status === 'running') rec.expanded = true
            else if (wasRunning && !rec.user) rec.expanded = false
            if (rec.row === null || !rec.row.isConnected) {
              buildRow(rec)
              items[0].parentElement.insertBefore(rec.row, items[0])
            }
            renderRow(rec)
            i = j
          }
        }
        for (const [key, rec] of records) {
          if (rec.stale !== false || rec.items.size === 0 || (rec.row !== null && !rec.row.isConnected)) {
            for (const item of rec.items) release(item)
            if (rec.row !== null) rec.row.remove()
            records.delete(key)
          }
        }
      }

      // 浏览器搜索（beforematch）定位到被折叠的内容时，展开所在工作段。
      const onBeforeMatch = (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const item = target.closest(FLOW_ITEM)
        if (item === null) return
        for (const rec of records.values()) {
          if (rec.items.has(item)) {
            rec.expanded = true
            rec.user = true
            renderRow(rec)
            return
          }
        }
      }

      function start() {
        document.addEventListener('beforematch', onBeforeMatch, true)
        observer = new MutationObserver(scheduleSync)
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-state'],
        })
        sync()
        return dispose
      }

      function dispose() {
        if (observer !== null) observer.disconnect()
        observer = null
        if (timer !== null) clearTimeout(timer)
        timer = null
        document.removeEventListener('beforematch', onBeforeMatch, true)
        document.querySelectorAll('.' + SEG_CLASS).forEach((row) => row.remove())
        document.querySelectorAll('.' + CHILD_CLASS).forEach((el) => el.classList.remove(CHILD_CLASS))
        for (const rec of records.values()) {
          for (const item of rec.items) release(item)
          if (rec.row !== null) rec.row.remove()
        }
        records.clear()
      }

      return { start }
    }

    function apply(ctx) {
      injectCss(ctx)
      const view = createView()
      ctx.effect(() => view.start(), 'dsh-ui-restyle: work-segment view')
    }

    exports.apply = apply
    exports.name = 'dsh-ui-restyle'
    exports.inject = []
    return module.exports
  },
})
