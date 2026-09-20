// transcribe.js — 图片转述管线：探测图片块、调用官方视觉模型转文字、替换消息内容。
// 读图失败按 fail-open 处理（占位文本继续），绝不因视觉服务异常毒化会话。

/** 递归探测消息内容里是否有图片块（含 tool-result 内层）。 */
export function hasImage(content) {
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
        // fail-open：读图失败用占位文本继续，不因视觉服务异常丢失消息。
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
export async function transcribeMessages(ctx, config, messages, signal) {
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
