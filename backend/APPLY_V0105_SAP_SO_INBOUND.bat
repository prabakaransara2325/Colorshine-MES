@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.5 - SAP SO Inbound + Master Fix
echo ============================================================
node scripts\apply-v0105-sap-so-inbound.cjs
if errorlevel 1 (
  echo.
  echo Migration failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Migration complete.
pause
