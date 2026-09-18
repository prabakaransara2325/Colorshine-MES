@echo off
setlocal
title Colorshine MES Launcher

set "BACKEND_DIR=D:\Colorshine\Color_MES\ColorshineMes\backend"
set "FRONTEND_DIR=D:\Colorshine\Color_MES\ColorshineMes\frontend"

echo ==========================================================
echo            COLORSHINE MES - START SERVICES
echo ==========================================================
echo.

if not exist "%BACKEND_DIR%\package.json" (
    echo [ERROR] Backend package.json not found:
    echo         %BACKEND_DIR%
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
    echo [ERROR] Frontend package.json not found:
    echo         %FRONTEND_DIR%
    pause
    exit /b 1
)

echo [1/2] Starting Backend...
start "Colorshine MES Backend" /min cmd /k "cd /d "%BACKEND_DIR%" && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend...
start "Colorshine MES Frontend" /min cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev"

echo.
echo Services started.
echo Backend  : http://localhost:3000
echo Frontend : http://localhost:5173
echo.
echo You can close this launcher window.
timeout /t 3 /nobreak >nul
exit /b 0
