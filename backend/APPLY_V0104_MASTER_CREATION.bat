@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.4 - Approved Master Creation
echo Source: Masters Creation(1).xlsx
echo ============================================================
echo.
echo IMPORTANT: Thickness GL/CR Min-Max will use TARGET +/- 0.005 mm.
echo 0.050 mm is NOT used.
echo.
node scripts\apply-v0104-master-creation.cjs
if errorlevel 1 (
  echo.
  echo Master creation failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Master creation completed successfully.
echo Restart backend/frontend and press Ctrl+F5.
pause
