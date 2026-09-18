@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.11.1 - Verify TDC Source Seed
echo ============================================================
node scripts\verify-v0111-tdc-source-seed.cjs
if errorlevel 1 (
  echo.
  echo Verification FAILED. Do not proceed with TDC UAT.
  pause
  exit /b 1
)
echo.
echo Verification PASSED.
pause
