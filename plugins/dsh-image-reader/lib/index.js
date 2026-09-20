// index.js — 插件入口：包装 deepseek-official 适配器，给纯文本模型装上读图能力。
// 机制与数据流见 README.md「入口与挂载 / 插件逻辑」；转述管线见 lib/transcribe.js；
// 配置契约见 lib/config.js。
import { hasImage, transcribeMessages } from './transcribe.js'

export { Config } from './config.js'

/** 插件短名（对应 cordis.patch.yml 的 id）。 */
export const name = 'dsh-image-reader'

/** 硬依赖：llm 取被包装的适配器；attachments 读图片字节。 */
export const inject = ['llm', 'attachments']

/**
 * 启动装配：运行时包装 deepseek-official 适配器，不改模型选择器、不新增路由。
 * @param ctx - Cordis 上下文（llm / attachments 由 inject 保证就绪）
 * @param config - 经 schemastery 校验、默认值已填充的配置
 * 找不到 provider 适配器时仅记日志并返回（读图能力不启用，不影响宿主启动）。
 */
export function apply(ctx, config) {
  // registration 在 0.1.2-alpha.5 是 TS-private（JS 运行时仍可访问）；找不到时它
  // throw NO_ADAPTER 而不是返回 undefined，所以 try/catch 后按 undefined 处理。
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

  // 对纯文本模型声明 image 输入模态——官方附件预检与能力门禁按此声明放行图片。
  const origResolveModel = adapter.resolveModel.bind(adapter)
  adapter.resolveModel = async (provider, model, signal) => {
    const info = await origResolveModel(provider, model, signal)
    if (info.inputModalities?.includes('image')) return info
    return { ...info, inputModalities: ['text', 'image'] }
  }

  // 在 prepareCall 层包装：DeepSeekAdapter 覆写了它（内部直接调 modelInfoFor /
  // streamWithConnection），拦 resolveModel / stream 都拿不到完整链路。
  const origPrepareCall = adapter.prepareCall.bind(adapter)
  adapter.prepareCall = async (provider, model, signal) => {
    const call = await origPrepareCall(provider, model, signal)
    if (call.model.inputModalities?.includes('image')) return call // 视觉模型原样通过
    const origStream = call.stream
    return {
      ...call,
      // 声明 image：运行时不做图片投影，把原始图片交给我们的 stream。
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
