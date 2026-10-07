@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-cove-studio-patch.ps1" %*
if errorlevel 1 echo Patch failed. Read the message above before retrying.
pause
