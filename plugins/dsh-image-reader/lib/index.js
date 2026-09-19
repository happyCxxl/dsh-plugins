// index.js — dsh-image-reader 插件入口（透明适配器包装形态）。
//
// 不改动模型选择器、不新增路由：直接给 `deepseek-official` 适配器的**纯文本模型**
// 装上读图能力——
//   - `resolveModel` 对纯文本模型声明 `inputModalities: ['text', 'image']`，让附件
//     预检与 `read_image` 能力门禁放行图片（核心门禁 commands.ts 读的就是它）；
//   - `prepareCall` 对纯文本模型返回一条包装过的 `stream`：先把消息里的图片块交给
//     官方视觉模型（默认 deepseek-v4-flash-vision-exp）转成文字，再委托原始流。
// 视觉模型（deepseek-v4-flash-vision-exp）原样通过，不被二次转译；会话记录里仍保留
// 图片本身（门禁放行后由 admitPromptContent 正常落盘）。
//
// 形态说明：只导出 name / inject / Config / apply（插件形态），不导出默认类
// （混用两种形态会让 Loader 丢弃其中一套）。
import z from '@deepseek-ai/schemastery'

export const name = '@cxxl/dsh-image-reader'
export const inject = ['llm', 'attachments']

const DEFAULT_INSTRUCTION = [
  '你是图片转文字服务。接收方是一个纯文本模型，看不到图片。',
  '请输出一段客观、完整、信息密度高的中文转述，覆盖：',
  '1) 图中所有可见文字，逐字照抄；2) 整体布局与结构；',
  '3) 关键对象、人物、颜色、图标、UI 元素、图表及其数据；4) 其他重要细节。',
  '只输出转述本身，不要前言、不要寒暄、不要提问。',
].join('\n')

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

/** 递归探测消息内容里是否有图片块（含 tool-result 内层）。 */
function hasImage(content) {
  return content.some((block) => block.type === 'image'
    || (block.type === 'tool-result' && hasImage(block.content)))
}

/** 解析 DeepSeek 视觉模型用的 API key（凭据服务 → 环境变量）。 */
async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve('DEEPSEEK_API_KEY')
      if (hit?.value !== undefined && String(hit.value).length > 0) return String(hit.value)
    } catch { /* 落到环境变量 */ }
  }
  return process.env.DEEPSEEK_API_KEY ?? ''
}

/** 把一张图片的字节交给视觉模型转成文字；失败抛错（由调用方 fail open）。 */
async function transcribeImage(ctx, config, ref, signal) {
  const attachments = ctx.get('attachments')
  const stored = await attachments.readImage(ref, signal)
  const dataUrl = `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`
  const apiKey = await resolveApiKey(ctx)
  const url = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify({
      model: config.visionModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: config.instruction },
        ],
      }],
    }),
    signal: AbortSignal.any([
      AbortSignal.timeout(config.timeoutMs),
      ...(signal === undefined ? [] : [signal]),
    ]),
  })
  const body = await res.text()
  if (!res.ok) {
    throw new Error(`读图失败（HTTP ${res.status}）：${body.slice(0, 200)}`)
  }
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error(`读图失败：非 JSON 响应 ${body.slice(0, 200)}`)
  }
  const content = payload?.choices?.[0]?.message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).filter(Boolean).join('\n')
      : undefined
  if (text === undefined || text.trim() === '') {
    throw new Error('读图失败：视觉模型未返回文本')
  }
  return text.trim()
}

