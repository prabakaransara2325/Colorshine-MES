@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.3 - Dynamic Runtime Framework
echo ============================================================
echo.
node scripts\apply-v0103-dynamic-runtime-framework.cjs
if errorlevel 1 (
  echo.
  echo Migration failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Migration completed successfully.
echo Restart backend/frontend and press Ctrl+F5.
pause
