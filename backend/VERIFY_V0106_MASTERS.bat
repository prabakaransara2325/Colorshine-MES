@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.6 - Verify Approved Masters
echo ============================================================
node scripts\verify-v0106-masters.cjs
if errorlevel 1 (
  echo.
  echo Verification failed. If master tables/counts are missing, run APPLY_V0105_SAP_SO_INBOUND.bat.
  pause
  exit /b 1
)
echo.
echo Verification complete. Open Module 7 - Masters - Screen 7000.
pause