/** 递归替换内容块里的图片为转述文本（含 tool-result 内层）；counter 跨整条消息计数。 */
async function transcribeBlocks(ctx, config, blocks, signal, counter) {
  const out = []
  for (const block of blocks) {
    if (block.type === 'image') {
      counter.count += 1
      if (counter.count > config.maxImages) {
        out.push({ type: 'text', text: `${config.marker}\n[图片超出单条 ${config.maxImages} 张上限，未读取]` })
        continue
      }
      try {
        const text = await transcribeImage(ctx, config, block.attachment, signal)
        out.push({ type: 'text', text: `${config.marker}\n${text}` })
      } catch (error) {
        // fail open：读图失败就用占位文本，绝不因视觉服务挂掉而毒化会话。
        const reason = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn(`dsh-image-reader: 读图失败，已用占位文本继续：${reason}`)
        out.push({ type: 'text', text: `${config.marker}\n[图片读取失败：${reason.slice(0, 200)}]` })
      }
    } else if (block.type === 'tool-result' && hasImage(block.content)) {
      out.push({ ...block, content: await transcribeBlocks(ctx, config, block.content, signal, counter) })
    } else {
      out.push(block)
    }
  }
  return out
}

/** 把消息列表里的图片块替换成转述文本；无图消息原样通过。 */
async function transcribeMessages(ctx, config, messages, signal) {
  const out = []
  for (const message of messages) {
    if (!hasImage(message.content)) {
      out.push(message)
      continue
    }
    out.push({ ...message, content: await transcribeBlocks(ctx, config, message.content, signal, { count: 0 }) })
  }
  return out
}

export function apply(ctx, config) {
  const cfg = {
    provider: config.provider ?? 'deepseek-official',
    visionModel: config.visionModel ?? 'deepseek-v4-flash-vision-exp',
    baseURL: config.baseURL ?? 'https://api.deepseek.com',
    marker: config.marker ?? '[图片内容（由视觉模型读出）]',
    maxImages: config.maxImages ?? 4,
    timeoutMs: config.timeoutMs ?? 120000,
    instruction: config.instruction ?? DEFAULT_INSTRUCTION,
  }

  // 取被包装的适配器。`registration` 在 0.1.2-alpha.5 是 TS-private，但 JS 运行时仍
  // 可访问；找不到时它 throw NO_ADAPTER，而不是返回 undefined。
  let adapter
  try {
    adapter = ctx.llm.registration(cfg.provider)?.adapter
  } catch {
    adapter = undefined
  }
  if (adapter === undefined) {
    ctx.logger.error(`dsh-image-reader: 找不到 "${cfg.provider}" 适配器，读图能力未启用`)
    return
  }

  // 1) resolveModel：让门禁（commands.ts 读 resolveModelInfo）放行纯文本模型的图片。
  const origResolveModel = adapter.resolveModel.bind(adapter)
  adapter.resolveModel = async (provider, model, signal) => {
    const info = await origResolveModel(provider, model, signal)
    if (info.inputModalities?.includes('image')) return info
    return { ...info, inputModalities: ['text', 'image'] }
  }

  // 2) prepareCall：对纯文本模型返回包装过的 stream——先转译图片再委托原始流。
  //    DeepSeekAdapter 覆写了 prepareCall（内部直接调 modelInfoFor / streamWithConnection），
  //    所以必须在 prepareCall 这一层拦，而不是 resolveModel / stream。
  const origPrepareCall = adapter.prepareCall.bind(adapter)
  adapter.prepareCall = async (provider, model, signal) => {
    const call = await origPrepareCall(provider, model, signal)
    if (call.model.inputModalities?.includes('image')) return call // 视觉模型原样通过
    const origStream = call.stream
    return {
      ...call,
      // 声明 image，让运行时不做图片投影、把原始图片交给我们的 stream。
      model: { ...call.model, inputModalities: ['text', 'image'] },
      stream: async function* (options) {
        // 注意：options.messages 是 Message[]，图片块在各自的 .content 里。
        if (!options.messages.some((message) => hasImage(message.content))) {
          yield* origStream(options)
          return
        }
        const messages = await transcribeMessages(ctx, cfg, options.messages, options.signal)
        yield* origStream({ ...options, messages })
      },
    }
  }

  ctx.logger.info(
    `dsh-image-reader: 已给 "${cfg.provider}" 的纯文本模型装上读图能力`
    + `（视觉模型 ${cfg.visionModel} @ ${cfg.baseURL} · maxImages ${cfg.maxImages} · timeout ${cfg.timeoutMs}ms）`,
  )
}
