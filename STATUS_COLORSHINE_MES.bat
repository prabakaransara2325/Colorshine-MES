@echo off
setlocal
title Colorshine MES Status

echo ==========================================================
echo            COLORSHINE MES - SERVICE STATUS
echo ==========================================================
echo.

call :CheckPort 3000 "Backend"
call :CheckPort 5173 "Frontend"

echo.
pause
exit /b 0

:CheckPort
set "PORT=%~1"
set "NAME=%~2"
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 (
    echo [STOPPED] %NAME% - Port %PORT%
) else (
    echo [RUNNING] %NAME% - Port %PORT%
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
        echo           PID %%P
    )
)
exit /b 0
