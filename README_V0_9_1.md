# Colorshine MES V2.0.9.1

## Scope in this package

This is the consolidated application package through the current development point.

### Application foundation
- Responsive login and full-screen MES shell
- Direct screen-number calling
- Module launcher
- User favorites
- Maximum 8 working processing-screen tabs
- User/access-group/company/plant foundation
- RM Stores, Planning, Production, Quality, Maintenance, Reports, Masters and Administration navigation

### RM / inventory foundation
- GRN / RM quality / MES usage-decision flow
- RM operational inventory and supplier-TC analysis
- Plant 2000 test inventory report loaded from `InventoryMaster_MES.xlsx`
- 983 unique batches / inventory rows
- Exact 49-column required business report format
- RM / WIP / FG stage filters
- Material-type and QA-grade filters
- Exact-format CSV download from Inventory screen

### Plant 2000 Planning / Masters
- Thickness matrix master: 170 rows
  - 135 VALID/active
  - 35 REVIEW/inactive
- Work Centers:
  - HRS01 - HR Slitter Line
  - PPL01 - Push Pull Pickling Line
  - CRM01 - 6Hi CR Mill
  - CRS01 - CR Rewinding & Trimming Line
  - CGL01 - Continuous Galvalume Line
  - PACK2 - CIPL Packing Line
- Masters module:
  - 7000 Masters Dashboard
  - 7101 Thickness Matrix
  - 7102 Work Center Master
  - 7103 Work Center Tolerance Matrix

## Important database run order

For an existing database that already has SQL 09-17 applied, run:

1. `backend/sql/18_masters_module_and_tolerance_v2.sql`
2. `backend/sql/19_inventory_master_plant2000_test_load.sql`

If earlier migrations are missing, run the SQL files in ascending order, using the latest version of each file.

### Inventory load expected verification

After SQL 19:

- Plant: 2000
- Rows: 983
- Unique batches: 983
- Total quantity: 14,979.908 MT
- RM rows: 174
- WIP rows: 342
- FG rows: 467

## Inventory report format

The RM Inventory screen now reads `mes.vw_inventory_master_report` and shows/downloads the exact 49 business columns from the supplied `InventoryMaster_MES.xlsx`.

A formatted reference copy is included at:

`docs/Colorshine_MES_Plant2000_Inventory_Test_Data.xlsx`

Original source files are retained in:

`docs/source_data/`

## Starting the application

Backend:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\backend
npm install
npm run dev
```

Frontend:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\frontend
npm install
npm run dev
```

Then hard-refresh Chrome with `Ctrl + F5`.

Keep your existing backend `.env` and frontend `.env` values when replacing the project.
