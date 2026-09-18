# Colorshine MES V2 - v0.9.2

## Inventory / Reports correction

### RM Stores - Screen 1102: RM Inventory
- Now shows **RM only**.
- WIP and FG are excluded.
- Sales Order fields are excluded from both grid and download.
- RM-specific detailed fields remain available, including supplier batch, heat, steel grade and chemistry.
- Filters: Material Code, Storage Location, Thickness, Heat No, Steel Grade and Quality Grade.

### Reports - Screen 6109: Plant Stock Report
- New detailed report under the Reports module.
- Shows **RM + WIP + FG**.
- Keeps the complete 49-column `InventoryMaster_MES.xlsx` business format, including SO/MES PO linkage.
- Required filters:
  - Material Code
  - Storage Location
  - Category (RM/WIP/FG)
  - Thickness
  - Heat No
  - Steel Grade
  - Quality Grade
- Full CSV download uses the same 49-column report structure.

## Database
If SQL 19 has already been run and the 983 rows are visible, do not reload it.
Run only:

`backend/sql/20_reports_plant_stock.sql`

This registers Screen 6109 in the Reports module.

## Existing Plant 2000 test inventory
- Total rows: 983
- RM: 174
- WIP: 342
- FG: 467
- Total quantity: 14,979.908 MT

## Restart
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
