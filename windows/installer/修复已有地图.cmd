@echo off
setlocal
chcp 65001 >nul
if "%~1"=="" (
  echo 请把评估工具箱已有地图 HTML 文件拖到此脚本上。
  echo 脚本先备份，再只更新地图显示组件；不会重新抓取或修改坐标数据。
  pause
  exit /b 1
)
"%~dp0runtime\python-portable\python.exe" -X utf8 "%~dp0skills\map-shared\update_map_page.py" --client "%~dp0native-helper\map-assets\amap-only.js" --apply "%~f1"
set "MAP_FIX_EXIT=%ERRORLEVEL%"
pause
exit /b %MAP_FIX_EXIT%
