@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.8 - SIMPLE ACTIVE UI CLEANUP
echo ============================================================
echo.
echo This migration DOES NOT delete material, work center, operation,
echo thickness, route, tolerance or group-code master data.
echo.
echo It only hides undeveloped dashboard shells and the old combined
echo Reference Masters screen from the active application register.
echo.
node scripts\apply-v0108-active-ui-cleanup.cjs
if errorlevel 1 (
  echo.
  echo Migration failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Completed. Restart backend/frontend and press Ctrl+F5 in Chrome.
pause
