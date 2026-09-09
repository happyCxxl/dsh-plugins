// dsh-ui-restyle Host 侧：本插件是纯客户端 UI 插件，Host 无逻辑。
// 零依赖：不 import 任何包，避免与 harness 内 cordis/dsh-tools 产生双实例问题。
export const name = 'dsh-ui-restyle'
export const inject = []
export function apply() {
  // 空实现：所有行为都在浏览器端 lib/client.js。
}
