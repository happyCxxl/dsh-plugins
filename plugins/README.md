# plugins/

正式插件目录：每个插件 = 一个**独立的 npm 包**。发布到 npm 后，用户一条命令安装：

```powershell
dsh plugin --profile <profile名> add <npm包名>
```

## 标准结构（社区通用做法）

```
plugins/<npm包名>/
├── package.json       # 声明 dsh.bundle（组合补丁）+ dsh.client（浏览器端）
├── cordis.patch.yml   # 安装时插入组合的插件行
├── lib/index.js       # Host 端插件代码（纯 UI 插件可为空的 apply）
├── lib/client.js      # 浏览器端插件代码（可选）
├── README.md          # 用途、安装与使用说明
└── LICENSE            # 如 MIT
```

## package.json 关键字段

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": [] }
}
```

同时配置 `exports`：`.` → `lib/index.js`、`./client` → `lib/client.js`，
并把 `./cordis.patch.yml` 与 `./package.json` 一并导出。

## cordis.patch.yml 模板

```yaml
# 安装时把本包的行插入组合；行 id 需保持唯一
- insert:
    - id: <插件行id>
      name: <npm包名>
```

## 发布与使用

- 发布：在插件目录执行 `npm publish --access public`（首次需 `npm login`）
- 更新：修改 `package.json` 的 `version` 后重新 publish
- 用户安装：`dsh plugin --profile web add <npm包名>`，重启一次后生效

## 注意事项

- npm token、密钥等凭据不进仓库
- 本仓库公开：插件 README 里写清楚用途、权限与副作用

## 参考

- https://github.com/linxiecoder/deepseek-harness-plugins （社区 monorepo 范本）
- npm：`dsh-question-nav`、`relay-dsh-plugin-terminal`
