param(
    [switch]$SkipAppBuild,
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
New-Item -ItemType Directory -Force $outputDir, $prerequisiteDir | Out-Null

function Run-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File 失败，错误码 $LASTEXITCODE" }
}

if (-not (Test-Path -LiteralPath $IsccPath)) { throw '需要安装 Inno Setup 6.5.2 或更新版本，或通过 -IsccPath 指定编译器。' }
foreach ($relative in @('runner.py', 'ncm2acc.py', 'ncmdump-go.exe', 'ffmpeg.exe', 'python\python.exe',
    'models\model_bs_roformer_ep_317_sdr_12.9755.ckpt', 'models\model_bs_roformer_ep_317_sdr_12.9755.yaml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime $relative))) { throw "完整运行资源缺失：$relative" }
}

Push-Location $repoRoot
try {
    if (-not $SkipAppBuild) {
        Run-Checked (Join-Path $repoRoot 'node_modules\.bin\tsc.cmd') @('-b')
        Run-Checked (Join-Path $repoRoot 'node_modules\.bin\vite.cmd') @('build', '--configLoader', 'runner')
        $override = Join-Path $prerequisiteDir 'tauri-full-build.json'
        [IO.File]::WriteAllText($override, '{"build":{"beforeBuildCommand":""},"bundle":{"resources":[]}}', [Text.UTF8Encoding]::new($false))
        Run-Checked (Join-Path $repoRoot 'node_modules\.bin\tauri.cmd') @('build', '--no-bundle', '--config', $override)
    }

    $downloads = @(
        @{ Name = 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'; Url = 'https://go.microsoft.com/fwlink/?linkid=2124701'; Signed = $true },
        @{ Name = 'vc_redist.x64.exe'; Url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'; Signed = $true },
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
    Run-Checked $IsccPath @('/Qp', "/DRepoRoot=$repoRoot", "/DAppVersion=$version", "/DPrerequisiteDir=$prerequisiteDir",
        "/O$outputDir", (Join-Path $repoRoot 'tools\installer\cove-full.iss'))

    $file = Join-Path $outputDir "Cove_$version-full-setup.exe"
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    [IO.File]::WriteAllText((Join-Path $outputDir 'SHA256-full.txt'), "$hash  $([IO.Path]::GetFileName($file))`r`n", [Text.Encoding]::ASCII)
    Copy-Item -LiteralPath (Join-Path $repoRoot 'tools\installer\README.md') -Destination (Join-Path $outputDir '完整安装说明.md') -Force
    Write-Host "完整安装包：$file"
    Write-Host "SHA-256：$hash"
} finally {
    Pop-Location
}
