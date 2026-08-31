# dsh-plugins

个人 DSH（DeepSeek Harness）插件开发与管理仓库。

## 目录结构

| 目录 | 用途 |
|---|---|
| `presets/` | Agent 预设（Cordis 组合），每个预设一个目录，内含 `cordis.yml` 及其插件文件 |
| `plugins/` | 动态 Cordis Plugin 源码（`host.js` / `client.js`），每个插件一个目录 |
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
- 动态 Cordis Plugin 只存在于会话进程内：重启或换电脑后，需要把 `plugins/<id>/` 里的源码重新 `cordis_define` 并 `cordis_run`。
- 本仓库公开，请勿提交任何密钥、token 或私人敏感配置。
