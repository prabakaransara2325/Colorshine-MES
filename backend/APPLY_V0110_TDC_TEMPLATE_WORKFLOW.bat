@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.11.0 - TDC Template + Approval Workflow
echo Company 2000 / Plant 2000
echo ============================================================
node scripts\apply-v0110-tdc-template-workflow.cjs
if errorlevel 1 (
  echo.
  echo Migration failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Migration complete.
pause
