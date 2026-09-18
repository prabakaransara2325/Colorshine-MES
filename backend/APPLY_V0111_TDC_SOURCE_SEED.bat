@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.11.1 - TDC Source Templates + Initial TDCs
echo Company 2000 / Plant 2000
echo ============================================================
node scripts\apply-v0111-tdc-source-seed.cjs
if errorlevel 1 (
  echo.
  echo Migration failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Migration complete.
echo Run VERIFY_V0111_TDC_SOURCE_SEED.bat before UAT.
pause
