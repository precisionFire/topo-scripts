@echo off
rem ============================================================
rem  Network route switch (WiFi = intranet, USB = internet)
rem  Usage:
rem    net-route-switch.bat              interactive menu
rem    net-route-switch.bat on           enable
rem    net-route-switch.bat off          disable
rem    net-route-switch.bat status       show status
rem  Chinese text lives in the .ps1 file; this launcher stays ASCII
rem  on purpose so cmd codepage never mangles the script path.
rem ============================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\net-route-switch.ps1" %*
if errorlevel 1 pause
endlocal
