// config.js — 配置契约：默认转述指令与 schemastery Config（经 index.js 对外导出）。
import z from '@deepseek-ai/schemastery'

export const DEFAULT_INSTRUCTION = `你是图片转文字服务。接收方是一个纯文本模型，看不到图片。
请输出一段客观、完整、信息密度高的中文转述，覆盖：
1) 图中所有可见文字，逐字照抄；2) 整体布局与结构；
3) 关键对象、人物、颜色、图标、UI 元素、图表及其数据；4) 其他重要细节。
只输出转述本身，不要前言、不要寒暄、不要提问。`

export const Config = z.object({
  provider: z.string().default('deepseek-official')
    .description('被包装的适配器路由'),
  visionModel: z.string().default('deepseek-v4-flash-vision-exp')
    .description('用于读图的官方视觉模型'),
  baseURL: z.string().default('https://api.deepseek.com')
    .description('读图端点（OpenAI 兼容 /chat/completions）'),
  marker: z.string().default('[图片内容（由视觉模型读出）]')
    .description('每条转述文本前的前缀标记'),
  maxImages: z.number().step(1).min(1).default(4)
    .description('单条消息交给视觉模型的最多张数（不影响会话保留全部图片）'),
  timeoutMs: z.number().step(1).min(1000).max(300000).default(120000)
    .description('读图超时（毫秒）；超时按失败处理'),
  instruction: z.string().default(DEFAULT_INSTRUCTION)
    .description('读图转述指令'),
})
