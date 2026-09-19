# Changelog — @cxxl/dsh-peek

本插件版本记录（语义化版本）。

## 0.5.0 — 2026-09-20

- 官方化重写：预览视图走 `conversation.view`、预览面板走 `shell.overlay`、每回合产物 chips 走 `conversation.chat.turnTail` 链（select 认领）、产物路径由自注册 `ConversationNodeDefinition`（`dsh-peek-produced`）逐回合推导；删除全局点击拦截、DOM 扫描、按文案切 tab、隐藏输入框等全部非契约手段。
- 行为变化：官方产物 chips 与行内文件提及点击回落为系统打开文件；内嵌预览入口变为本插件自有的「预览」chips 与「预览」视图。

## 0.4.0 — 2026-09-18

- 首个入库版本：对话产物文件内嵌预览——每轮产物 chips + 预览面板（Host 同源路由读文件，浏览器端按类型渲染）。0.1–0.3 的版本号迭代未留档。
