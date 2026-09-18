@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Colorshine MES v0.10.5 - Setup + Receive SAP SO Sample
echo ============================================================
node scripts\apply-v0105-sap-so-inbound.cjs
if errorlevel 1 goto :fail
node scripts\import-sap-so-sample-v0105.cjs
if errorlevel 1 goto :fail
echo.
echo ============================================================
echo DONE - Open MES Screen 2101 - SAP Sales Order Monitor
echo ============================================================
pause
exit /b 0
:fail
echo.
echo Setup/import failed. Review the error above.
pause
exit /b 1
