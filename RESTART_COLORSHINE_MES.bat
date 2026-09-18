@echo off
setlocal
title Colorshine MES Restart

set "SCRIPT_DIR=%~dp0"

echo ==========================================================
echo           COLORSHINE MES - RESTART SERVICES
echo ==========================================================
echo.

call "%SCRIPT_DIR%STOP_COLORSHINE_MES.bat"

echo Waiting for ports to be released...
timeout /t 3 /nobreak >nul

call "%SCRIPT_DIR%START_COLORSHINE_MES.bat"

exit /b 0
