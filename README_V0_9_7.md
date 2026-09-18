# Colorshine MES V2 v0.9.7 – RM Inventory Performance & Fresh Rebuild

This release rebuilds the approved Plant 2000 R_HR opening inventory and improves Screen 1102 responsiveness.

## Changes

- Cleans previous opening-migration RM records only, then reloads the approved 8,692 GRN coils and 8,689 matched QA rows.
- Generates deterministic simulated Stock Generated Dates from 2025-01-01 through the rebuild date, consistent per SAP GRN.
- Stock Age is calculated dynamically as CURRENT_DATE - Stock Generated Date.
- Screen 1102 loads 200 rows by default with server-side paging instead of rendering all 8,692 rows.
- Removed huge Batch/Heat datalists that previously created thousands of DOM options.
- Added visible loading overlay/spinner during report reads.
- Reworked QA chemistry SQL from one LATERAL aggregate per coil to one grouped QA scan.
- Added PostgreSQL indexes for RM inventory/report queries.
- Thickness shown as 3 decimals.
- Width shown as whole millimetres.
- Chemistry shown as 3 decimals.
- RM Source shown without leading zeroes.
- RM Stores dashboard thickness/width formatting aligned to 3 / 0 decimals.

## Run

From backend root:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\backend
npm run rebuild:rm-opening
```

Or double-click `REBUILD_RM_OPENING_V097.bat`.

Then restart backend/frontend and press Ctrl+F5.

## Expected counts

- RM coils: 8,692
- QA matched / available: 8,689
- QA pending / quality hold: 3
- GRN Monitor rows: 8,692

Use `backend/sql/28_verify_rm_v097.sql` after the rebuild.
