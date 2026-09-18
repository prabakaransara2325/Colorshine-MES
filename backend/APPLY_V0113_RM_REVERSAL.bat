@echo off
setlocal
cd /d "%~dp0"
echo ==========================================================
echo   Colorshine MES v0.11.3 - RM GRN/QC Reversal
echo ==========================================================
node scripts\apply-v0113-rm-reversal.cjs
pause
