Cove 伴奏转换编码补丁
=======================

用途
----
修复部分电脑上转换时出现“伴奏运行包退出码 120”、GBK 乱码或
“OSError: [Errno 22] Invalid argument”的问题。

使用方法
--------
1. 关闭 Cove。
2. 解压本补丁 ZIP。
3. 双击 apply-cove-stem-patch.bat。
4. 如果没有自动找到安装目录，在目录选择框中选择 Cove 安装目录，
   例如 E:\Cove。目录中应存在 resources\ncm2acc\runner.py。
5. 如果弹出 UAC，请允许管理员权限。
6. 重新打开 Cove，再开始转换。

本补丁只替换 resources\ncm2acc\runner.py，不会替换模型、Python、FFmpeg、
ncmdump-go、录音工程或缓存。原文件会保存在同目录的 runner.py.backup-时间戳。

如果需要回滚，关闭 Cove 后把备份文件复制回 runner.py 即可。
