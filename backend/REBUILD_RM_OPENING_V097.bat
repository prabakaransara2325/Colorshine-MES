@echo off
setlocal
title Colorshine MES v0.9.7 - Rebuild RM Opening Inventory
cd /d "%~dp0"
echo ============================================================
echo COLORSHINE MES v0.9.7 - RM OPENING INVENTORY REBUILD
echo ============================================================
echo.
echo This will remove ONLY the previous opening-migration RM data,
echo then reload the approved 8,692 GRN coils + QA dump.
echo Stock-generated dates will be simulated from 2025-01-01 to today.
echo.
node scripts\rebuild-rm-opening-v097.cjs
if errorlevel 1 (
  echo.
  echo [FAILED] Review the error shown above.
  pause
  exit /b 1
)
echo.
echo [SUCCESS] RM opening inventory rebuilt.
pause
