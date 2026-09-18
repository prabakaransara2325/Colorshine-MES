# Colorshine MES V2 v0.10.11 — No Summary Tiles

Current full-package release: **v0.10.11**.

## UI change

This release removes KPI / summary tiles from active operational and master-data screens so the user sees filters, actions and data immediately.

Removed summary tile strips from:
- MES Overview
- RM Stores Dashboard
- Thickness Matrix (7101)
- SAP Sales Order Monitor (2101)
- Plant Stock Report (6109)
- Masters Control Center top record-count strip and data-health tile section

The SAP Sales Order detail popup also uses a compact two-row information table instead of KPI cards. Navigation shortcuts and functional action cards are retained where they are part of the workflow, not summary decoration.

No database migration is required. No master or transactional data is changed.

## Install
1. Stop frontend and backend.
2. Extract this full package over `D:\Colorshine\Color_MES\ColorshineMes`.
3. Restart backend and frontend.
4. Press `Ctrl+F5` in Chrome.
5. Confirm footer shows **MES V2 0.10.11**.
