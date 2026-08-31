# presets/

Agent 预设（Cordis 组合）源码目录。

- 每个预设一个子目录，目录名 = 预设 id，内含 `cordis.yml`（及其引用的插件文件）。
- 本机启用：运行 `scripts/setup.ps1`，把这里的目录以 junction 联接到 `~/.dsh/.agent-presets/<id>/`。
- 只放自己编写的预设；不要修改或复制 DSH 自带（deployment 内置）的预设（如 `cordis`）。
