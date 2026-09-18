# Colorshine MES V2 v0.10.4 — Approved Master Creation

Source workbook: `Masters Creation(1).xlsx`

## Source reviewed

- Route: 33 rows
- Material Master: 12 rows
- ThicknessMatrix: 94 rows
- WorkCenters: 12 rows
- Sales Order Types: 4 rows

## Thickness rule — critical

The approved rule used in this build is:

- Finished / GL Min = Target - **0.005 mm**
- Finished / GL Max = Target + **0.005 mm**
- CR Min = Target - **0.005 mm**
- CR Max = Target + **0.005 mm**

**0.050 mm is not used.**

The database now stores the tolerance value separately and derives Min/Max automatically. The Thickness Matrix UI also makes Min/Max read-only derived values. This prevents the previous 0.050-entry problem.

## Duplicate handling

No exact duplicate master rows were found.

Six Material + Coating GSM + Finished Thickness combinations occur more than once, but their CR/HR process values differ. They are therefore not deleted. They are retained as `Variant 1`, `Variant 2`, etc. so no valid process alternative is silently lost.

## Source data held for review

1. Route `GLAZ150CF / S2` has 4 work centers but only 4 material nodes. A four-step route requires five material nodes. The header is loaded as `REVIEW / INACTIVE` and no normalized route steps are generated.
2. Thickness UUID `10077` has HR target 2.500 with source range 2.200–2.000. Loaded `REVIEW / INACTIVE`.
3. Thickness UUID `10078` has the same invalid HR range issue. Loaded `REVIEW / INACTIVE`.

Everything else is loaded as valid/active after the confirmed ±0.005 tolerance normalization.

## Master data created

- Companies: 1000 CCPL, 2000 CIPL
- Plants: 1000, 2000
- Materials: 12
- Work Centers: 12, Company + Plant specific
- Operations: 12, Work Center specific
- Thickness Matrix: 94 total; 92 VALID/ACTIVE + 2 REVIEW/INACTIVE
- Route Master: 33 total; 32 VALID/ACTIVE + 1 REVIEW/INACTIVE
- Route Steps: normalized from Process Path + Material Tree for valid routes
- Group Codes seeded from the workbook:
  - SALES_ORDER_TYPE
  - ROUTE_INDICATOR
  - MATERIAL_TYPE
  - PRODUCT_GROUP

## Capacity

The workbook does not contain Year / Month / Day capacity values. The Work Center capacity milestone structure remains available, but **no capacity values are invented or seeded**.

## New / updated screens

- 7101 Thickness Matrix — tolerance-driven Min/Max
- 7102 Work Center Master — Company + Plant specific, capacity milestone ready
- 7104 Group Code & Dynamic Controls
- 7105 Operation Master
- 7106 Material Master
- 7107 Route Master

## Installation

Copy this patch over the current Colorshine MES project root:

`D:\Colorshine\Color_MES\ColorshineMes`

Keep the existing `.env` files.

Run:

`backend\APPLY_V0104_MASTER_CREATION.bat`

The v0.10.4 script is cumulative over v0.10.2/v0.10.3 and applies SQL 33, 34 and 35.

Then restart backend/frontend and press `Ctrl + F5`.

## Expected verification

- Materials = 12
- Work Centers = 12
- Operations = 12
- Thickness rows = 94
- Thickness VALID + ACTIVE = 92
- Thickness REVIEW = 2
- Route headers = 33
- Route VALID + ACTIVE = 32
- Route REVIEW = 1
- Bad ±0.005 tolerance rows = 0

The cleaned review workbook is included under `docs/Colorshine_MES_v0_10_4_Cleaned_Masters_Review.xlsx`.
