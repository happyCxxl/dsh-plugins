window.__ModuleLoader__.load({
  id: '@cxxl/dsh-sqlite',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const CSS = `
      .dsql-root { display: flex; flex-direction: column; gap: 10px; font-family: inherit; font-size: 12px; color: var(--dsw-alias-label-primary, #1a1a1a); }
      .dsql-head { display: flex; align-items: center; gap: 8px; }
      .dsql-title { font-size: 13px; font-weight: 600; flex: none; }
      .dsql-select { flex: 1; min-width: 0; padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12)); border-radius: 6px; background: var(--dsw-alias-bg-base, #ffffff); color: inherit; font: inherit; }
      .dsql-btn { flex: none; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12)); background: transparent; color: var(--dsw-alias-label-secondary, #666666); border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; }
      .dsql-btn:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,0.16)); color: var(--dsw-alias-label-primary, #1a1a1a); }
      .dsql-btn:disabled { opacity: 0.5; cursor: default; }
      .dsql-error { padding: 8px 10px; border-radius: 6px; background: rgba(224, 49, 49, 0.1); color: #c92a2a; }
      .dsql-status { color: var(--dsw-alias-label-secondary, #666666); }
      .dsql-tables { display: flex; flex-direction: column; gap: 4px; }
      .dsql-table-row { display: flex; align-items: center; gap: 8px; text-align: left; border: 1px solid transparent; background: transparent; border-radius: 6px; padding: 6px 8px; cursor: pointer; font: inherit; color: inherit; }
      .dsql-table-row:hover, .dsql-table-row-active { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,0.16)); }
      .dsql-table-name { font-weight: 600; }
      .dsql-table-meta { color: var(--dsw-alias-label-secondary, #666666); font-size: 11px; }
      .dsql-empty { padding: 12px 8px; color: var(--dsw-alias-label-secondary, #666666); text-align: center; }
      .dsql-preview { border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12)); border-radius: 8px; overflow: hidden; }
      .dsql-preview-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12)); font-weight: 600; }
      .dsql-preview-note { margin-left: auto; font-weight: 400; font-size: 11px; color: var(--dsw-alias-label-secondary, #666666); }
      .dsql-cols { padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12)); color: var(--dsw-alias-label-secondary, #666666); font-size: 11px; }
      .dsql-scroll { overflow-x: auto; }
      table.dsql-grid { border-collapse: collapse; width: 100%; font-size: 12px; }
      table.dsql-grid th, table.dsql-grid td { border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08)); padding: 4px 8px; text-align: left; white-space: nowrap; }
      table.dsql-grid th { position: sticky; top: 0; background: var(--dsw-alias-bg-layer-1, #f7f7f7); font-weight: 600; }
    `

    function injectCss(ctx) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-sqlite-browser'
      tag.textContent = CSS
      document.head.appendChild(tag)
      ctx.effect(() => () => tag.remove(), 'dsh-sqlite: panel stylesheet')
    }

    async function api(path) {
      const res = await fetch(path)
      const data = await res.json().catch(() => null)
      if (!res.ok || data === null || data.ok !== true) {
        throw new Error((data && data.error) || ('HTTP ' + res.status))
      }
      return data
    }

    function fmtBytes(n) {
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    function dbOptions(files) {
      return (files || []).map((f) => ({
        value: f.name === 'agent.db' ? 'default' : f.name.replace(/\.db$/, ''),
        label: f.name + ' (' + fmtBytes(f.bytes) + ')',
      }))
    }

    function cellText(v) {
      if (v === null || v === undefined) return 'NULL'
      return String(v)
    }

    function SqliteBrowser() {
      const [files, setFiles] = React.useState([])
      const [db, setDb] = React.useState('default')
      const [info, setInfo] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(false)

      const loadTables = React.useCallback(async (target) => {
        setLoading(true)
        setError(null)
        setPreview(null)
        try {
          setInfo(await api('/dsh-sqlite-api/tables?db=' + encodeURIComponent(target)))
        } catch (err) {
          setError((err && err.message) || String(err))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        api('/dsh-sqlite-api/list-dbs')
          .then((d) => setFiles(d.dbs || []))
          .catch((err) => setError((err && err.message) || String(err)))
        loadTables('default')
      }, [loadTables])

      const onTable = async (t) => {
        setError(null)
        try {
          setPreview(await api('/dsh-sqlite-api/preview?db=' + encodeURIComponent(db) + '&table=' + encodeURIComponent(t)))
        } catch (err) {
          setError((err && err.message) || String(err))
        }
      }

      const tables = (info && info.tables) || []

      return React.createElement('div', { className: 'dsql-root' },
        React.createElement('div', { className: 'dsql-head' },
          React.createElement('span', { className: 'dsql-title' }, 'SQLite 数据库'),
          React.createElement('select', {
            className: 'dsql-select',
            value: db,
            onChange: (e) => { const v = e.target.value; setDb(v); loadTables(v) },
          },
            dbOptions(files).map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label)),
          ),
          React.createElement('button', { className: 'dsql-btn', type: 'button', disabled: loading, onClick: () => loadTables(db) }, loading ? '加载中…' : '刷新'),
        ),
        error !== null && React.createElement('div', { className: 'dsql-error' }, String(error)),
        files.length === 0 && React.createElement('div', { className: 'dsql-empty' }, '尚无数据库文件（~/.dsh/data/）。先让 AI 用 sqlite_exec 建表即可。'),
        info !== null && React.createElement('div', { className: 'dsql-status' },
          'quick_check：' + String(info.quickCheck || 'ok') + '　·　' + tables.length + ' 张表',
        ),
        tables.length > 0 && React.createElement('div', { className: 'dsql-tables' },
          tables.map((t) => React.createElement('button', {
            key: t.name,
            type: 'button',
            className: 'dsql-table-row' + (preview !== null && preview.table === t.name ? ' dsql-table-row-active' : ''),
            onClick: () => onTable(t.name),
          },
            React.createElement('span', { className: 'dsql-table-name' }, t.name),
            React.createElement('span', { className: 'dsql-table-meta' }, t.columns.length + ' 列 · ' + t.rowCount + ' 行'),
          )),
        ),
        tables.length === 0 && files.length > 0 && React.createElement('div', { className: 'dsql-empty' }, '（暂无表，可用 sqlite_exec 建表）'),
        preview !== null && React.createElement('div', { className: 'dsql-preview' },
          React.createElement('div', { className: 'dsql-preview-head' },
            React.createElement('span', null, preview.table),
            React.createElement('span', { className: 'dsql-preview-note' },
              preview.rows.length + ' 行' + (preview.truncated ? '（截断至前 50 行）' : ''),
            ),
          ),
          React.createElement('div', { className: 'dsql-cols' },
            '列：' + preview.columns.join('　'),
          ),
          React.createElement('div', { className: 'dsql-scroll' },
            React.createElement('table', { className: 'dsql-grid' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  preview.columns.map((c) => React.createElement('th', { key: c }, c)),
                ),
              ),
              React.createElement('tbody', null,
                preview.rows.map((r, i) => React.createElement('tr', { key: i },
                  preview.columns.map((c) => React.createElement('td', { key: c }, cellText(r[c]))),
                )),
              ),
            ),
          ),
        ),
      )
    }

    function apply(ctx) {
      injectCss(ctx)
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'sqlite-browser', order: 30, label: 'SQLite 数据库' },
        () => React.createElement(SqliteBrowser),
      ))
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.name = 'dsh-sqlite-browser'
    return module.exports
  },
})
