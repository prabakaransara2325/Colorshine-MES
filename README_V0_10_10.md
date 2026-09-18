# Colorshine MES V2 v0.10.10 — Planning Focus UI

Current full-package release: **v0.10.10**.

## Changes in this release
- Route Master: removed the KPI/tile strip. The screen opens directly with filters and route data.
- SAP Sales Order Monitor: removed Routes, Specs and Chem/Mech count columns from the main monitor.
- SAP Sales Order Monitor now shows: Steel Grade, Quality Grade, Coating GSM, Jet Printing and Guardfilm.
- Width is displayed without thousands separators and the UOM is shown in the header as `Width (mm)`.
- Thickness UOM is explicit in the header as `Thickness (mm)`.
- Qty header is explicit as `Qty (MT)`.
- Sales-order drill-down is simplified to requested order attributes + process path variants.
- No master or transaction data is deleted or recreated.

## Installation
1. Stop frontend and backend.
2. Extract this full package over `D:\Colorshine\Color_MES\ColorshineMes`.
3. No SQL migration is required.
4. Restart backend and frontend because the Planning API has changed.
5. Press `Ctrl+F5` in Chrome.
6. Confirm footer shows **MES V2 0.10.10**.

## Guardfilm mapping
The Planning API reads Guardfilm from common SAP characteristic aliases such as `GUARD_FILM`, `GUARDFILM`, `PROTECTIVE_FILM`, and related variants. If SAP sends a different characteristic name, the MES preserves the source data and the alias can be added without changing the UI.
