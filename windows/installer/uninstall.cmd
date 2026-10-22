@echo off
setlocal
chcp 65001 >nul
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo Uninstall failed with exit code %EXIT_CODE%.
exit /b %EXIT_CODE%
