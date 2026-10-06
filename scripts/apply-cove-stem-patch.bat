@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-cove-stem-patch.ps1"
if errorlevel 1 (
  echo.
  echo 补丁应用失败，请把此窗口中的错误信息发回。
  pause
  exit /b 1
)
echo.
pause
