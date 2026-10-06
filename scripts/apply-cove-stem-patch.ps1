param(
    [string]$InstallDir,
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$patchedRunner = Join-Path $patchRoot 'runner.py'

function Find-InstallDir {
    $candidates = @(
        (Join-Path ${env:ProgramFiles} 'Cove'),
        (Join-Path ${env:ProgramFiles(x86)} 'Cove'),
        (Join-Path ${env:LOCALAPPDATA} 'Programs\Cove'),
        'E:\Cove'
    ) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'resources\ncm2acc\runner.py')) }
    if ($candidates.Count -eq 1) { return $candidates[0] }

    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '请选择 Cove 的安装目录（里面应有 resources\ncm2acc\runner.py）'
    $dialog.UseDescriptionForTitle = $true
    try {
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
        return $dialog.SelectedPath
    } finally {
        $dialog.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $patchedRunner)) { throw "补丁文件缺失：$patchedRunner" }
if (-not $InstallDir) { $InstallDir = Find-InstallDir }
if (-not $InstallDir) { throw '没有选择 Cove 安装目录，补丁未应用。' }
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$runner = Join-Path $InstallDir 'resources\ncm2acc\runner.py'
if (-not (Test-Path -LiteralPath $runner)) { throw "所选目录不是 Cove 安装目录：$runner" }
$content = Get-Content -Raw -Encoding UTF8 $patchedRunner
if ($content -notmatch 'configure_stdio' -or $content -notmatch 'ensure_ascii=True') { throw '补丁文件校验失败，未执行替换。' }

try {
    $backup = "$runner.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item -LiteralPath $runner -Destination $backup -Force
    Copy-Item -LiteralPath $patchedRunner -Destination $runner -Force
} catch [System.UnauthorizedAccessException] {
    if ($Elevated) { throw }
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-InstallDir', $InstallDir, '-Elevated') | Out-Null
    Write-Host '需要管理员权限，已请求 UAC；请在弹窗中允许后等待补丁完成。'
    exit 0
}

$hash = (Get-FileHash -LiteralPath $runner -Algorithm SHA256).Hash
$marker = Join-Path $InstallDir 'resources\ncm2acc\COVE-STEM-PATCH.txt'
[IO.File]::WriteAllText($marker, "Cove stem encoding patch applied: $(Get-Date -Format s)`r`nSHA256: $hash`r`n", [Text.UTF8Encoding]::new($false))
Write-Host "Cove 转换补丁已安装：$runner"
Write-Host "旧文件备份：$backup"
Write-Host "SHA-256：$hash"
Write-Host '请重新启动 Cove 后再开始转换。'
