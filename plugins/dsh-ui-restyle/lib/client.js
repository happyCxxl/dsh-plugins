window.__ModuleLoader__.load({
  id: '@cxxl/dsh-ui-restyle',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ---------------------------------------------------------------------------
    // dsh-ui-restyle 客户端 v0.3
    //
    // 三件事，统一成一套语言：
    //   1. 字体   —— 自带 Inter Variable + JetBrains Mono，覆盖全站的字体变量
    //   2. 聊天列 —— 步骤模型 A：工作行收成一行组头，点开才看逐步状态列表
    //   3. 交互   —— 审批提示与提问卡片按同一套半径/边框/字重纪律重排
    //
    // 选择器策略：只依赖宿主稳定 data-* 钩子，绝不依赖 CSS Module 构建哈希
    // （旧版硬编码 .Md3f7G_column 等哈希，前端一重建就静默失效）。
    //
    //   [data-chat-flow-kind] / [data-chat-flow-key]  聊天流节点
    //   [data-variant="think"]                        思考行
    //   [data-tool] / [data-state]                    工具行及其状态
    //   [data-context-source]                         上下文行
    //   [data-turn-process-member]                    原生 Turn-process 折叠成员（让位）
    //   [data-approval-key] / [data-approval-scroll]  审批提示
    //   [data-question-key] / [data-question-scroll]  提问卡片
    // ---------------------------------------------------------------------------

    const FLOW_ITEM = '[data-chat-flow-kind]'
    const THINK_ROW = '[data-variant="think"]'
    const TOOL_ROW = '[data-tool]'
    const CONTEXT_ROW = '[data-context-source]'
    const NATIVE_PROCESS_ATTR = 'data-turn-process-member'
    const APPROVAL_SCROLL = '[data-approval-scroll]'
    const QUESTION_SCROLL = '[data-question-scroll]'

    const SEG = 'dur-seg'
    const HEAD = 'dur-head'
    const STEPS = 'dur-steps'
    const STEP = 'dur-step'
    const CHILD = 'dur-child'
    const HIDDEN_BY_US = 'dur-hidden'

    // 字体路由前缀，必须与宿主 lib/index.js 里注册的一致。
    const FONT_BASE = '/dsh-ui-restyle/fonts/'

    // 视为"工作行"的节点种类；其余（user / steering / turn-tail / turn-process …）为边界。
    const WORK_KINDS = new Set([
      'tool-call',
      'command',
      'context',
      'compaction',
      'manual-compaction',
    ])

    // 运行中的终端盲文转轮。
    const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

    // 状态标记。
    const MARK = { ok: '✓', error: '✕', stopped: '–', queued: '○', running: '' }

    const CSS = `
/* ===========================================================================
   0. 自带字体 —— 覆盖宿主字体变量，全站一次性统一
   =========================================================================== */
@font-face {
  font-family: 'DSH Sans';
  src: url('${FONT_BASE}inter-var-latin.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'DSH Mono';
  src: url('${FONT_BASE}jetbrains-mono-var-latin.woff2') format('woff2');
  font-weight: 100 800;
  font-style: normal;
  font-display: swap;
}

html:root, body {
  --dsw-font-family: 'DSH Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --ds-font-family-code: 'DSH Mono', 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
  --dur-sans: 'DSH Sans', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --dur-mono: 'DSH Mono', 'SF Mono', Consolas, 'Microsoft YaHei';
  --dur-ease: cubic-bezier(0.4, 0, 0.2, 1);
}

/* 排版纪律：Inter 的 cv01/ss03 开启；字号越大字距越紧（Linear 手法）。
   中文由 Microsoft YaHei 承接（打包 CJK 字体体积不划算，业界通行做法）。 */
[data-chat-flow-kind] {
  font-feature-settings: 'cv01' 1, 'ss03' 1, 'calt' 1, 'kern' 1, 'liga' 1;
}
[data-chat-flow-kind='assistant-step'] :is(p, li) {
  letter-spacing: -.009em;
}
[data-chat-flow-kind='assistant-step'] :is(h1, h2, h3, h4) {
  letter-spacing: -.012em;
  font-weight: 590;
}

/* ===========================================================================
   1. 步骤组：组头（默认唯一可见的一行）
   =========================================================================== */
.${HEAD} {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  margin: 12px 0;
  padding: 6px 7px 6px 0;
  background: none;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  font-family: var(--dur-sans);
  font-size: 12.5px;
  font-weight: 510;
  line-height: 19px;
  letter-spacing: .006em;
  color: var(--dsw-alias-label-tertiary);
  transition: color .1s var(--dur-ease), background-color .1s var(--dur-ease);
}
.${HEAD}:hover { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
.${HEAD}:focus-visible { outline: 1px solid var(--dsw-alias-border-l3); outline-offset: -1px; }
.${HEAD} .dur-chev {
  flex: none; width: 9px; font-size: 8px;
  color: var(--dsw-alias-label-dimmed);
  transition: transform .12s var(--dur-ease);
}
.${HEAD}[aria-expanded="true"] .dur-chev { transform: rotate(90deg); }
.${HEAD} .dur-gstate {
  flex: none; width: 13px; text-align: center;
  font-family: var(--dur-mono); font-size: 11.5px;
}
.${HEAD} .dur-cnt {
  flex: none;
  font-family: var(--dur-mono); font-size: 11.5px; font-weight: 500; letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}
.${HEAD} .dur-comp {
  font-family: var(--dur-mono); font-size: 11.5px; font-weight: 400; letter-spacing: 0;
  color: var(--dsw-alias-label-dimmed);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.${HEAD} .dur-comp .dur-cur { color: var(--dsw-static-deepseek-400, #679efe); }
.${HEAD} .dur-gdur {
  margin-left: auto; flex: none;
  font-family: var(--dur-mono); font-size: 11px; font-weight: 400; letter-spacing: 0;
  color: var(--dsw-alias-label-dimmed);
  font-variant-numeric: tabular-nums;
}
.${HEAD} .dur-fail { color: var(--dsw-alias-state-error-primary); }

/* 组头四种状态 */
.${HEAD}[data-status="running"] { color: var(--dsw-alias-label-secondary); }
.${HEAD}[data-status="running"] .dur-gstate,
.${HEAD}[data-status="running"] .dur-cnt,
.${HEAD}[data-status="running"] .dur-gdur { color: var(--dsw-static-deepseek-400, #679efe); }
.${HEAD}[data-status="error"] { color: var(--dsw-alias-label-secondary); }
.${HEAD}[data-status="error"] .dur-gstate { color: var(--dsw-alias-state-error-primary); }
.${HEAD}[data-status="stopped"] { color: var(--dsw-alias-label-dimmed); }
.${HEAD}[data-status="stopped"] .dur-gstate { color: var(--dsw-alias-state-warn-primary); }

/* ===========================================================================
   2. 步骤列表（只在展开时出现）
   =========================================================================== */
.${STEPS} {
  margin: 2px 0 4px 5px;
  padding-left: 15px;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.${STEP} {
  display: grid;
  align-items: center;
  grid-template-columns: 14px 62px minmax(0, 1fr) auto;
  column-gap: 9px;
  padding: 3px 6px 3px 0;
  border-radius: 4px;
  font-family: var(--dur-mono);
  font-size: 11.5px;
  line-height: 19px;
  letter-spacing: 0;
  cursor: pointer;
  transition: background-color .1s var(--dur-ease);
}
.${STEP}:hover { background: var(--dsw-alias-interactive-bg-hover); }
.${STEP} .dur-mark { text-align: center; font-size: 10.5px; color: var(--dsw-alias-label-dimmed); }
.${STEP} .dur-tool {
  color: var(--dsw-alias-label-tertiary); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.${STEP} .dur-target {
  color: var(--dsw-alias-label-dimmed);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.${STEP} .dur-dur {
  color: var(--dsw-alias-label-dimmed);
  font-variant-numeric: tabular-nums; text-align: right;
}
.${STEP} .dur-err {
  grid-column: 2 / -1;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px; line-height: 17px; opacity: .92;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 六种状态 */
.${STEP}[data-state="queued"] .dur-mark { color: var(--dsw-alias-label-dimmed); }
.${STEP}[data-state="running"] .dur-mark { color: var(--dsw-static-deepseek-400, #679efe); }
.${STEP}[data-state="running"] .dur-tool { color: var(--dsw-alias-label-secondary); }
.${STEP}[data-state="running"] .dur-dur { color: var(--dsw-static-deepseek-400, #679efe); }
.${STEP}[data-state="ok"] .dur-mark { color: var(--dsw-alias-label-tertiary); }
.${STEP}[data-state="error"] .dur-mark { color: var(--dsw-alias-state-error-primary); }
.${STEP}[data-state="error"] .dur-tool { color: var(--dsw-alias-label-secondary); }
.${STEP}[data-state="stopped"] .dur-mark { color: var(--dsw-alias-state-warn-primary); }
.${STEP}[data-state="stopped"] .dur-tool { color: var(--dsw-alias-label-dimmed); }
.${STEP}[data-state="stopped"] .dur-target { text-decoration: line-through; }

/* 展开的工作行：缩进对齐到步骤列表 */
.${CHILD} { padding-left: 20px; }

/* 被插件收起/展开的原生行 */
.${HIDDEN_BY_US} { display: none !important; }

@keyframes dur-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.dur-spin { animation: dur-breathe 1.5s ease-in-out infinite; }

/* ===========================================================================
   3. 交互面板：审批提示
   =========================================================================== */
[data-dur-approval] > [data-dur-card] {
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: 8px !important;
  background: var(--dsw-alias-bg-layer-1) !important;
  box-shadow: none !important;
  position: relative;
}
/* 语义只用一处表达：左侧 2px 琥珀杠 */
[data-dur-approval] > [data-dur-card]::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--dsw-alias-state-warn-primary);
}
[data-dur-strip] {
  background: transparent !important;
  color: var(--dsw-alias-state-warn-primary) !important;
  font-family: var(--dur-mono) !important;
  font-size: 10px !important;
  font-weight: 500 !important;
  line-height: 14px !important;
  letter-spacing: .11em !important;
  text-transform: uppercase;
  padding: 14px 16px 0 !important;
}
[data-dur-strip] > * { width: 6px !important; height: 6px !important; border-radius: 1px !important; }
[data-dur-body] { padding: 7px 16px 0 !important; gap: 0 !important; }
[data-dur-headline] {
  font-family: var(--dur-sans) !important;
  font-size: 15px !important;
  font-weight: 510 !important;
  line-height: 24px !important;
  letter-spacing: -.006em !important;
}
[data-dur-command] {
  margin-top: 11px !important;
  padding: 10px 13px !important;
  background: var(--dsw-alias-bg-base) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: 6px !important;
  font-family: var(--dur-mono) !important;
  font-size: 12px !important;
  line-height: 19px !important;
  color: var(--dsw-alias-label-secondary) !important;
}
[data-dur-actions] { gap: 6px !important; padding: 13px 16px !important; }

/* ===========================================================================
   4. 交互面板：提问卡片
   =========================================================================== */
[data-dur-question] > [data-dur-qcard] {
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: 8px !important;
  background: var(--dsw-alias-bg-layer-1) !important;
  box-shadow: none !important;
}
[data-dur-qeyebrow] {
  font-family: var(--dur-mono) !important;
  font-size: 10px !important;
  font-weight: 500 !important;
  line-height: 14px !important;
  letter-spacing: .11em !important;
  text-transform: uppercase;
  color: var(--dsw-alias-label-dimmed) !important;
  margin-bottom: 7px !important;
}
[data-dur-qtitle] {
  font-family: var(--dur-sans) !important;
  font-size: 15.5px !important;
  font-weight: 590 !important;
  line-height: 24px !important;
  letter-spacing: -.008em !important;
}
[data-dur-qopt] {
  border-radius: 6px !important;
  transition: background-color .1s var(--dur-ease);
}
[data-dur-qopt]:hover { background: var(--dsw-alias-interactive-bg-hover) !important; }
[data-dur-qoptlabel] {
  font-family: var(--dur-sans) !important;
  font-size: 14px !important;
  line-height: 21px !important;
  letter-spacing: -.005em !important;
}
[data-dur-qindex] {
  font-family: var(--dur-mono) !important;
  font-size: 11.5px !important;
  color: var(--dsw-alias-label-dimmed) !important;
}
[data-dur-qbadge] {
  font-family: var(--dur-mono) !important;
  font-size: 10px !important;
  font-weight: 500 !important;
  letter-spacing: .06em !important;
  border-radius: 3px !important;
  border: 1px solid color-mix(in srgb, var(--dsw-static-deepseek-400, #679efe) 30%, transparent) !important;
  background: transparent !important;
  color: var(--dsw-static-deepseek-400, #679efe) !important;
  padding: 1px 5px !important;
}
[data-dur-qfoot] { border-top: 1px solid var(--dsw-alias-border-l2) !important; }
[data-dur-qprogress] {
  font-family: var(--dur-mono) !important;
  font-size: 11px !important;
  color: var(--dsw-alias-label-dimmed) !important;
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  .${HEAD}, .${STEP}, .dur-spin { transition: none !important; animation: none !important; }
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
    // 基础工具
    // ---------------------------------------------------------------------------

    // 聊天列：所有流节点的父元素。列本身没有稳定类名，靠流节点的父节点反推。
    function chatColumns() {
      const columns = new Set()
      for (const item of document.querySelectorAll(FLOW_ITEM)) {
        const parent = item.parentElement
        if (parent === null) continue
        if (parent.matches(FLOW_ITEM)) continue
        columns.add(parent)
      }
      return columns
    }

    // 归原生 Turn-process 折叠管的行：让位，避免双层折叠、也避免撤销它的 hidden。
    function nativeProcessMember(el) {
      return el.hasAttribute(NATIVE_PROCESS_ATTR)
    }

    function textOf(el) {
      return (el.textContent === null ? '' : el.textContent).replace(/\s+/g, ' ').trim()
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

    function classify(item) {
      const kind = item.dataset.chatFlowKind
      if (kind === 'assistant-step') {
        // 正在流式输出的步骤永远算正文。
        // 关键：这一刻文本可能还没落进 DOM（节点先建、文本后到），若判成工作行就会被
        // 收起，而随后的流式文本是 characterData 变更 —— 一旦监听漏了它，这条最终输出
        // 就会一直挂着 display:none，直到手动刷新才出现。
        if (item.querySelector('[data-streaming]') !== null) return 'text'
        return textOutsideThink(item).trim() !== '' ? 'text' : 'work'
      }
      if (WORK_KINDS.has(kind)) return 'work'
      return 'boundary'
    }

    // 取一行工作项的状态：ok / running / error / stopped。
    function stateOf(item) {
      let state = null
      for (const el of item.querySelectorAll('[data-state]')) {
        const value = el.dataset.state
        if (value === 'error') return 'error'
        if (value === 'running') state = 'running'
        else if (value === 'stopped' && state === null) state = 'stopped'
        else if (value === 'ok' && state === null) state = 'ok'
      }
      return state ?? 'ok'
    }

    // 描述一个工作项：工具名 + 目标/摘要。
    function describe(item) {
      const kind = item.dataset.chatFlowKind
      const toolEl = item.querySelector(TOOL_ROW)
      if (toolEl !== null) {
        const tool = toolEl.dataset.tool
        const name = typeof tool === 'string' && tool !== '' ? tool : 'tool'
        return { tool: name, label: stripTool(textOf(toolEl), name) }
      }
      const thinkEl = item.querySelector(THINK_ROW)
      if (thinkEl !== null) return { tool: 'think', label: textOf(thinkEl) }
      if (kind === 'context') {
        const src = item.querySelector(CONTEXT_ROW)
        return { tool: 'ctx', label: src === null ? '' : textOf(src) }
      }
      if (kind === 'command') return { tool: 'cmd', label: stripTool(textOf(item), '') }
      return { tool: kind === undefined ? 'step' : kind, label: textOf(item) }
    }

    // 行内文本以工具名开头时剥掉它，剩下的当"目标"（原生没有独立的 target 钩子）。
    function stripTool(text, tool) {
      if (tool !== '' && text.toLowerCase().startsWith(tool.toLowerCase())) {
        return text.slice(tool.length).replace(/^[\s·:：,，>-]+/, '')
      }
      return text
    }

    function fmtDur(ms) {
      if (ms === null) return ''
      if (ms < 1000) return String(Math.max(1, Math.round(ms))) + 'ms'
      return (ms / 1000).toFixed(1) + 's'
    }

    function totalDuration(steps) {
      let sum = 0
      let known = false
      for (const step of steps) {
        if (step.dur === null) continue
        sum += step.dur
        known = true
      }
      return known ? sum : null
    }

    // ---------------------------------------------------------------------------
    // 交互面板标注：以稳定钩子为锚，给兄弟/父节点打标记，供 CSS 精确命中。
    // 只加属性、不改结构 —— 原生组件重渲染后重新标注即可。
    // ---------------------------------------------------------------------------
    function tagApproval(root) {
      const body = root.querySelector(APPROVAL_SCROLL)
      if (body === null) return
      const card = body.parentElement
      if (card === null) return
      root.setAttribute('data-dur-approval', '')
      card.setAttribute('data-dur-card', '')
      body.setAttribute('data-dur-body', '')
      const strip = body.previousElementSibling
      if (strip !== null) strip.setAttribute('data-dur-strip', '')
      const actions = body.nextElementSibling
      if (actions !== null) actions.setAttribute('data-dur-actions', '')
      const headline = body.children[0]
      if (headline !== undefined) headline.setAttribute('data-dur-headline', '')
      const command = body.children[1]
      if (command !== undefined) command.setAttribute('data-dur-command', '')
    }

    function tagQuestion(root) {
      const body = root.querySelector(QUESTION_SCROLL)
      if (body === null) return
      root.setAttribute('data-dur-question', '')
      const card = body.parentElement
      if (card === null) return
      card.setAttribute('data-dur-qcard', '')
      const header = body.previousElementSibling
      if (header !== null) {
        const heading = header.children[0]
        if (heading !== undefined && heading !== null) {
          const first = heading.children[0]
          const second = heading.children[1]
          if (second !== undefined) {
            if (first !== undefined) first.setAttribute('data-dur-qeyebrow', '')
            second.setAttribute('data-dur-qtitle', '')
          } else if (first !== undefined) {
            first.setAttribute('data-dur-qtitle', '')
          }
        }
      }
      const footer = body.nextElementSibling
      if (footer !== null) {
        footer.setAttribute('data-dur-qfoot', '')
        const pager = footer.children[0]
        if (pager !== undefined) {
          const progress = pager.children[1]
          if (progress !== undefined) progress.setAttribute('data-dur-qprogress', '')
        }
      }
      // 选项：body 里最后一个子节点是选项容器，其子节点是选项按钮 / 自定义行。
      const last = body.lastElementChild
      if (last === null) return
      for (const option of last.children) {
        option.setAttribute('data-dur-qopt', '')
        const index = option.children[0]
        if (index !== undefined) index.setAttribute('data-dur-qindex', '')
        const copy = option.children[1]
        const labelHost = copy === undefined ? undefined : copy.children[0]
        if (labelHost !== undefined && labelHost !== null) {
          const label = labelHost.children[0]
          if (label !== undefined) label.setAttribute('data-dur-qoptlabel', '')
          const badge = labelHost.children[1]
          if (badge !== undefined) badge.setAttribute('data-dur-qbadge', '')
        }
      }
    }

    function tagPanels() {
      for (const root of document.querySelectorAll('[data-approval-key]')) tagApproval(root)
      for (const root of document.querySelectorAll('[data-question-key]')) tagQuestion(root)
    }

    // ---------------------------------------------------------------------------
    // 步骤组视图
    // ---------------------------------------------------------------------------
    function createView() {
      const records = new Map() // key -> record
      const timings = new Map() // Element -> { t0, dur }
      let observer = null
      let syncTimer = null
      let spinTimer = null
      let spinFrame = 0
      let healTimer = null

      const scheduleSync = () => {
        if (syncTimer !== null) return
        syncTimer = setTimeout(() => {
          syncTimer = null
          sync()
        }, 60)
      }

      const release = (item) => {
        // 归原生折叠管的行不撤 hidden：撤了会把原生折叠的隐藏一起撤销。
        if (item.hasAttribute('hidden') && !nativeProcessMember(item)) item.removeAttribute('hidden')
        item.classList.remove(CHILD, HIDDEN_BY_US)
      }

      // 计时：首次出现即记 t0；首次见到时已经结束的项视为"历史项"，不编造耗时。
      function durationOf(item, state) {
        const now = Date.now()
        let entry = timings.get(item)
        if (entry === undefined) {
          entry = { t0: now, dur: state === 'running' ? null : 0 }
          timings.set(item, entry)
        }
        if (state === 'running') {
          entry.dur = null
          return now - entry.t0
        }
        if (entry.dur === null) entry.dur = now - entry.t0
        return entry.dur
      }

      function collect(column) {
        const children = [...column.children]
        const groups = []
        let i = 0
        while (i < children.length) {
          const item = children[i]
          if (!(item instanceof HTMLElement) || item.dataset.chatFlowKind === undefined
            || nativeProcessMember(item) || classify(item) !== 'work') {
            i += 1
            continue
          }
          let j = i
          const items = []
          while (j < children.length) {
            const candidate = children[j]
            if (!(candidate instanceof HTMLElement)) { j += 1; continue }
            if (candidate.dataset.chatFlowKind === undefined) break
            if (nativeProcessMember(candidate)) break
            if (classify(candidate) !== 'work') break
            items.push(candidate)
            j += 1
          }
          groups.push(items)
          i = j
        }
        return groups
      }

      function groupStatus(steps) {
        if (steps.some(s => s.state === 'error')) return 'error'
        if (steps.some(s => s.state === 'running')) return 'running'
        if (steps.some(s => s.state === 'stopped')) return 'stopped'
        return 'ok'
      }

      function composition(steps) {
        const parts = []
        for (const step of steps) parts.push(step.tool)
        const compact = []
        for (const name of parts) {
          const last = compact[compact.length - 1]
          if (last !== undefined && last.name === name) last.count += 1
          else compact.push({ name, count: 1 })
        }
        const labels = compact.map(e => (e.count > 1 ? e.name + '×' + e.count : e.name))
        return labels
      }

      function renderHead(rec) {
        const head = rec.head
        const status = rec.status
        head.dataset.status = status
        head.setAttribute('aria-expanded', String(rec.expanded))
        const running = status === 'running'
        head.children[1].textContent = running ? SPINNER[spinFrame] : (MARK[status] ?? '✓')
        head.children[1].classList.toggle('dur-spin', running)

        const failCount = rec.steps.filter(s => s.state === 'error').length
        const cnt = head.children[2]
        cnt.textContent = ''
        cnt.append(document.createTextNode(String(rec.steps.length) + ' 步'))
        if (failCount > 0) {
          cnt.append(document.createTextNode(' · '))
          const fail = document.createElement('span')
          fail.className = 'dur-fail'
          fail.textContent = String(failCount) + ' 失败'
          cnt.append(fail)
        }

        const comp = head.children[3]
        comp.textContent = ''
        const labels = composition(rec.steps)
        const shown = labels.slice(0, 5)
        shown.forEach((label, index) => {
          if (index > 0) comp.append(document.createTextNode(' · '))
          const running_ = running && index === shown.length - 1
          if (running_) {
            const span = document.createElement('span')
            span.className = 'dur-cur'
            span.textContent = label
            comp.append(span)
          } else {
            comp.append(document.createTextNode(label))
          }
        })

        head.children[4].textContent = fmtDur(totalDuration(rec.steps))
      }

      function renderSteps(rec) {
        const list = rec.list
        list.textContent = ''
        for (const step of rec.steps) {
          const row = document.createElement('div')
          row.className = STEP
          row.dataset.state = step.state
          row.setAttribute('role', 'button')
          row.setAttribute('tabindex', '0')
          row.setAttribute('title', step.label === '' ? step.tool : step.tool + ' ' + step.label)

          const mark = document.createElement('span')
          mark.className = 'dur-mark'
          if (step.state === 'running') {
            mark.classList.add('dur-spin')
            mark.textContent = SPINNER[spinFrame]
          } else {
            mark.textContent = MARK[step.state] ?? ''
          }
          const tool = document.createElement('span')
          tool.className = 'dur-tool'
          tool.textContent = step.tool
          const target = document.createElement('span')
          target.className = 'dur-target'
          target.textContent = step.label
          const dur = document.createElement('span')
          dur.className = 'dur-dur'
          dur.textContent = step.state === 'queued'
            ? '—'
            : step.state === 'stopped' ? '已中止' : fmtDur(step.dur)
          row.append(mark, tool, target, dur)

          if (step.state === 'error' && step.error !== '') {
            const err = document.createElement('span')
            err.className = 'dur-err'
            err.textContent = step.error
            row.append(err)
          }

          // 点某一步 → 露出该步的原生行看详情。
          const reveal = () => {
            step.el.classList.toggle(HIDDEN_BY_US)
            step.el.classList.toggle(CHILD, !step.el.classList.contains(HIDDEN_BY_US))
          }
          row.addEventListener('click', reveal)
          row.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            reveal()
          })
          list.append(row)
        }
      }

      function buildHead(rec) {
        const head = document.createElement('button')
        head.type = 'button'
        head.className = HEAD
        const chev = document.createElement('span')
        chev.className = 'dur-chev'
        chev.textContent = '▶'
        const state = document.createElement('span')
        state.className = 'dur-gstate'
        const cnt = document.createElement('span')
        cnt.className = 'dur-cnt'
        const comp = document.createElement('span')
        comp.className = 'dur-comp'
        const dur = document.createElement('span')
        dur.className = 'dur-gdur'
        head.append(chev, state, cnt, comp, dur)
        head.addEventListener('click', () => {
          rec.expanded = !rec.expanded
          head.setAttribute('aria-expanded', String(rec.expanded))
          rec.list.classList.toggle(HIDDEN_BY_US, !rec.expanded)
        })
        rec.head = head
        rec.list = document.createElement('div')
        rec.list.className = STEPS
        rec.list.classList.toggle(HIDDEN_BY_US, !rec.expanded)
        return head
      }

      function sync() {
        tagPanels()
        for (const rec of records.values()) rec.stale = true
        for (const column of chatColumns()) {
          for (const items of collect(column)) {
            const key = items[0].dataset.chatFlowKey
            let rec = records.get(key)
            if (rec === undefined) {
              rec = { key, head: null, list: null, steps: [], expanded: false, status: 'ok', stale: false }
              records.set(key, rec)
            }
            rec.stale = false
            rec.steps = items.map((el) => {
              const info = describe(el)
              const state = stateOf(el)
              return {
                el,
                tool: info.tool,
                label: info.label,
                state,
                dur: durationOf(el, state),
                error: state === 'error' ? info.label : '',
              }
            })
            rec.status = groupStatus(rec.steps)
            if (rec.head === null || !rec.head.isConnected) {
              const head = buildHead(rec)
              const first = items[0]
              if (first.parentElement !== null) {
                // 顺序：组头 → 步骤列表 → 原生行（原生行随后被收起）
                first.parentElement.insertBefore(head, first)
                first.parentElement.insertBefore(rec.list, first)
              }
            }
            // 收起原生行（保留 hidden="until-found" 之外的可见性控制由我们负责）。
            for (const step of rec.steps) {
              if (!step.el.classList.contains(CHILD)) step.el.classList.add(HIDDEN_BY_US)
            }
            renderHead(rec)
            if (rec.expanded) renderSteps(rec)
          }
        }
        for (const [key, rec] of records) {
          if (rec.stale !== false || (rec.head !== null && !rec.head.isConnected)) {
            for (const step of rec.steps) release(step.el)
            if (rec.head !== null) rec.head.remove()
            if (rec.list !== null) rec.list.remove()
            records.delete(key)
          }
        }
        // 清掉已消失元素的计时记录，避免长会话里无限增长。
        if (timings.size > 400) {
          const live = new Set()
          for (const rec of records.values()) for (const step of rec.steps) live.add(step.el)
          for (const el of [...timings.keys()]) if (!live.has(el)) timings.delete(el)
        }
        syncSpinner()
      }

      function syncSpinner() {
        let hasRunning = false
        for (const rec of records.values()) if (rec.status === 'running') hasRunning = true
        if (hasRunning && spinTimer === null) {
          spinTimer = setInterval(() => {
            spinFrame = (spinFrame + 1) % SPINNER.length
            for (const rec of records.values()) {
              if (rec.status !== 'running' || rec.head === null || !rec.head.isConnected) continue
              const glyph = rec.head.children[1]
              glyph.textContent = SPINNER[spinFrame]
              if (rec.expanded) renderSteps(rec)
            }
          }, 90)
        } else if (!hasRunning && spinTimer !== null) {
          clearInterval(spinTimer)
          spinTimer = null
        }
      }

      // 兜底自愈：凡是被我们收起的行，若此刻已经不该被收起（例如它已经变成正文、
      // 或流式标记已摘除），立刻放出来。只看当前 DOM 状态，不依赖任何 mutation 类型，
      // 因此能兜住 MutationObserver 的各种漏报 —— 这类漏报的表现正是"要手动刷新才显示"。
      function heal() {
        let dirty = false
        for (const el of document.querySelectorAll('.' + HIDDEN_BY_US)) {
          if (el.dataset.chatFlowKind === undefined) continue
          if (classify(el) === 'work') continue
          release(el)
          dirty = true
        }
        if (dirty) scheduleSync()
      }

      function start() {
        observer = new MutationObserver(scheduleSync)
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          // 流式输出增量更新的是文本节点（characterData），不是 childList ——
          // 漏掉它就会让"刚出现的最终输出"永远等不到重算。同步也是防同类问题的兜底。
          characterData: true,
          attributes: true,
          attributeFilter: ['data-state', 'data-streaming'],
        })
        healTimer = setInterval(heal, 1500)
        sync()
        return dispose
      }

      function dispose() {
        if (observer !== null) observer.disconnect()
        observer = null
        if (syncTimer !== null) clearTimeout(syncTimer)
        syncTimer = null
        if (spinTimer !== null) clearInterval(spinTimer)
        spinTimer = null
        if (healTimer !== null) clearInterval(healTimer)
        healTimer = null
        for (const rec of records.values()) {
          for (const step of rec.steps) release(step.el)
          if (rec.head !== null) rec.head.remove()
          if (rec.list !== null) rec.list.remove()
        }
        records.clear()
        timings.clear()
        document.querySelectorAll('[data-dur-approval], [data-dur-question]').forEach((el) => {
          el.removeAttribute('data-dur-approval')
          el.removeAttribute('data-dur-question')
        })
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
