# DSH 预设联接脚本
# 把本仓库 presets/<预设id> 以 junction（目录联接）挂到 ~/.dsh/.agent-presets/<预设id>
# 之后仓库里的预设文件即 DSH 实际读取的文件：改完直接 git commit，无需复制。
#
# 用法：powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
# 可用 DSH_HOME 环境变量覆盖目标目录（默认 ~/.dsh）。

$ErrorActionPreference = 'Stop'

$DshHome = $env:DSH_HOME
if (-not $DshHome) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }

$repoRoot    = Split-Path -Parent $PSScriptRoot   # scripts/ 的上级 = 仓库根
$presetsSrc  = Join-Path $repoRoot 'presets'
$presetsDst  = Join-Path $DshHome '.agent-presets'

if (-not (Test-Path $presetsSrc)) {
    Write-Warning "未找到 presets/ 目录：$presetsSrc"
    exit 0
}

New-Item -ItemType Directory -Force -Path $presetsDst | Out-Null

Get-ChildItem $presetsSrc -Directory | ForEach-Object {
    $target = Join-Path $presetsDst $_.Name
    if (Test-Path $target) {
        $item = Get-Item $target -Force
        if ($item.LinkType -eq 'Junction') {
            Write-Host "[skip] $($_.Name) 已联接"
        } else {
            Write-Warning "[skip] $($_.Name) 已存在但不是联接（真实目录）——为避免覆盖现有数据，保持原样"
        }
    } else {
        New-Item -ItemType Junction -Path $target -Target $_.FullName | Out-Null
        Write-Host "[linked] $($_.Name) -> $($_.FullName)"
    }
}

Write-Host "完成。目标目录：$presetsDst"
