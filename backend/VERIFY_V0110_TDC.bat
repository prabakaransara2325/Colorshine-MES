@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.11.0 - TDC Verification
echo Company 2000 / Plant 2000
echo ============================================================
node scripts\verify-v0110-tdc.cjs
if errorlevel 1 (
  echo.
  echo Verification FAILED. Review the message above before UAT.
  pause
  exit /b 1
)
echo.
echo Verification PASSED.
pause
