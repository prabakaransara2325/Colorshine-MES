# Colorshine MES V2 v0.10.8 — Simple Active UI + Master Copy/Edit

This release keeps the application deliberately small while the MES is being developed screen by screen.
Only implemented modules and screens are exposed in the launcher, screen search, Favorites and working-screen flow.
No material, work center, operation, thickness, tolerance, route or Group Code master data is deleted by this release.

## UI cleanup

The visible business modules are now **RM Stores, Planning, Quality, Reports and Masters**. Production and Maintenance are hidden because they currently contain only undeveloped dashboard shells. Planning, Quality and Reports no longer open placeholder dashboards; their module entry opens the first implemented transaction/report directly.

The old **Reference Masters / combined Master Data** screen is retired from the active UI. **Masters Control Center (Screen 7000)** is now available only inside the **Masters** module and has been removed from the ADMIN profile dropdown. Administration is kept to the active user-management screens.

## Master maintenance

The active manufacturing masters now provide **Copy as New** together with **Edit**:

- Material Master: copy keeps attributes and clears the unique Material Code.
- Work Center Master: copy keeps plant/capacity settings and clears the unique Work Center Code.
- Operation Master: copy keeps Work Center and control flags and clears the unique Operation Code.
- Thickness Matrix: copy proposes the next variant and starts as REVIEW + INACTIVE.
- Work Center Tolerance: copy proposes a new priority and starts as DRAFT + INACTIVE.
- Route Master: copy clears Route Indicator and starts as REVIEW + INACTIVE.
- Group Code master: Group Codes, Code Details, Control Rules and Screen Bindings all support Copy + Edit with safe new-key defaults.

## One-time database/UI-register cleanup

Run:

`backend\APPLY_V0108_ACTIVE_UI_CLEANUP.bat`

This only updates the application module/screen register and removes Favorites/working-tab references to screens that have intentionally been hidden. It does not truncate business tables or master tables.

After the migration, restart backend and frontend and press **Ctrl+F5** in Chrome.
