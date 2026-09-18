@echo off
setlocal
cd /d "%~dp0"
echo ==========================================================
echo   Colorshine MES v0.11.4 - Plant Stock batch status + auto-UD
echo ==========================================================
node scripts\apply-v0114-plant-stock-status.cjs
pause
