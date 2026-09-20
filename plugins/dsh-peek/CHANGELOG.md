# Changelog — @cxxl/dsh-peek

本插件版本记录（语义化版本）。

## 0.5.3 — 2026-09-20

- 代码 / 文本文件改用官方 `ReadBlock` 渲染：行号 + shiki 语法高亮（IDEA 式文件视图，超长文件自动收起中间行）；Markdown 改为**左右分屏**（左原文 / 右官方 MarkdownText 预览）；复制走官方 `writeClipboard`。
- 预览面板改版（0.5.2 未发布，并入本版）：面板加大、深色底、头部信息行；Markdown 官方渲染格式保真。
- 官方化重写（0.5.0/0.5.1 未发布，并入本版）：预览面板走 `shell.overlay`（预览即浮层，不设独立「预览」视图）；每回合产物 chips 走 `conversation.chat.turnTail` 链；产物路径由自注册 `ConversationNodeDefinition`（`dsh-peek-produced`）逐回合推导。
- 恢复点击接管（文档化约定偏差）：官方产物 chips、行内文件提及、工具卡片（read/write/edit）路径点击 → 内嵌预览弹窗。

## 0.4.0 — 2026-09-18

- 首个入库版本：对话产物文件内嵌预览——每轮产物 chips + 预览面板（Host 同源路由读文件，浏览器端按类型渲染）。0.1–0.3 的版本号迭代未留档。
