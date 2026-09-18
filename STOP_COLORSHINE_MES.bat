@echo off
setlocal
title Colorshine MES Stopper

echo ==========================================================
echo            COLORSHINE MES - STOP SERVICES
echo ==========================================================
echo.

call :KillPort 5173 "Frontend"
call :KillPort 3000 "Backend"

echo.
echo Stop command completed.
timeout /t 2 /nobreak >nul
exit /b 0

:KillPort
set "PORT=%~1"
set "NAME=%~2"
set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
    set "FOUND=1"
    echo Stopping %NAME% on port %PORT% - PID %%P
    taskkill /PID %%P /T /F >nul 2>&1
)

if "%FOUND%"=="0" (
    echo %NAME% is not running on port %PORT%.
)
exit /b 0
