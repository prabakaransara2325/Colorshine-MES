@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.5 - Import Supplied SAP SO Sample
echo ============================================================
node scripts\import-sap-so-sample-v0105.cjs
if errorlevel 1 (
  echo.
  echo SAP SO sample import failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo SAP SO sample import complete. Open Screen 2101.
pause
