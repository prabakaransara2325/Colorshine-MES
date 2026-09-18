@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.7 - ADMIN LOGIN / PLANT ACCESS REPAIR
echo ============================================================
echo.
echo This repair is safe and only maps existing legacy ADMIN users to:
echo   SYSTEM_ADMIN ^> Company 1000/2000 ^> Plant 1000/2000
echo.
node scripts\apply-v0107-admin-access-repair.cjs
if errorlevel 1 (
  echo.
  echo Repair failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Repair completed. Restart backend and press Ctrl+F5 in the browser.
pause
