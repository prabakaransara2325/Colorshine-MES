@echo off
setlocal
cd /d "%~dp0"
echo ==========================================================
echo   Colorshine MES v0.11.7 - fix screen registry gaps
echo ==========================================================
node scripts\apply-v0117-screen-registry.cjs
pause
