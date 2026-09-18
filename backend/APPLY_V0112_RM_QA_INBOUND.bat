@echo off
setlocal
cd /d "%~dp0"
echo ==========================================================
echo   Colorshine MES v0.11.2 - SAP RM QA / Supplier TC Inbound
echo ==========================================================
node scripts\apply-v0112-rm-qa-inbound.cjs
pause
