// index.js — 插件入口：包装 deepseek-official 适配器，给纯文本模型装上读图能力。
//
// 不改模型选择器、不新增路由。机制：resolveModel 对纯文本模型声明 inputModalities
// 放行图片（核心门禁 commands.ts 读的就是它）；prepareCall 返回包装流——先把消息里的
// 图片交给官方视觉模型转成文字，再委托原始流。视觉模型原样通过，不二次转译；
// 会话记录仍保留图片本身。
// 转述管线见 lib/transcribe.js；配置契约见 lib/config.js。
import { hasImage, transcribeMessages } from './transcribe.js'

export { Config } from './config.js'

export const name = 'dsh-image-reader'
export const inject = ['llm', 'attachments']

export function apply(ctx, config) {
  // 取被包装的适配器。registration 在 0.1.2-alpha.5 是 TS-private，但 JS 运行时仍
  // 可访问；找不到时它 throw NO_ADAPTER，而不是返回 undefined。
  let adapter
  try {
    adapter = ctx.llm.registration(config.provider)?.adapter
  } catch {
    adapter = undefined
  }
  if (adapter === undefined) {
    ctx.logger.error(`dsh-image-reader: 找不到 "${config.provider}" 适配器，读图能力未启用`)
    return
  }

  // resolveModel：让门禁放行纯文本模型的图片。
  const origResolveModel = adapter.resolveModel.bind(adapter)
  adapter.resolveModel = async (provider, model, signal) => {
    const info = await origResolveModel(provider, model, signal)
    if (info.inputModalities?.includes('image')) return info
    return { ...info, inputModalities: ['text', 'image'] }
  }

  // prepareCall：对纯文本模型返回包装过的 stream——先转译图片再委托原始流。
  // DeepSeekAdapter 覆写了 prepareCall（内部直接调 modelInfoFor / streamWithConnection），
  // 所以必须在 prepareCall 这一层拦，而不是 resolveModel / stream。
  const origPrepareCall = adapter.prepareCall.bind(adapter)
  adapter.prepareCall = async (provider, model, signal) => {
    const call = await origPrepareCall(provider, model, signal)
    if (call.model.inputModalities?.includes('image')) return call
    const origStream = call.stream
    return {
      ...call,
      // 声明 image，让运行时不做图片投影、把原始图片交给我们的 stream。
      model: { ...call.model, inputModalities: ['text', 'image'] },
      stream: async function* (options) {
        // options.messages 是 Message[]，图片块在各自的 .content 里。
        if (!options.messages.some((message) => hasImage(message.content))) {
          yield* origStream(options)
          return
        }
        const messages = await transcribeMessages(ctx, config, options.messages, options.signal)
        yield* origStream({ ...options, messages })
      },
    }
  }

  ctx.logger.info(
    `dsh-image-reader: 已给 "${config.provider}" 的纯文本模型装上读图能力`
    + `（视觉模型 ${config.visionModel} @ ${config.baseURL} · maxImages ${config.maxImages} · timeout ${config.timeoutMs}ms）`,
  )
}
