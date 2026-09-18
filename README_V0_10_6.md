# Colorshine MES V2 v0.10.6 — Clean Masters Control Center

This build corrects the Masters visibility and navigation issue reported in v0.10.5.

## What changed
- Replaced the static Masters module landing page with a live **Masters Control Center**.
- Live PostgreSQL counts are now visible immediately for Materials, Work Centers, Operations, Thickness Matrix, Routes and Group Codes.
- Shows plant coverage, review counts, capacity-milestone coverage and the approved **±0.005 mm** thickness validation check.
- Added missing read APIs for Storage Locations, Customers and Brands in the admin reference screen.
- Supplier and Quality Parameter reference tabs can now display active/inactive rows.
- The old `/masters` path now opens the Masters Control Center instead of the confusing legacy admin screen.
- Admin reference data is still available separately at Screen 9002.
- Frontend and backend versions aligned to **0.10.6**.

## Expected approved workbook master data after v0.10.5 migration
- Materials: 12
- Work Centers: 12
- Operations: 12
- Thickness Matrix: 94 total (92 valid/active + 2 review)
- Routes: 33 total (32 valid/active + 1 review)
- Thickness tolerance exception count: 0

## Install
1. Stop backend and frontend.
2. Extract this package over `D:\Colorshine\Color_MES\ColorshineMes`.
3. If the v0.10.5 master migration was not completed successfully, run `backend\APPLY_V0105_SAP_SO_INBOUND.bat` once.
4. Start backend and frontend.
5. Press **Ctrl+F5** in the browser.
6. Open Module **7 — Masters**, Screen **7000**.

No new database schema migration is required specifically for the v0.10.6 UI fix.
