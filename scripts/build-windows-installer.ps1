param(
    [switch]$SkipAppBuild,
    [ValidateSet('Full', 'Player')][string]$Edition = 'Full',
    [string]$IsccPath = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).version
$outputDir = Join-Path $repoRoot ".tmp\Cove-$version-Windows-x64"
$prerequisiteDir = Join-Path $repoRoot '.tmp\installer-tools'
$runtime = Join-Path $repoRoot 'src-tauri\resources\ncm2acc'
$editionName = $Edition.ToLowerInvariant()
$includeStudio = $Edition -eq 'Full'
$stageDir = Join-Path $repoRoot ".tmp\release-$version-$editionName"
$frontendDir = Join-Path $stageDir 'frontend'
$stagedExe = Join-Path $stageDir 'netease-music-player.exe'
New-Item -ItemType Directory -Force $outputDir, $prerequisiteDir, $stageDir | Out-Null

function Run-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File 失败，错误码 $LASTEXITCODE" }
}

if (-not (Test-Path -LiteralPath $IsccPath)) { throw '需要安装 Inno Setup 6.5.2 或更新版本，或通过 -IsccPath 指定编译器。' }
if ($includeStudio) { foreach ($relative in @('runner.py', 'ncm2acc.py', 'ncmdump-go.exe', 'ffmpeg.exe', 'python\python.exe',
    'models\model_bs_roformer_ep_317_sdr_12.9755.ckpt', 'models\model_bs_roformer_ep_317_sdr_12.9755.yaml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime $relative))) { throw "完整运行资源缺失：$relative" }
} }

Push-Location $repoRoot
try {
    if (-not $SkipAppBuild) {
        Run-Checked (Join-Path $repoRoot 'node_modules\.bin\tsc.cmd') @('-b')
        $previousFeature = $env:VITE_COVE_STUDIO
        try {
            $env:VITE_COVE_STUDIO = if ($includeStudio) { 'true' } else { 'false' }
            Run-Checked (Join-Path $repoRoot 'node_modules\.bin\vite.cmd') @('build', '--configLoader', 'runner', '--outDir', $frontendDir)
        } finally { $env:VITE_COVE_STUDIO = $previousFeature }
        if (-not $includeStudio) {
            $worklet = Join-Path $frontendDir 'studio-recorder.worklet.js'
            if (Test-Path -LiteralPath $worklet) { Remove-Item -LiteralPath $worklet }
        }
        $override = Join-Path $stageDir 'tauri-build.json'
        $config = @{ build = @{ beforeBuildCommand = ''; frontendDist = $frontendDir }; bundle = @{ resources = @() } } | ConvertTo-Json -Depth 4
        [IO.File]::WriteAllText($override, $config, [Text.UTF8Encoding]::new($false))
        $buildArgs = @('build', '--no-bundle', '--config', $override)
        if (-not $includeStudio) { $buildArgs += @('--', '--no-default-features') }
        Run-Checked (Join-Path $repoRoot 'node_modules\.bin\tauri.cmd') $buildArgs
        Copy-Item -LiteralPath (Join-Path $repoRoot 'src-tauri\target\release\netease-music-player.exe') -Destination $stagedExe -Force
    }
    if (-not (Test-Path -LiteralPath $stagedExe)) { throw "缺少本版本独立暂存的主程序：$stagedExe" }

    $downloads = @()
    if ($includeStudio) { $downloads += @(
        @{ Name = 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'; Url = 'https://go.microsoft.com/fwlink/?linkid=2124701'; Signed = $true },
        @{ Name = 'vc_redist.x64.exe'; Url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'; Signed = $true }
    ) }
    $downloads += @(
        @{ Name = 'ChineseSimplified.isl'; Url = 'https://raw.githubusercontent.com/jrsoftware/issrc/is-6_7_3/Files/Languages/ChineseSimplified.isl'; Signed = $false }
    )
    foreach ($download in $downloads) {
        $path = Join-Path $prerequisiteDir $download.Name
        if (-not (Test-Path -LiteralPath $path)) {
            # Node's TLS avoids the restricted shell's Windows Schannel credential error.
            Run-Checked 'node' @((Join-Path $PSScriptRoot 'download-installer-asset.mjs'), $download.Url, $path)
        }
        if ($download.Signed) {
            $signature = Get-AuthenticodeSignature -LiteralPath $path
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
                throw "运行环境安装器签名无效：$path"
            }
        }
    }
    $studioFlag = if ($includeStudio) { '1' } else { '0' }
    Run-Checked $IsccPath @('/Qp', "/DRepoRoot=$repoRoot", "/DAppVersion=$version", "/DPrerequisiteDir=$prerequisiteDir", "/DAppExe=$stagedExe", "/DEdition=$editionName", "/DIncludeStudio=$studioFlag",
        "/O$outputDir", (Join-Path $repoRoot 'tools\installer\cove-full.iss'))

    $file = Join-Path $outputDir "Cove_$version-$editionName-setup.exe"
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    [IO.File]::WriteAllText((Join-Path $outputDir "SHA256-$editionName.txt"), "$hash  $([IO.Path]::GetFileName($file))`r`n", [Text.Encoding]::ASCII)
    $readme = if ($includeStudio) { 'README.md' } else { 'README-player.md' }
    $readmeName = if ($includeStudio) { '完整版安装说明.md' } else { '纯播放器安装说明.md' }
    Copy-Item -LiteralPath (Join-Path $repoRoot "tools\installer\$readme") -Destination (Join-Path $outputDir $readmeName) -Force
    $metadata = @{
        version = $version; edition = $editionName; studioIncluded = $includeStudio
        installer = [IO.Path]::GetFileName($file); installerBytes = (Get-Item -LiteralPath $file).Length; installerSha256 = $hash
        applicationSha256 = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash
        baseCommit = (git rev-parse HEAD); containsLocalChanges = [bool](git status --porcelain)
        builtAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
        prerequisiteStrategy = if ($includeStudio) { 'embedded-offline' } else { 'download-if-missing' }
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText((Join-Path $outputDir "BUILD-$editionName.json"), $metadata, [Text.UTF8Encoding]::new($false))
    if (-not $includeStudio) {
        $portableDir = Join-Path $stageDir "portable\Cove-$version-player"
        New-Item -ItemType Directory -Force $portableDir | Out-Null
        Copy-Item -LiteralPath $stagedExe -Destination (Join-Path $portableDir 'netease-music-player.exe') -Force
        Copy-Item -LiteralPath (Join-Path $repoRoot 'tools\installer\README-player.md') -Destination (Join-Path $portableDir 'README.md') -Force
        $portableZip = Join-Path $outputDir "Cove_$version-player-portable.zip"
        Compress-Archive -LiteralPath $portableDir -DestinationPath $portableZip -CompressionLevel Optimal -Force
        $zipHash = (Get-FileHash -LiteralPath $portableZip -Algorithm SHA256).Hash
        [IO.File]::WriteAllText((Join-Path $outputDir 'SHA256-player-portable.txt'), "$zipHash  $([IO.Path]::GetFileName($portableZip))`r`n", [Text.Encoding]::ASCII)
    }
    Write-Host "安装包：$file"
    Write-Host "SHA-256：$hash"
} finally {
    Pop-Location
}
