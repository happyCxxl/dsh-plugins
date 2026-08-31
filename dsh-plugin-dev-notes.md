# DSH 插件开发注意事项（调研报告）

> 调研来源：官方讨论区 780 帖挖掘报告（[dsh-handbook](https://github.com/Electricitysheep/dsh-handbook)）、官方真实踩坑帖、社区工具链（[dsh-plugin-guide](https://www.npmjs.com/package/dsh-plugin-guide)）、npm 实扫、本会话对当前部署的实地侦察。适用于本仓库所有插件开发。

## A. 架构与平面——东西放错层是最贵的错误

| # | 注意什么 | 证据/对策 |
|---|---|---|
| A1 | **三层位置别搞错**：npm 插件装进 profile（bundle 层）→ host composition 放跨会话共享的注册表 → agent preset 放单会话贡献。有宿主外消费者的服务进 preset 会饿死宿主行；preset 里发服务必须 isolate realm | DSH 技能文档（editing-cordis-compositions） |
| A2 | **动态插件（cordis_define）与 npm 包是两套系统**，社区大量用户困惑（[#186](https://github.com/deepseek-ai/deepseek-harness/discussions/186)）；动态的进程一结束就消失、无法持久化（[#382](https://github.com/deepseek-ai/deepseek-harness/discussions/382)） | 定位：动态 = 会话内原型；npm 包 = 正式分发 |
| A3 | **绝不改 shipped 预设与宿主核心**；预设/插件不得放松自身沙箱边界 | CloserAI 安全规则 + DSH 技能红线 |

## B. 代码与依赖——决定能不能跑起来

| # | 注意什么 | 证据/对策 |
|---|---|---|
| B4 | **Node 版本红线**：DSH 需要 ≥22.19（zstd 等新 API）；Windows 上 koffi 3.1.3/3.1.4 预编译损坏，锁 3.1.2 | [#100](https://github.com/deepseek-ai/deepseek-harness/discussions/100)、[#293](https://github.com/deepseek-ai/deepseek-harness/discussions/293)；package.json 写 `engines` 并声明兼容版本 |
| B5 | **进程内绝不能出现两份 dsh-tools/cordis**：Symbol key 不匹配 → 调度器静默 crash（[#572](https://github.com/deepseek-ai/deepseek-harness/discussions/572)、[#783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)） | 把 cordis 等声明为 **peerDependencies**，让 pnpm 复用 harness 自带那份；peer 警告属预期 |
| B6 | 纯 ESM、零构建步骤最稳；TS 需要完整 tsconfig 三件套；原生依赖越少越好 | dsh-plugin-guide 入口即纯 ESM JS；原生模块是 Linux/macOS 安装失败重灾区（[#177](https://github.com/deepseek-ai/deepseek-harness/discussions/177)、[#605](https://github.com/deepseek-ai/deepseek-harness/discussions/605)） |
| B7 | 官方 rc 包可能缺 peer 导致装不上（[#410](https://github.com/deepseek-ai/deepseek-harness/discussions/410)：dsh-tools 的 peer dsh-type-meta 未发布） | 尽量少依赖官方 rc 包；依赖前实测安装 |

## C. 插件契约与生命周期——决定装得安不安全

| # | 注意什么 | 证据/对策 |
|---|---|---|
| C8 | **一个坏插件的 patch/schema 能拖垮整个 DSH**：schema 写坏 → 整机崩溃（[#297](https://github.com/deepseek-ai/deepseek-harness/discussions/297)、[#447](https://github.com/deepseek-ai/deepseek-harness/discussions/447)）；自启动插件等待不存在的 client 服务 → web boot 失败（[#1947](https://github.com/deepseek-ai/deepseek-harness/discussions/1947)） | 行 id 唯一；`inject` 硬依赖要慎重（等待永不出现的服务 = 自杀）；发布前干净 profile 冒烟 |
| C9 | 所有副作用必须随 Fiber 回收（effect/disposer），waterfall 必须 next() | DSH 技能红线（cordis-plugin-development） |
| C10 | 工具 schema 陷阱家族：无参调用被拒（lossless JSON，[#129](https://github.com/deepseek-ai/deepseek-harness/discussions/129)）；**description 含 `{{...}}` 会破坏 code-mode 组装**（[#711](https://github.com/deepseek-ai/deepseek-harness/discussions/711)）；错误信息不带工具名 → 死循环（[#558](https://github.com/deepseek-ai/deepseek-harness/discussions/558)） | 工具描述禁用 `{{}}`；错误信息含工具名与修复指引 |
| C11 | 插件要**声明权限清单**（如 `filesystem:read`），绝不嵌入凭据 | dsh-plugin-guide 范式（Permissions & data 节） |

## D. 安装与验证——决定发布后能不能用

| # | 注意什么 | 证据/对策 |
|---|---|---|
| D12 | 安装通道三种：npm / git(`github:user/repo#sha`) / tarball；但 `dsh plugin add github:` 在部分版本**只加依赖、不 append 到 profile bundles**（[#656](https://github.com/deepseek-ai/deepseek-harness/discussions/656)） | 发布前三种通道至少实测一种；装完**必须重启**（bundle 层只在 boot 时读取） |
| D13 | 验证要闭环：静态检查（patch 合法性、package.json 元数据、files 白名单）+ **干净 DSH_HOME profile 冒烟**（安装→启动→卸载），或 mock llm + headless + dump 审计（[#462](https://github.com/deepseek-ai/deepseek-harness/discussions/462)） | 现成工具链：`dsh-plugin-guide` 的 `dsh-plugin-dev new/check/verify` |
| D14 | **Windows 是重灾区**（60+ 帖）：中文路径截断家族（readUtf16 U+XX00）、koffi 崩溃、pwsh 调用假死、端口 3080 落 Hyper-V 保留区间、大小写不敏感路径冲突、ReplaceFileW EIO | 自己写路径/文件名逻辑别假设 POSIX；处理中文/空格路径；测试 Windows 用例 |

## E. 生态与发布

| # | 注意什么 | 证据/对策 |
|---|---|---|
| E15 | rc 期 API 变动快：发布要标兼容性（如 "Harness 0.1.1-rc.2 / Node ^22.19 || >=24"），pin 版本 | dsh-plugin-guide Compatibility 表 |
| E16 | 官方 Issues 关闭、暂不收 PR，社区在 Discussions 用"报告-复现-根因-修复分支"模板协作 | dsh-handbook 白皮书第 7 章 |
| E17 | 参考权威教程：[写第一个 dsh 插件的六个坑](https://github.com/deepseek-ai/deepseek-harness/discussions/380)、[从零到发布实战教程](https://github.com/deepseek-ai/deepseek-harness/discussions/961)、[dsh-agent-teams 开发文档](https://github.com/NanmiCoder/dsh-agent-teams/blob/main/docs/developing-dsh-plugins.md) | 动手前通读 |

## 对 dsh-sqlite 的修正（已同步进 DESIGN.md）

1. 工程结构补 peerDependencies（对应 B5）
2. 工具描述禁用 `{{...}}`（对应 C10）
3. db 路径解析用 `os.homedir()`，防中文用户名/空格（对应 D14）
4. 发布前"干净 profile 冒烟"测试（对应 D13）
