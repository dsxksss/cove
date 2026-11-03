# Cove 1.5.7 纯播放器安装包

运行 `Cove_1.5.7-player-setup.exe` 安装。默认目录为 `C:\Program Files\Cove Player`，可创建桌面和开始菜单快捷方式。轻量安装包不嵌入大型运行环境安装器；仅在检测到缺少 WebView2 或 VC++ x64 运行环境时，从 Microsoft 官方 HTTPS 地址下载并安装。运行环境齐全时可离线安装和启动；在线歌曲播放仍需网络。

便携版 `Cove_1.5.7-player-portable.zip` 解压后直接运行 `netease-music-player.exe`，同样使用本机已有的运行环境。如果本机尚未安装，可改用轻量安装包自动补齐，或使用 [Microsoft WebView2 下载页](https://developer.microsoft.com/microsoft-edge/webview2/) 和 [Microsoft VC++ x64 运行环境](https://aka.ms/vs/17/release/vc_redist.x64.exe) 先行安装。

此版本保留网易云、QQ、酷狗音乐播放、搜索、歌词、队列、自建歌单及播放器设置，不包含翻唱工作室、录音编辑、移调混音、伴奏分离或其 Python / FFmpeg / 模型运行资源。

与完整版使用不同安装目录和卸载条目，两版沿用同一用户的账户及播放器偏好；应用为单实例，请退出正在运行的 Cove 后再启动另一个版本。已有工作室工程和录音保留在用户应用数据目录，纯播放器版不提供打开入口。

升级前请完全退出 Cove。校验同目录 SHA256 文件可确认收到的文件与本次打包产物一致。
