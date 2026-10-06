# Cove Windows 完整安装包

运行 `Cove_<版本>-full-setup.exe`，选择安装目录，保留或取消“创建桌面快捷方式”，然后点击安装。

安装器内置 `netease-music-player.exe`、FFmpeg、ncmdump-go、独立 Python/audio-separator、CPU/CUDA 依赖和 BS-Roformer 模型。运行环境缺失时，安装器会使用内置的 Microsoft WebView2 和 VC++ 离线安装器补齐。使用者无需预装 Python、7-Zip，也无需手动解压分卷。

默认安装到 `C:\Program Files\Cove`，需要管理员权限。安装时显示文件解压进度，完成后可从桌面或开始菜单启动 Cove。用户录音、工程和缓存保存在用户应用数据目录，卸载程序不删除这些内容。

完整运行资源解压后约 5.5GB，建议预留至少 8GB 空间；在线歌曲下载仍需要网络，模型分离使用本机 CPU 或兼容的 NVIDIA GPU。

## 构建

需要 Inno Setup 6.5.2 或更新版本；将已验证的运行资源放入 `src-tauri/resources/ncm2acc`。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows-installer.ps1
```

已有本次版本的 release 主程序时，可加 `-SkipAppBuild` 仅重新打包。大文件安装器输出到 `.tmp/Cove-<版本>-Windows-x64`，附 SHA-256 文件清单。安装器资源和产物不提交到 Git。

安装验收使用 `/COVEVERIFY=1 /CURRENTUSER /DIR=<测试目录>`，会用独立测试 AppId，并把桌面和开始菜单快捷方式写入测试目录。该参数只用于隔离验收，不用于用户分发说明。

打包工具文档：[Inno Setup](https://jrsoftware.org/isinfo.php)。单文件压缩体积须小于 4.2GB；超过时应改用原生安装器分卷，由安装器自动读取，不能把普通自解压包当成已验证的自动安装器。
