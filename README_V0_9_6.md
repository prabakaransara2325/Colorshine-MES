# Colorshine MES V2 v0.9.6 – Approved RM Opening Inventory Backend Load

This release packages the final approved Plant 2000 RM GRN and QA dumps into the backend.

## Approved data
- GRN/opening inventory: 8,692 Plant 2000 `R_HR*` coils
- QA/chemistry/mechanical matches: 8,689 coils
- QA pending: 3 coils
- Heat No: approved simulated unique 8-digit migration/test values

## One-click load
From the backend folder, double-click:

`IMPORT_RM_OPENING_AND_QA.bat`

or run:

`npm run import:rm-opening`

The importer:
1. Installs the opening-inventory framework if SQL 23 is not already installed.
2. Applies SQL 25 backend master/view preparation.
3. Loads the approved QA / chemistry / mechanical dump into QA staging.
4. Loads the approved GRN dump into opening-inventory staging.
5. Validates all 8,692 rows.
6. If any ERROR exists, stops before live posting.
7. If validation is clean, posts canonical GRN, batch, RM inventory and QA analysis.
8. Preserves source supplier text for GRN Monitor/RM Inventory even when legacy supplier codes are inconsistent.

## Expected final result
- Screen 1101 GRN Monitor: 8,692 R_HR rows
- Screen 1102 RM Inventory: 8,692 R_HR rows
- QA matched PRIME: 8,689 available coils
- QA missing: 3 quality-hold coils

Run `backend/sql/26_verify_rm_opening_import.sql` after the import for database verification.

Do not run the import twice. The importer blocks a duplicate POSTED run named `APPROVED_RM_OPENING_2026_09_08`.
