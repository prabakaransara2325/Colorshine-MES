# Colorshine MES V2 v0.9.8

## RM Inventory compact screen + user report layouts

Screen **1102 – RM Inventory** has been redesigned to maximize the usable table area.

### UI changes
- Removed the descriptive subtitle under `RM Inventory`.
- Removed the `Fast RM Stores view` information strip.
- All seven selection fields are now in one compact single-line toolbar:
  - Material Code
  - Batch No
  - Storage Location
  - Heat No
  - Supplier
  - QA Grade
  - Steel Grade
- Search and Reset stay on the same line.
- The table uses the remaining viewport height and retains server-side paging/loading feedback.
- Existing number display rules remain:
  - Thickness: 3 decimals
  - Width: whole mm
  - Chemistry: 3 decimals
  - RM Source: leading zeros removed

### User-wise report layouts
A generic `mes.app_user_report_layout` table has been added. Screen 1102 is the first consumer.

Each MES user can:
- choose visible/hidden columns;
- change column order;
- save multiple named layouts;
- mark one layout as their default;
- switch layouts from the RM Inventory header;
- delete their own layouts;
- download the report in the active visible column order;
- persist the selected page-size with the layout.

The `Standard Layout` is always available and cannot be deleted.

### Required database migration
Run once from the backend folder:

```powershell
npm run migrate:v098
```

or double-click:

`backend\APPLY_V098_REPORT_LAYOUT.bat`

This migration only adds user-layout storage. It does **not** change or reload the 8,692 RM inventory records.
