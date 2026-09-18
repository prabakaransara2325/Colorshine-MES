# Colorshine MES V2 v0.9.3

## RM Stores inventory correction

Screen 1102 is now strictly **RM Inventory**.

It must never display WIP or FG. The backend endpoint `/api/rm-inventory/report`
contains a hard `stock_stage='RM'` condition and exposes no Sales Order / MES PO
columns to the RM Stores screen.

### Screen 1102 KPI tiles
1. No. of Coils
2. Total Qty (MT)
3. Total Prime Qty (MT)
4. 2001 Storage Qty (MT)
5. RC01 Storage Qty (MT)

### Screen 1102 filters
- Material Code
- Storage Location
- Thickness
- Heat No
- Steel Grade
- Quality Grade

### Full plant inventory
Reports -> Screen 6109 Plant Stock Report remains the complete RM/WIP/FG report,
including Sales Order and MES PO linkage fields.

## Inventory reset before corrected re-upload

Run:

`backend/sql/21_clear_inventory_master_test_data.sql`

This deletes the previously imported rows from `mes.inventory_master` only.
It does NOT delete operational RM GRN, quality, usage decision or RM inventory
movement data.

The old test loader SQL 19 has been moved to `backend/sql/archive` and is marked
DO NOT RUN. The old InventoryMaster source workbook has also been removed from
this package to avoid accidental re-import.

## Start

Backend:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\backend
npm run dev
```

Frontend:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\frontend
npm run dev
```

Then use Ctrl+F5 in the browser.
