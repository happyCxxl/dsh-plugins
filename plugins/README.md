# plugins/

动态 Cordis Plugin 源码目录。每个插件一个子目录，建议结构：

```
<插件id>/
├── host.js      # Host 端插件代码（cordis_define 的 code.host）
├── client.js    # Client 端插件代码（cordis_define 的 code.client，可选）
└── NOTES.md     # 用途、define/run 步骤、版本记录
```

动态插件只存在于会话进程内，重启或换电脑后需要：

1. 在 DSH 会话中用 `cordis_define` 重新定义（粘贴 `host.js` / `client.js` 内容）；
2. 用 `cordis_run` 激活。

修改插件时保持这里的源码与会话内定义一致：用 `cordis_define` 追加新 Package，再 `cordis_run`（update 模式）。
