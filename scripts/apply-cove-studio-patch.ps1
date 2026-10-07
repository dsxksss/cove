param([string]$InstallDir)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$files = @('netease-music-player.exe', 'resources\ncm2acc\runner.py', 'resources\ncm2acc\ncm2acc.py')
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'patch-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($file in $files) {
    $source = Join-Path $patchRoot $file
    $expected = $manifest.PSObject.Properties[$file].Value
    if (-not $expected -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expected) {
        throw "补丁校验失败：$file，请重新解压下载的补丁。"
    }
}
if (-not $InstallDir) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '选择已安装 Cove 的文件夹（里面有主程序及 resources 文件夹）'
    try {
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw '已取消，未修改安装文件。' }
        $InstallDir = $dialog.SelectedPath
    } finally { $dialog.Dispose() }
}
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$exe = Join-Path $InstallDir 'netease-music-player.exe'
if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath (Join-Path $InstallDir 'resources\ncm2acc\ffmpeg.exe'))) {
    throw '此补丁需要已有的完整 Cove 安装目录，不能直接在补丁文件夹中运行主程序。'
}
foreach ($process in @(Get-Process -Name 'netease-music-player' -ErrorAction SilentlyContinue)) {
    if (-not $process.Path -or $process.Path -eq $exe) { throw '请先完全退出 Cove（包括托盘），再应用补丁。' }
}
$backup = Join-Path $InstallDir ('.cove-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
try {
    foreach ($file in $files) {
        $target = Join-Path $InstallDir $file
        if (-not (Test-Path -LiteralPath $target)) { throw "安装文件缺失：$file" }
        $copy = Join-Path $backup $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $copy) -Force | Out-Null
        Copy-Item -LiteralPath $target -Destination $copy
    }
} catch {
    throw "备份失败，原文件未替换。若安装在 Program Files，请以管理员身份运行应用补丁.cmd。详情：$($_.Exception.Message)"
}
$changed = @()
try {
    foreach ($file in $files) {
        $changed += $file
        Copy-Item -LiteralPath (Join-Path $patchRoot $file) -Destination (Join-Path $InstallDir $file) -Force
        if ((Get-FileHash -LiteralPath (Join-Path $InstallDir $file) -Algorithm SHA256).Hash -ne $manifest.PSObject.Properties[$file].Value) {
            throw "写入校验失败：$file"
        }
    }
} catch {
    $failure = $_.Exception.Message
    foreach ($file in $changed) { Copy-Item -LiteralPath (Join-Path $backup $file) -Destination (Join-Path $InstallDir $file) -Force }
    throw "补丁失败，已恢复备份：$failure"
}
Write-Host "更新完成，可以启动 Cove。旧文件备份：$backup"
Write-Host 'Python、模型、FFmpeg 和您的工程文件均保持不变。'
