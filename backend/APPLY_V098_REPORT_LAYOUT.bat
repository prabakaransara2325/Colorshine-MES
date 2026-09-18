@echo off
setlocal
title Colorshine MES v0.9.8 - Report Layout Migration
cd /d "%~dp0"
echo ==========================================================
echo COLORSHINE MES v0.9.8 - USER REPORT LAYOUT MIGRATION
echo ==========================================================
echo.
node scripts\apply-v098-layout-migration.cjs
if errorlevel 1 (
  echo.
  echo Migration failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Migration completed successfully.
pause
