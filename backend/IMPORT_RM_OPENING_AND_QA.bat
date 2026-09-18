@echo off
setlocal
title Colorshine MES - Final RM Opening Import
cd /d "%~dp0"

echo ==============================================================
echo  COLORSHINE MES - FINAL RM OPENING + QA BACKEND IMPORT
echo ==============================================================
echo.
echo This will load the approved Plant 2000 R_HR GRN and QA dumps.
echo It posts only when all 8,692 GRN rows pass backend validation.
echo.

if not exist ".env" (
  echo [ERROR] backend\.env is missing.
  pause
  exit /b 1
)

call npm run import:rm-opening
if errorlevel 1 (
  echo.
  echo [FAILED] Import did not complete. Read the error above.
  pause
  exit /b 1
)

echo.
echo [SUCCESS] RM opening inventory and QA import completed.
echo Restart the backend/frontend and verify Screens 1101 and 1102.
pause
