# dsh-plugins

个人 DSH（DeepSeek Harness）插件开发与管理仓库。

## 目录结构

| 目录 | 用途 |
|---|---|
| `presets/` | Agent 预设（Cordis 组合），每个预设一个目录，内含 `cordis.yml` 及其插件文件 |
| `plugins/` | 正式插件，每个插件 = 独立 npm 包（`dsh plugin add` 一条命令安装），约定见 `plugins/README.md` |
| `scripts/` | 初始化脚本，新电脑 clone 后一键把预设联接到 DSH 配置目录 |

## 新电脑初始化

```powershell
git clone https://github.com/happyCxxl/dsh-plugins.git
cd dsh-plugins
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

`setup.ps1` 会把 `presets/<预设id>` 以目录联接（junction）方式挂到 `~/.dsh/.agent-presets/<预设id>`。
之后直接在本仓库里编辑预设即可：DSH 读到的是同一份文件，改动随 git 提交，无需复制、不会失同步。

## 注意事项

- 不要修改 DSH 自带（deployment 内置）的预设（如 `cordis`）；本仓库只管理自己编写的预设。
- 正式插件以独立 npm 包发布，用户通过 `dsh plugin --profile <name> add <包名>` 安装；会话内 `cordis_define` 的临时实验代码不直接对外分发。
- 本仓库公开：请勿提交任何密钥、npm token 或私人敏感配置。
