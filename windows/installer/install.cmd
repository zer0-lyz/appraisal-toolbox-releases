@echo off
setlocal
chcp 65001 >nul
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" (
  echo.
  echo [SUCCESS] Installation completed. See installation-report.txt for details.
) else (
  echo.
  echo [FAILED] Installation failed with exit code %EXIT_CODE%. See installation-report.txt and the failure report for details.
)
if /i "%APPRAISAL_INSTALL_NONINTERACTIVE%"=="1" goto :RETURN
echo.
echo Press any key to close this window...
pause
:RETURN
exit /b %EXIT_CODE%
