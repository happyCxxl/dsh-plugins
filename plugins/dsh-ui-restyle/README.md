# dsh-ui-restyle

DSH Web 执行过程优雅化插件：**正文为阅读主线**，正文之间的思考 / 工具调用 / 命令 / 上下文工作行折叠为**单条时序摘要**，并收紧执行区排版。

## 效果

```text
正文 A（永远可见）
▸ ✓ 思考 · read ×2 · edit · glob
正文 B
▸ ⟳ glob（运行中，实时展开）
正文 C
```

- 运行中的工作段实时展开，完成后自动收成摘要；
- 点击摘要行展开 / 收起，手动意图在流式输出中不被重置；
- 摘要只列动作类型，不复制推理全文；展开后原生工作行原样显示，每行自身的开合不受影响。

## 不丢内容的工程保障

- 纯 DOM 视图层：不接管原生 renderer、不修改消息数据、不移动原生节点；
- 折叠使用 `hidden="until-found"`：**Ctrl+F 搜索可定位到被折叠的内容并自动展开**（Chromium 系浏览器）；
- 插件卸载/重载时全部内容自动恢复可见。

## 安装

```powershell
# 从本仓库目录安装（本地目录链接安装，改代码后刷新页面即可迭代）
dsh plugin --profile web add ./plugins/dsh-ui-restyle

# 或打包成 tgz 后安装（真实拷贝，不依赖源目录）
# npm pack，然后：
# dsh plugin --profile web add <生成的tgz绝对路径>
```

安装后**重启一次 `dsh web`**（bundle 层只在启动时读取），刷新页面生效。
卸载：`dsh plugin --profile web remove dsh-ui-restyle`，重启后恢复原生界面。

## 作用范围与副作用

- 只作用于聊天列（`.Md3f7G_column`）的执行过程展示，不动侧边栏、设置、轨迹视图等其他界面；
- 仅注入一个 `<style>` 标签与摘要行 DOM（随插件卸载回收），不持久化任何数据；
- 兼容浅色/深色主题（颜色全部取自 DSH 主题 token）。

## 已知边界（v0.1）

- 同一个 `assistant-step` 内"思考—正文—思考"不切开：以聊天节点为分组粒度；
- `hidden="until-found"` 的搜索展开特性仅 Chromium 系浏览器支持（其余浏览器退化为普通隐藏，内容不丢失）；
- 摘要行数量过多时截断显示前 6 项（展开后内容完整）。

## 开发迭代

```powershell
# 修改 lib/client.js 后刷新浏览器页面即可看到效果（无需重启 dsh web，
# 只要 bundle 组合本身没有变化）。
```

## 许可

MIT
